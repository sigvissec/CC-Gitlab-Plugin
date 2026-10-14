// Writes happen in two steps. `prepare` validates a request, checks permissions, and builds
// a preview, storing the exact plan under an ID. `apply` is the only thing that changes
// GitLab: it confirms with the user, checks nothing changed since the data was Fetched,
// applies the Writes in order, re-reads, and reports what didn't stick.
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { GitLabError, type Gateway } from "./gateway.js";
import type { Instance } from "./instance.js";
import type { Lookups } from "./lookups.js";
import type { Reader, Thread, WorkItem } from "./reader.js";
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

export interface CommentRequest {
  kind: "comment";
  reference: string;
  body: string;
  internal?: boolean;
  /** Start a resolvable Thread instead of posting a plain Comment. */
  startThread?: boolean;
}

export interface ThreadRequest {
  kind: "reply" | "resolve";
  /** A Work Item Reference; a Comment link also names the Thread. */
  reference: string;
  /** The Thread's ID from a Fetch, when the Reference doesn't name it. */
  thread?: string;
  body?: string;
}

export interface CreateRequest {
  kind: "create";
  type: "Issue" | "Task";
  /** The project an Issue goes in. */
  project?: string;
  /** The Issue a Task goes under; the Task goes in the Issue's project. */
  parent?: string;
  title: string;
  description?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
  dueDate?: string;
  weight?: number;
  confidential?: boolean;
}

export type WriteRequest = EditRequest | CommentRequest | ThreadRequest | CreateRequest;

export const FOOTER = "_Posted with Claude Code_";

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

/** What must still hold right before a Write is sent. */
type Guard =
  | { kind: "version" } // the Work Item hasn't changed
  | { kind: "thread"; threadId: string; comments: number } // the Thread has no new Comments
  | { kind: "none" }; // a new Comment overwrites nothing

