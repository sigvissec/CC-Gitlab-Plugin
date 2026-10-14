// Writes happen in two steps. `prepare` validates a request, checks permissions, and builds
// a preview, storing the exact plan under an ID. `apply` is the only thing that changes
// GitLab: it confirms with the user, checks nothing changed since the data was Fetched,
// applies the Writes in order, re-reads, and reports what didn't stick.
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { GitLabError, type Gateway } from "./gateway.js";
import type { Lookups } from "./lookups.js";
import type { Reader, WorkItem } from "./reader.js";
import { lineDiff } from "./diff.js";
import { parseReference, refused, type WorkItemRef } from "./references.js";

export const MAX_WRITES = 20;

export interface EditRequest {
  kind: "edit";
  reference: string;
  title?: string;
  description?: string;
  addLabels?: string[];
  removeLabels?: string[];
  /** Replaces the assignees. */
  assignees?: string[];
  milestone?: string | null;
  state?: "close" | "reopen";
  dueDate?: string | null;
  weight?: number | null;
  /** A parent's Reference, or null to remove the parent. */
  parent?: string | null;
  addLinks?: { reference: string; linkType: "relates_to" | "blocks" | "is_blocked_by" }[];
  removeLinks?: string[];
}

export type WriteRequest = EditRequest;

interface Step {
  operationName: string;
  query: string;
  input: Record<string, unknown>;
  /** The mutation's payload field, whose `errors` array GitLab fills on failure. */
  field: string;
}

interface Expectation {
  title?: string;
  description?: string;
  labelsInclude?: string[];
  labelsExclude?: string[];
  assignees?: string[];
  milestone?: string | null;
  state?: "open" | "closed";
  dueDate?: string | null;
  weight?: number | null;
  parent?: string | null;
  linksInclude?: string[];
  linksExclude?: string[];
}

interface PlannedWrite {
  summary: string;
  preview: string[];
  target: { ref: WorkItemRef; id: string; reference: string; updatedAt: string };
  steps: Step[];
  expect: Expectation;
}

/** Asks the user to confirm a preview: true or false, or "unsupported" when the client can't ask. */
export type Confirm = (preview: string) => Promise<boolean | "unsupported">;

export interface Plan {
  id: string;
  writes: PlannedWrite[];
}

export interface WriteResult {
  index: number;
  summary: string;
  outcome: "done" | "failed" | "not applied";
  didNotStick: string[];
  detail?: string;
}

const ADD_LINKS = /* GraphQL */ `
mutation AddLinkedItems($input: WorkItemAddLinkedItemsInput!) {
  workItemAddLinkedItems(input: $input) { workItem { id } errors }
}`;

const REMOVE_LINKS = /* GraphQL */ `
mutation RemoveLinkedItems($input: WorkItemRemoveLinkedItemsInput!) {
  workItemRemoveLinkedItems(input: $input) { workItem { id } errors }
}`;

const LINK_TYPES = { relates_to: "RELATED", blocks: "BLOCKS", is_blocked_by: "BLOCKED_BY" } as const;

const UPDATE = /* GraphQL */ `
mutation UpdateWorkItem($input: WorkItemUpdateInput!) {
  workItemUpdate(input: $input) { workItem { id } errors }
}`;

const list = (values: string[]) => (values.length ? values.join(", ") : "none");

export class Writes {
  private readonly plans = new Map<string, Plan>();

  constructor(
    private readonly config: Config,
    private readonly gateway: Gateway,
    private readonly reader: Reader,
    private readonly lookups: Lookups,
  ) {}

  async prepare(requests: WriteRequest[]): Promise<{ plan: Plan; preview: string }> {
    if (requests.length === 0) throw refused("There's nothing to write.");
    if (requests.length > MAX_WRITES) {
      throw refused(`That's ${requests.length} Writes; one preview holds at most ${MAX_WRITES}. Split them into smaller batches.`);
    }
    const writes: PlannedWrite[] = [];
    for (const request of requests) writes.push(await this.planEdit(request));
    const plan: Plan = { id: randomUUID(), writes };
    this.plans.set(plan.id, plan);
    return { plan, preview: renderPreview(plan) };
  }

