// Writes happen in two steps. `prepare` validates a request, checks permissions, and builds
// a preview, storing the exact plan under an ID. `apply` is the only thing that changes
// GitLab: it confirms with the user, checks nothing changed since the data was Fetched,
// applies the Writes in order, re-reads, and reports what didn't stick.
import { randomUUID } from "node:crypto";
import { GitLabError } from "../gateway.js";
import type { GitLab } from "../gitlab.js";
import type { Reader, WorkItem } from "../reader.js";
import { parseReference, refused } from "../references.js";
import type { Seen } from "../seen.js";
import type { Expectation, Guard, Plan, Planner, PlannedWrite, Step, Target } from "./plan.js";
import { excerpt, joinOrNone, renderConfirmation, renderPreview, renderReport, stateLines } from "./render.js";
import { MAX_WRITES, type WriteRequest } from "./requests.js";

/**
 * Asks the user, in a message showing them, to confirm sending some number of Writes:
 * true or false, or "unsupported" when the client can't ask.
 */
export type Confirm = (message: string, writes: number) => Promise<boolean | "unsupported">;

export interface WriteResult {
  /** Its number in the preview. */
  number: number;
  summary: string;
  /** The URL of the Work Item the summary names, if it names one. */
  url?: string;
  outcome: "done" | "failed" | "not applied";
  didNotStick: string[];
  detail?: string;
  /** The Reference of a Work Item this Write created, and its URL. */
  created?: string;
  createdUrl?: string;
}

/** What this plan's own Writes have changed so far, so a later Write doesn't take it for someone else's change. */
class OwnChanges {
  private readonly versions = new Map<string, string>();
  private readonly commentCounts = new Map<string, number>();

  record(write: PlannedWrite, after: WorkItem): void {
    this.versions.set(after.id, after.updatedAt);
    const { guard } = write;
    if (guard.kind !== "thread") return;
    const thread = after.threads.find((t) => t.id === guard.threadId);
    if (thread) this.commentCounts.set(guard.threadId, thread.commentCount);
  }

  /** The version a Work Item should be at now: as planned, or as this plan's own Writes left it. */
  version(target: Target): string {
    return this.versions.get(target.id) ?? target.updatedAt;
  }

  /** How many Comments a Thread should have now: as planned, or as this plan's own replies left it. */
  comments(guard: Extract<Guard, { kind: "thread" }>): number {
    return this.commentCounts.get(guard.threadId) ?? guard.comments;
  }
}

export class Writes {
  private readonly plans = new Map<string, Plan>();

  constructor(
    private readonly gitlab: GitLab,
    private readonly reader: Reader,
    private readonly seen: Seen,
    private readonly planner: Planner,
  ) {}

  async prepare(requests: WriteRequest[]): Promise<{ plan: Plan; preview: string }> {
    if (requests.length === 0) throw refused("There's nothing to write.");
    if (requests.length > MAX_WRITES) {
      throw refused(`That's ${requests.length} Writes; one preview holds at most ${MAX_WRITES}. Split them into smaller batches.`);
    }
    const writes: PlannedWrite[] = [];
    for (const [i, request] of requests.entries()) writes.push({ ...(await this.planner.plan(request)), number: i + 1 });
    const plan: Plan = { id: randomUUID(), writes };
    this.plans.set(plan.id, plan);
    return { plan, preview: renderPreview(plan) };
  }

  async apply(planId: string, confirm: Confirm, drop: number[] = []): Promise<{ results: WriteResult[]; report: string }> {
    const stored = this.plans.get(planId);
    if (!stored) throw refused("There's no prepared plan with that ID. Prepare the Writes again.");
    this.plans.delete(planId);

    const dropped = new Set(drop);
    const plan: Plan = { id: stored.id, writes: stored.writes.filter((w) => !dropped.has(w.number)) };
    const droppedResults: WriteResult[] = stored.writes
      .filter((w) => dropped.has(w.number))
      .map((w) => ({ ...named(w), outcome: "not applied", didNotStick: [], detail: "Dropped by the user before applying." }));
    if (plan.writes.length === 0) {
      return { results: droppedResults, report: renderReport(droppedResults) };
    }

    // Where the client can ask the user directly, their answer is the confirmation. Otherwise
    // Claude Code's approval prompt for this tool, forced by the plugin's hook, already was.
    const confirmed = await confirm(renderConfirmation(plan), plan.writes.length);
    if (confirmed === false) {
      const results = plan.writes.map((w) => ({
        ...named(w),
        outcome: "not applied" as const,
        didNotStick: [],
        detail: "The user didn't confirm, so nothing was sent.",
      }));
      const all = byNumber([...results, ...droppedResults]);
      return { results: all, report: `The user didn't confirm the plan, so nothing was sent to GitLab.\n${renderReport(all)}` };
    }

    const results: WriteResult[] = [];
    const own = new OwnChanges();
    let stopped = false;
    for (const write of plan.writes) {
      if (stopped) {
        results.push({ ...named(write), outcome: "not applied", didNotStick: [] });
        continue;
      }
      const sent: string[] = [];
      try {
        const changed = await this.changedSincePreview(write, own);
        if (changed) {
          stopped = true;
          results.push({ ...named(write), outcome: "not applied", didNotStick: [], detail: changed });
          continue;
        }
        let created: { reference: string } | undefined;
        for (const step of write.steps) {
          const payload = await this.run(step);
          sent.push(...step.sends);
          if (!write.target) created = payload?.workItem;
        }
        const ref = write.target?.ref ?? (created && parseReference(created.reference, this.gitlab.config));
        if (!ref) throw new GitLabError("GitLab didn't return the Work Item it created.", "graphql");
        const after = await this.reader.fetch(ref);
        this.seen.remember(after);
        own.record(write, after);
        results.push({
          ...named(write),
          outcome: "done",
          didNotStick: didNotStick(write.expect, after),
          ...(created ? { created: after.reference, createdUrl: after.url } : {}),
        });
      } catch (error) {
        if (!(error instanceof GitLabError)) throw error;
        stopped = true;
        results.push({ ...named(write), outcome: "failed", didNotStick: [], detail: failure(error.message, write, sent) });
      }
    }
    const all = byNumber([...results, ...droppedResults]);
    return { results: all, report: renderReport(all) };
  }