interface PlannedWrite {
  /** Its number in the preview the user saw. */
  number: number;
  summary: string;
  preview: string[];
  /** The Work Item written to; for a creation, filled in once GitLab has created it. */
  target: { ref: WorkItemRef; id: string; reference: string; updatedAt: string };
  creates?: boolean;
  guard: Guard;
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
  /** The Reference of a Work Item this Write created. */
  created?: string;
  url?: string;
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

const CREATE_NOTE = /* GraphQL */ `
mutation CreateNote($input: CreateNoteInput!) {
  createNote(input: $input) { note { id url } errors }
}`;

const CREATE_DISCUSSION = /* GraphQL */ `
mutation CreateDiscussion($input: CreateDiscussionInput!) {
  createDiscussion(input: $input) { note { id url } errors }
}`;

const RESOLVE_THREAD = /* GraphQL */ `
mutation ResolveThread($input: DiscussionToggleResolveInput!) {
  discussionToggleResolve(input: $input) { discussion { id resolved } errors }
}`;

const CREATE = /* GraphQL */ `
mutation CreateWorkItem($input: WorkItemCreateInput!) {
  workItemCreate(input: $input) { workItem { id reference(full: true) webUrl } errors }
}`;

const CHECK_PROJECT = /* GraphQL */ `
query CheckProject($fullPath: ID!) {
  project(fullPath: $fullPath) { id userPermissions { createWorkItem } }
}`;

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
    private readonly instance: Instance,
    private readonly reader: Reader,
    private readonly lookups: Lookups,
  ) {}

  async prepare(requests: WriteRequest[]): Promise<{ plan: Plan; preview: string }> {
    if (requests.length === 0) throw refused("There's nothing to write.");
    if (requests.length > MAX_WRITES) {
      throw refused(`That's ${requests.length} Writes; one preview holds at most ${MAX_WRITES}. Split them into smaller batches.`);
    }
    const writes: PlannedWrite[] = [];
    for (const [i, request] of requests.entries()) writes.push({ ...(await this.plan(request)), number: i + 1 });
    const plan: Plan = { id: randomUUID(), writes };
    this.plans.set(plan.id, plan);
    return { plan, preview: renderPreview(plan) };
  }

  private plan(request: WriteRequest): Promise<Omit<PlannedWrite, "number">> {
    switch (request.kind) {
      case "edit":
        return this.planEdit(request);
      case "comment":
        return this.planComment(request);
      case "reply":
      case "resolve":
        return this.planThread(request);
      case "create":
        return this.planCreate(request);
    }
  }

  private async planCreate(request: CreateRequest): Promise<Omit<PlannedWrite, "number">> {
    let fullPath: string;
    let parent: WorkItem | undefined;
    if (request.type === "Task") {
      if (!request.parent) throw refused("A Task needs a parent Issue: pass its Reference as parent.");
      parent = await this.reader.fetch(parseReference(request.parent, this.config));
      if (parent.type !== "Issue") throw refused(`${parent.reference} is a ${parent.type}; a Task's parent must be an Issue.`);
      if (!parent.permissions.adminParentLink) throw refused(`Your token can't add Tasks under ${parent.reference}. Nothing was prepared.`);
      fullPath = parent.fullPath;
    } else {
      if (!request.project) throw refused("An Issue needs a project: pass its full path as project, for example acme/app.");
      if (request.parent) throw refused("An Issue's parent would be an Epic, and Epics aren't supported.");
      await this.instance.requireSupported();
      const data = await this.gateway.graphql("CheckProject", CHECK_PROJECT, { fullPath: request.project });
      if (!data?.project) throw new GitLabError(`${request.project}: not found, or your token can't see it.`, "not-found");
      if (!data.project.userPermissions?.createWorkItem) throw refused(`Your token can't create Work Items in ${request.project}. Nothing was prepared.`);
      fullPath = request.project;
    }
    if (request.weight !== undefined && !(await this.instance.probe()).enterprise) {
      throw refused("Weight isn't available: it needs GitLab EE on Premium or above. Nothing was prepared.");
    }

    const description = request.description ? this.withFooter(request.description) : this.config.footer ? FOOTER : undefined;
    const confidential = request.confidential === true;
    const input: Record<string, unknown> = {
      namespacePath: fullPath,
      workItemTypeId: await this.lookups.typeId(fullPath, request.type),
      title: request.title,
      confidential,
    };
    const expect: Expectation = { title: request.title };
    const preview = [
      request.type === "Task" ? `Create a Task under ${parent!.reference} (${parent!.url})` : `Create an Issue in ${fullPath}`,
      `  title: ${request.title}`,
    ];
    if (description !== undefined) {
      input.descriptionWidget = { description };
      expect.description = description;
      preview.push("  description:", ...quote(description));
    }
    if (request.labels?.length) {
      input.labelsWidget = { labelIds: await Promise.all(request.labels.map((t) => this.lookups.labelId(fullPath, t))) };
      expect.labelsInclude = request.labels;
      preview.push(`  labels: ${list(request.labels)}`);
    }
    if (request.assignees?.length) {
      input.assigneesWidget = { assigneeIds: await this.lookups.userIds(request.assignees) };
      expect.assignees = request.assignees;
      preview.push(`  assignees: ${list(request.assignees)}`);
    }
    if (request.milestone) {
      input.milestoneWidget = { milestoneId: await this.lookups.milestoneId(fullPath, request.milestone) };
      expect.milestone = request.milestone;
      preview.push(`  milestone: ${request.milestone}`);
    }
    if (request.dueDate) {
      input.startAndDueDateWidget = { dueDate: request.dueDate };
      expect.dueDate = request.dueDate;
      preview.push(`  due date: ${request.dueDate}`);
    }
    if (request.weight !== undefined) {
      input.weightWidget = { weight: request.weight };
      expect.weight = request.weight;
      preview.push(`  weight: ${request.weight}`);
    }
    if (parent) {
      input.hierarchyWidget = { parentId: parent.id };
      expect.parent = parent.reference;
    }
    preview.push(`  confidential: ${confidential ? "yes" : "no"}`);

    return {
      summary: request.type === "Task" ? `Create a Task under ${parent!.reference}` : `Create an Issue in ${fullPath}`,
      preview,
      target: { ref: { fullPath, iid: "" }, id: "", reference: "", updatedAt: "" },
      creates: true,
      guard: { kind: "none" },
      steps: [{ operationName: "CreateWorkItem", query: CREATE, input, field: "workItemCreate" }],
      expect,
    };
  }

  private withFooter(body: string): string {
    return this.config.footer ? `${body}\n\n${FOOTER}` : body;
  }

  private async planComment(request: CommentRequest): Promise<Omit<PlannedWrite, "number">> {
    const ref = parseReference(request.reference, this.config);
    const item = await this.reader.fetch(ref);
    if (!item.permissions.createNote) throw refused(`On ${item.reference}, your token can't post Comments. Nothing was prepared.`);
    const internal = request.internal === true;
    if (internal && !item.permissions.markNoteAsInternal) {
      throw refused(
        `Your role on ${item.reference} can't post internal Comments (that needs Reporter or higher). Ask the user whether to post it publicly instead, or cancel. Nothing was prepared.`,
      );
    }
    const body = this.withFooter(request.body);
    const what = request.startThread ? "New Thread" : "Comment";
    return {
      summary: `${what} on ${item.reference}`,
      preview: [`${what} on ${item.reference} (${internal ? "internal" : "public"}) ${item.url}`, ...quote(body)],
      target: targetOf(ref, item),
      guard: { kind: "none" },
      steps: [
        request.startThread
          ? { operationName: "CreateDiscussion", query: CREATE_DISCUSSION, input: { noteableId: item.id, body, internal }, field: "createDiscussion" }
          : { operationName: "CreateNote", query: CREATE_NOTE, input: { noteableId: item.id, body, internal }, field: "createNote" },
      ],
      expect: {},
    };
  }

  private async planThread(request: ThreadRequest): Promise<Omit<PlannedWrite, "number">> {
    const ref = parseReference(request.reference, this.config);
    const item = await this.reader.fetch(ref);
    const thread = findThread(item, request.thread, ref.noteId);
    const first = thread.comments[0];
    const internal = Boolean(first?.internal);
    const comments = this.reader.seenThreadSize(thread.id) ?? thread.comments.length;
    if (thread.comments.length !== comments) {
      throw refused(
        `That Thread on ${item.reference} has new Comments since you fetched it. Fetch ${item.reference} again and show the user the new Comments first. Nothing was prepared.`,
      );
    }
    const guard: Guard = { kind: "thread", threadId: thread.id, comments };
    const replies = thread.comments.length - 1;
    const about = `"${excerpt(first?.body ?? "")}" by ${first?.author ?? "unknown"}, ${replies} repl${replies === 1 ? "y" : "ies"}`;

    if (request.kind === "reply") {
      if (!request.body) throw refused("A reply needs a body.");
      if (!item.permissions.createNote) throw refused(`On ${item.reference}, your token can't post Comments. Nothing was prepared.`);
      const body = this.withFooter(request.body);
      return {
        summary: `Reply on ${item.reference}`,
        preview: [`Reply on ${item.reference} (${internal ? "internal, like its Thread" : "public, like its Thread"}) in the Thread ${about}`, ...quote(body)],
        target: targetOf(ref, item),
        guard,
        steps: [{ operationName: "CreateNote", query: CREATE_NOTE, input: { noteableId: item.id, discussionId: thread.replyId, body }, field: "createNote" }],
        expect: {},
      };
    }

    if (!thread.resolvable) throw refused(`That's a plain Comment on ${item.reference}, not a Thread, so it can't be resolved.`);
    if (thread.resolved) throw refused(`That Thread on ${item.reference} is already resolved.`);
    if (!thread.canResolve) throw refused(`On ${item.reference}, your token can't resolve that Thread. Nothing was prepared.`);
    return {
      summary: `Resolve a Thread on ${item.reference}`,
      preview: [`Resolve the Thread on ${item.reference}: ${about}`],
      target: targetOf(ref, item),
      guard,
      steps: [{ operationName: "ResolveThread", query: RESOLVE_THREAD, input: { id: thread.id, resolve: true }, field: "discussionToggleResolve" }],
      expect: {},
    };
  }

  private async planEdit(request: EditRequest): Promise<Omit<PlannedWrite, "number">> {
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
    return { summary: `Edit ${item.reference}`, preview, target: targetOf(ref, item), guard: { kind: "version" }, steps, expect };
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

  async apply(planId: string, confirm: Confirm, drop: number[] = []): Promise<{ results: WriteResult[]; report: string }> {
    const stored = this.plans.get(planId);
    if (!stored) throw refused("There's no prepared plan with that ID. Prepare the Writes again.");
    this.plans.delete(planId);

    const dropped = new Set(drop);
    const plan: Plan = { id: stored.id, writes: stored.writes.filter((_, i) => !dropped.has(i + 1)) };
    const droppedResults: WriteResult[] = stored.writes
      .map((w, i) => ({ w, index: i + 1 }))
      .filter(({ index }) => dropped.has(index))
      .map(({ w, index }) => ({ index, summary: w.summary, outcome: "not applied", didNotStick: [], detail: "Dropped by the user before applying." }));
    if (plan.writes.length === 0) {
      return { results: droppedResults, report: renderReport(droppedResults) };
    }
    const originalIndex = (i: number) => plan.writes[i]!.number;

    // Where the client can ask the user directly, their answer is the confirmation. Otherwise
    // Claude Code's approval prompt for this tool, forced by the plugin's hook, already was.
    const confirmed = await confirm(`${renderPreview(plan)}\n\nApply ${plan.writes.length === 1 ? "this Write" : `these ${plan.writes.length} Writes`} to GitLab?`);
    if (confirmed === false) {
      const results = plan.writes.map((w, i) => ({
        index: originalIndex(i),
        summary: w.summary,
        outcome: "not applied" as const,
        didNotStick: [],
        detail: "The user didn't confirm, so nothing was sent.",
      }));
      const all = byIndex([...results, ...droppedResults]);
      return { results: all, report: `The user didn't confirm the plan, so nothing was sent to GitLab.\n${renderReport(all)}` };
    }

    const results: WriteResult[] = [];
    // Each Work Item's expected version moves forward as this plan's own Writes land.
    const expected = new Map<string, string>();
    let stopped = false;
    for (const [i, write] of plan.writes.entries()) {
      const index = originalIndex(i);
      if (stopped) {
        results.push({ index, summary: write.summary, outcome: "not applied", didNotStick: [] });
        continue;
      }
      try {
        const changed = await this.changedSincePreview(write, expected);
        if (changed) {
          stopped = true;
          results.push({ index, summary: write.summary, outcome: "not applied", didNotStick: [], detail: changed });
          continue;
        }
        let created: { reference: string; webUrl: string } | undefined;
        for (const step of write.steps) {
          const payload = await this.run(step);
          if (write.creates) created = payload?.workItem;
        }
        const ref = created ? parseReference(created.reference, this.config) : write.target.ref;
        const after = await this.reader.fetch(ref);
        this.reader.remember(after);
        expected.set(after.id, after.updatedAt);
        results.push({
          index,
          summary: write.summary,
          outcome: "done",
          didNotStick: didNotStick(write.expect, after),
          ...(created ? { created: after.reference, url: after.url } : {}),
        });
      } catch (error) {
        if (!(error instanceof GitLabError)) throw error;
        stopped = true;
        results.push({ index, summary: write.summary, outcome: "failed", didNotStick: [], detail: error.message });
      }
    }
    const all = byIndex([...results, ...droppedResults]);
    return { results: all, report: renderReport(all) };
  }

  /** Why a Write mustn't be sent now, or undefined when it may. */
  private async changedSincePreview(write: PlannedWrite, expected: Map<string, string>): Promise<string | undefined> {
    const { guard, target } = write;
    if (guard.kind === "none") return undefined;
    const now = await this.reader.fetch(target.ref);
    if (guard.kind === "version" && now.updatedAt !== (expected.get(target.id) ?? target.updatedAt)) {
      return `${target.reference} changed in GitLab since it was fetched (updated ${now.updatedAt}). Nothing was written to it; fetch it again and prepare a new plan.`;
    }
    if (guard.kind === "thread") {
      const thread = now.threads.find((t) => t.id === guard.threadId);
      if (!thread || thread.comments.length !== guard.comments) {
        return `The Thread on ${target.reference} has new Comments since it was fetched. Nothing was written; fetch it again and show the user the new Comments first.`;
      }
    }
    return undefined;
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

function byIndex(results: WriteResult[]): WriteResult[] {
  return [...results].sort((a, b) => a.index - b.index);
}

function targetOf(ref: WorkItemRef, item: WorkItem): PlannedWrite["target"] {
  return { ref, id: item.id, reference: item.reference, updatedAt: item.updatedAt };
}

function quote(body: string): string[] {
  return body.split("\n").map((line) => `  > ${line}`);
}

function excerpt(body: string, length = 80): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

/** The Thread a reply or resolution is about: named by ID, or by a Comment link's note. */
function findThread(item: WorkItem, threadId: string | undefined, noteId: string | undefined): Thread {
  const wanted = threadId && !threadId.startsWith("gid://") ? `gid://gitlab/Discussion/${threadId}` : threadId;
  const thread = wanted
    ? item.threads.find((t) => t.id === wanted)
    : noteId
      ? item.threads.find((t) => t.comments.some((c) => c.id === `gid://gitlab/Note/${noteId}`))
      : undefined;
  if (!thread) {
    throw refused(
      wanted || noteId
        ? `That Thread isn't on ${item.reference}, or your token can't see it.`
        : `Say which Thread on ${item.reference}: pass its ID from a Fetch, or use a link to one of its Comments.`,
    );
  }
  return thread;
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
  for (const write of plan.writes) {
    lines.push(`${write.number}. ${write.preview[0]}`, ...write.preview.slice(1));
  }
  return lines.join("\n");
}

function renderReport(results: WriteResult[]): string {
  return results
    .map((r) => {
      const head = `${r.index}. ${r.summary}: ${r.outcome}${r.created ? `, created ${r.created} ${r.url}` : ""}`;
      const notes = [r.detail ? `   ${r.detail}` : "", ...r.didNotStick.map((d) => `   didn't stick: ${d}`)].filter(Boolean);
      return [head, ...notes].join("\n");
    })
    .join("\n");
}