  private async planEdit(request: EditRequest): Promise<PlannedWrite> {
    const ref = parseReference(request.reference, this.config);
    const item = await this.current(ref);
    requirePermissions(item, request);
    const preview: string[] = [`Edit ${item.reference} (${item.url})`];
    const input: Record<string, unknown> = { id: item.id };
    const expect: Expectation = {};

    if (request.title !== undefined && request.title !== item.title) {
      preview.push(`  title: ${item.title} → ${request.title}`);
      input.title = request.title;
      expect.title = request.title;
    }

    if (request.description !== undefined && request.description !== item.description) {
      preview.push("  description:", ...lineDiff(item.description, request.description).map((line) => `    ${line}`));
      input.descriptionWidget = { description: request.description };
      expect.description = request.description;
    }

    const add = request.addLabels ?? [];
    const remove = request.removeLabels ?? [];
    if (add.length || remove.length) {
      const current = item.labels.map((l) => l.title);
      const after = [...current.filter((t) => !remove.includes(t)), ...add.filter((t) => !current.includes(t))];
      preview.push(`  labels: ${list(current)} → ${list(after)}`);
      input.labelsWidget = {
        addLabelIds: await Promise.all(add.map((t) => this.lookups.labelId(ref.fullPath, t))),
        removeLabelIds: item.labels.filter((l) => remove.includes(l.title)).map((l) => l.id),
      };
      expect.labelsInclude = add;
      expect.labelsExclude = remove;
    }

    if (request.assignees !== undefined) {
      preview.push(`  assignees: ${list(item.assignees.map((a) => a.username))} → ${list(request.assignees)}`);
      input.assigneesWidget = { assigneeIds: await this.lookups.userIds(request.assignees) };
      expect.assignees = request.assignees;
    }

    if (request.milestone !== undefined) {
      preview.push(`  milestone: ${item.milestone?.title ?? "none"} → ${request.milestone ?? "none"}`);
      input.milestoneWidget = { milestoneId: request.milestone === null ? null : await this.lookups.milestoneId(ref.fullPath, request.milestone) };
      expect.milestone = request.milestone;
    }

    if (request.state !== undefined) {
      const target = request.state === "close" ? "closed" : "open";
      preview.push(`  state: ${item.state} → ${target}`);
      input.stateEvent = request.state === "close" ? "CLOSE" : "REOPEN";
      expect.state = target;
    }

    if (request.dueDate !== undefined) {
      preview.push(`  due date: ${item.dueDate ?? "none"} → ${request.dueDate ?? "none"}`);
      input.startAndDueDateWidget = { dueDate: request.dueDate };
      expect.dueDate = request.dueDate;
    }

    if (request.weight !== undefined) {
      if (item.weight === undefined) {
        throw refused(`On ${item.reference}, weight isn't available: it needs GitLab EE on Premium or above. Nothing was prepared.`);
      }
      preview.push(`  weight: ${item.weight ?? "none"} → ${request.weight ?? "none"}`);
      input.weightWidget = { weight: request.weight };
      expect.weight = request.weight;
    }

    if (request.parent !== undefined) {
      const parent = request.parent === null ? null : await this.reader.resolve(parseReference(request.parent, this.config));
      preview.push(`  parent: ${item.parent?.reference ?? "none"} → ${parent?.reference ?? "none"}`);
      input.hierarchyWidget = { parentId: parent?.id ?? null };
      expect.parent = parent?.reference ?? null;
    }

    const steps: Step[] = [];
    if (Object.keys(input).length > 1) steps.push({ operationName: "UpdateWorkItem", query: UPDATE, input, field: "workItemUpdate" });

    const byType = new Map<string, string[]>();
    for (const link of request.addLinks ?? []) {
      const target = await this.reader.resolve(parseReference(link.reference, this.config));
      preview.push(`  link: ${link.linkType.replaceAll("_", " ")} ${target.reference}`);
      byType.set(LINK_TYPES[link.linkType], [...(byType.get(LINK_TYPES[link.linkType]) ?? []), target.id]);
      (expect.linksInclude ??= []).push(target.reference);
    }
    for (const [linkType, ids] of byType) {
      steps.push({ operationName: "AddLinkedItems", query: ADD_LINKS, input: { id: item.id, workItemsIds: ids, linkType }, field: "workItemAddLinkedItems" });
    }
    const unlink: string[] = [];
    for (const reference of request.removeLinks ?? []) {
      const target = await this.reader.resolve(parseReference(reference, this.config));
      preview.push(`  unlink: ${target.reference}`);
      unlink.push(target.id);
      (expect.linksExclude ??= []).push(target.reference);
    }
    if (unlink.length) {
      steps.push({ operationName: "RemoveLinkedItems", query: REMOVE_LINKS, input: { id: item.id, workItemsIds: unlink }, field: "workItemRemoveLinkedItems" });
    }

    if (steps.length === 0) throw refused(`The Edit to ${item.reference} doesn't change anything.`);
    return {
      summary: `Edit ${item.reference}`,
      preview,
      target: { ref, id: item.id, reference: item.reference, updatedAt: item.updatedAt },
      steps,
      expect,
    };
  }