  /** Why a Write mustn't be sent now, or undefined when it may. */
  private async changedSincePreview(write: PlannedWrite, own: OwnChanges): Promise<string | undefined> {
    const { guard, target } = write;
    if (guard.kind === "none" || !target) return undefined;
    const now = await this.reader.fetch(target.ref);
    if (guard.kind === "version" && now.updatedAt !== own.version(target)) {
      return [
        `${target.reference} changed in GitLab since it was fetched (updated ${now.updatedAt}). Nothing was written to it. Its current state:`,
        ...stateLines(now),
        "Show the user what changed, then prepare a new plan.",
      ].join("\n");
    }
    if (guard.kind === "thread") {
      const comments = own.comments(guard);
      const thread = now.threads.find((t) => t.id === guard.threadId);
      if (!thread || thread.commentCount !== comments) {
        const added = thread ? thread.comments.slice(comments) : [];
        const unshown = (thread?.commentCount ?? 0) - comments - added.length;
        return [
          `The Thread on ${target.reference} has new Comments since it was fetched. Nothing was written. New Comments:`,
          ...added.map((c) => `  ${c.author}: ${excerpt(c.body)}`),
          ...(unshown > 0 ? [`  ${unshown} more, past the first 100; open the Thread in GitLab to read them.`] : []),
          "Show the user the new Comments, then prepare a new plan.",
        ].join("\n");
      }
    }
    return undefined;
  }

  private async run(step: Step): Promise<any> {
    const data = await this.gitlab.gateway.graphql(step.operationName, step.query, { input: step.input });
    const payload = data?.[step.field];
    if (payload?.errors?.length) throw new GitLabError(payload.errors.join("; "), "graphql");
    return payload;
  }
}

/** A result's naming fields: the Write's number and summary, and the URL of the Work Item it names. */
function named(write: PlannedWrite): Pick<WriteResult, "number" | "summary" | "url"> {
  return { number: write.number, summary: write.summary, ...(write.url ? { url: write.url } : {}) };
}

/** Why a Write failed and, when it failed part-way, which of its parts reached GitLab first. */
function failure(message: string, write: PlannedWrite, sent: string[]): string {
  if (sent.length === 0) return message;
  const unsent = write.steps.flatMap((step) => step.sends).filter((part) => !sent.includes(part));
  if (unsent.length === 0) return `It was all sent (${sent.join(", ")}), but reading it back failed: ${message}`;
  return `GitLab refused part of it: ${message}. Sent before that: ${sent.join(", ")}. Not sent: ${unsent.join(", ")}.`;
}

function byNumber(results: WriteResult[]): WriteResult[] {
  return [...results].sort((a, b) => a.number - b.number);
}

function didNotStick(expect: Expectation, after: WorkItem): string[] {
  const problems: string[] = [];
  if (expect.title !== undefined && after.title !== expect.title) problems.push(`title: GitLab kept "${after.title}"`);
  if (expect.description !== undefined && after.description !== expect.description) problems.push("description: GitLab kept a different description");
  if (expect.assignees !== undefined) {
    const kept = after.assignees.map((a) => a.username);
    const same = kept.length === expect.assignees.length && expect.assignees.every((u) => kept.includes(u));
    if (!same) problems.push(`assignees: asked for ${joinOrNone(expect.assignees)}; GitLab kept ${joinOrNone(kept)}`);
  }
  if (expect.milestone !== undefined && (after.milestone?.title ?? null) !== expect.milestone) {
    problems.push(`milestone: GitLab kept ${after.milestone?.title ?? "none"}`);
  }
  if (expect.state !== undefined && after.state !== expect.state) problems.push(`state: GitLab kept ${after.state}`);
  if (expect.dueDate !== undefined && after.dueDate !== expect.dueDate) problems.push(`due date: GitLab kept ${after.dueDate ?? "none"}`);
  if (expect.weight !== undefined && (after.weight ?? null) !== expect.weight) problems.push(`weight: GitLab kept ${after.weight ?? "none"}`);
  if (expect.parent !== undefined && (after.parent?.reference ?? null) !== expect.parent) {
    problems.push(`parent: GitLab kept ${after.parent?.reference ?? "none"}`);
  }
  const linked = after.linkedItems.map((l) => l.reference);
  const notLinked = (expect.linksInclude ?? []).filter((r) => !linked.includes(r));
  const stillLinked = (expect.linksExclude ?? []).filter((r) => linked.includes(r));
  if (notLinked.length) problems.push(`links: not linked to ${joinOrNone(notLinked)}`);
  if (stillLinked.length) problems.push(`links: still linked to ${joinOrNone(stillLinked)}`);
  const labels = after.labels.map((l) => l.title);
  const missing = (expect.labelsInclude ?? []).filter((t) => !labels.includes(t));
  const kept = (expect.labelsExclude ?? []).filter((t) => labels.includes(t));
  if (missing.length || kept.length) problems.push(`labels: GitLab kept ${joinOrNone(labels)}`);
  return problems;
}