  /** Fetches a Work Item for a Write, refusing if it changed since Claude last saw it. */
  private async current(ref: WorkItemRef): Promise<WorkItem> {
    const item = await this.reader.fetch(ref);
    const seen = this.reader.seenVersion(item.id);
    if (seen && seen !== item.updatedAt) {
      this.reader.remember(item);
      throw refused(
        [
          `${item.reference} changed in GitLab since you fetched it (now updated ${item.updatedAt}). Nothing was prepared. Its current state:`,
          ...stateLines(item),
          "Review the change with the user, then prepare the Write again.",
        ].join("\n"),
      );
    }
    return item;
  }

  async apply(planId: string, confirm: Confirm): Promise<{ results: WriteResult[]; report: string }> {
    const plan = this.plans.get(planId);
    if (!plan) throw refused("There's no prepared plan with that ID. Prepare the Writes again.");
    this.plans.delete(planId);

    // Where the client can ask the user directly, their answer is the confirmation. Otherwise
    // Claude Code's approval prompt for this tool, forced by the plugin's hook, already was.
    const confirmed = await confirm(`${renderPreview(plan)}\n\nApply ${plan.writes.length === 1 ? "this Write" : `these ${plan.writes.length} Writes`} to GitLab?`);
    if (confirmed === false) {
      const results = plan.writes.map((w, i) => ({
        index: i + 1,
        summary: w.summary,
        outcome: "not applied" as const,
        didNotStick: [],
        detail: "The user didn't confirm, so nothing was sent.",
      }));
      return { results, report: `The user didn't confirm the plan, so nothing was sent to GitLab.\n${renderReport(results)}` };
    }

    const results: WriteResult[] = [];
    // Each Work Item's expected version moves forward as this plan's own Writes land.
    const expected = new Map<string, string>();
    let stopped = false;
    for (const [i, write] of plan.writes.entries()) {
      const index = i + 1;
      if (stopped) {
        results.push({ index, summary: write.summary, outcome: "not applied", didNotStick: [] });
        continue;
      }
      try {
        const now = await this.reader.fetch(write.target.ref);
        if (now.updatedAt !== (expected.get(write.target.id) ?? write.target.updatedAt)) {
          stopped = true;
          results.push({
            index,
            summary: write.summary,
            outcome: "not applied",
            didNotStick: [],
            detail: `${write.target.reference} changed in GitLab since it was fetched (updated ${now.updatedAt}). Nothing was written to it; fetch it again and prepare a new plan.`,
          });
          continue;
        }
        for (const step of write.steps) await this.run(step);
        const after = await this.reader.fetch(write.target.ref);
        this.reader.remember(after);
        expected.set(write.target.id, after.updatedAt);
        results.push({ index, summary: write.summary, outcome: "done", didNotStick: didNotStick(write.expect, after) });
      } catch (error) {
        if (!(error instanceof GitLabError)) throw error;
        stopped = true;
        results.push({ index, summary: write.summary, outcome: "failed", didNotStick: [], detail: error.message });
      }
    }
    return { results, report: renderReport(results) };
  }

  private async run(step: Step): Promise<any> {
    const data = await this.gateway.graphql(step.operationName, step.query, { input: step.input });
    const payload = data?.[step.field];
    if (payload?.errors?.length) throw new GitLabError(payload.errors.join("; "), "graphql");
    return payload;
  }
}

/** Which of GitLab's per-Work Item permissions each part of an Edit needs. */
function requirePermissions(item: WorkItem, request: EditRequest): void {
  const needs: [boolean, string, string][] = [
    [request.title !== undefined || request.description !== undefined || request.state !== undefined, "updateWorkItem", "edit its title, description, or state"],
    [
      Boolean(request.addLabels?.length || request.removeLabels?.length) ||
        request.assignees !== undefined ||
        request.milestone !== undefined ||
        request.dueDate !== undefined ||
        request.weight !== undefined,
      "setWorkItemMetadata",
      "change its labels, assignees, milestone, or dates",
    ],
  ];
  needs.push(
    [request.parent !== undefined, "adminParentLink", "change its parent"],
    [Boolean(request.addLinks?.length || request.removeLinks?.length), "adminWorkItemLink", "change its Linked Items"],
  );
  const denied = needs.filter(([wanted, permission]) => wanted && !item.permissions[permission]).map(([, , what]) => what);
  if (denied.length) throw refused(`On ${item.reference}, your token can't ${denied.join(", or ")}. Nothing was prepared.`);
}

function stateLines(item: WorkItem): string[] {
  return [
    `  ${item.title} [${item.type}, ${item.state}]`,
    `  labels: ${list(item.labels.map((l) => l.title))}`,
    `  assignees: ${list(item.assignees.map((a) => a.username))}`,
    `  milestone: ${item.milestone?.title ?? "none"}, due: ${item.dueDate ?? "none"}`,
  ];
}

function didNotStick(expect: Expectation, after: WorkItem): string[] {
  const problems: string[] = [];
  if (expect.title !== undefined && after.title !== expect.title) problems.push(`title: GitLab kept "${after.title}"`);
  if (expect.description !== undefined && after.description !== expect.description) problems.push("description: GitLab kept a different description");
  if (expect.assignees !== undefined) {
    const kept = after.assignees.map((a) => a.username);
    const same = kept.length === expect.assignees.length && expect.assignees.every((u) => kept.includes(u));
    if (!same) problems.push(`assignees: asked for ${list(expect.assignees)}; GitLab kept ${list(kept)}`);
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
  if (notLinked.length) problems.push(`links: not linked to ${list(notLinked)}`);
  if (stillLinked.length) problems.push(`links: still linked to ${list(stillLinked)}`);
  const labels = after.labels.map((l) => l.title);
  const missing = (expect.labelsInclude ?? []).filter((t) => !labels.includes(t));
  const kept = (expect.labelsExclude ?? []).filter((t) => labels.includes(t));
  if (missing.length || kept.length) problems.push(`labels: GitLab kept ${list(labels)}`);
  return problems;
}

function renderPreview(plan: Plan): string {
  const lines = [`Plan ${plan.id}: ${plan.writes.length} Write${plan.writes.length === 1 ? "" : "s"}. Nothing has been sent yet.`];
  for (const [i, write] of plan.writes.entries()) {
    lines.push(`${i + 1}. ${write.preview[0]}`, ...write.preview.slice(1));
  }
  return lines.join("\n");
}

function renderReport(results: WriteResult[]): string {
  return results
    .map((r) => {
      const head = `${r.index}. ${r.summary}: ${r.outcome}`;
      const notes = [r.detail ? `   ${r.detail}` : "", ...r.didNotStick.map((d) => `   didn't stick: ${d}`)].filter(Boolean);
      return [head, ...notes].join("\n");
    })
    .join("\n");
}
