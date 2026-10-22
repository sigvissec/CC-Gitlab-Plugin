// Turns a Write request into a planned Write: validated, permission-checked, previewed, and
// reduced to the exact GitLab mutations to send, with what must still hold before sending
// them and what GitLab should show afterwards.
import type { GitLab } from "../gitlab.js";
import type { Lookups } from "../lookups.js";
import { threadWithComment, type Reader, type Thread, type WorkItem } from "../reader.js";
import type { Seen } from "../seen.js";
import { lineDiff } from "../diff.js";
import { notFound, parseReference, refused, type ParsedReference } from "../references.js";
import { excerpt, joinOrNone, quickActionWarning, quote, stateLines } from "./render.js";
import type { CommentRequest, CreateRequest, EditRequest, ThreadRequest, WriteRequest } from "./requests.js";

export const FOOTER = "_Posted with Claude Code_";

export interface Step {
  operationName: string;
  query: string;
  input: Record<string, unknown>;
  /** The mutation's payload field, whose `errors` array GitLab fills on failure. */
  field: string;
  /** What this step sends, as the preview names it, to report a Write that fails part-way. */
  sends: string[];
}

export interface Expectation {
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
export type Guard =
  | { kind: "version" } // the Work Item hasn't changed
  | { kind: "thread"; threadId: string; comments: number } // the Thread has no new Comments
  | { kind: "none" }; // a new Comment overwrites nothing

/** A Work Item a Write changes, as it was when the Write was planned. */
export interface Target {
  ref: ParsedReference;
  id: string;
  reference: string;
  updatedAt: string;
}

export interface PlannedWrite {
  /** Its number in the preview the user saw. */
  number: number;
  summary: string;
  /** The URL of the Work Item the summary names, if it names one. */
  url?: string;
  preview: string[];
  /** The Work Item written to; absent for a creation, whose Work Item doesn't exist yet. */
  target?: Target;
  guard: Guard;
  steps: Step[];
  expect: Expectation;
}

export interface Plan {
  id: string;
  writes: PlannedWrite[];
}

const ADD_LINKS = /* GraphQL */ `
mutation AddLinkedItems($input: WorkItemAddLinkedItemsInput!) {
  workItemAddLinkedItems(input: $input) { workItem { id } errors }
}`;

const REMOVE_LINKS = /* GraphQL */ `
mutation RemoveLinkedItems($input: WorkItemRemoveLinkedItemsInput!) {
  workItemRemoveLinkedItems(input: $input) { workItem { id } errors }
}`;

/** GitLab links or unlinks at most this many Work Items per request. */
const LINKS_PER_REQUEST = 10;

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += LINKS_PER_REQUEST) out.push(items.slice(i, i + LINKS_PER_REQUEST));
  return out;
}

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

/** How GitLab's create and update mutations take each field. */
const WIDGETS = {
  description: (description: string) => ({ descriptionWidget: { description } }),
  assignees: (assigneeIds: string[]) => ({ assigneesWidget: { assigneeIds } }),
  milestone: (milestoneId: string | null) => ({ milestoneWidget: { milestoneId } }),
  dueDate: (dueDate: string | null) => ({ startAndDueDateWidget: { dueDate } }),
  weight: (weight: number | null) => ({ weightWidget: { weight } }),
  parent: (parentId: string | null) => ({ hierarchyWidget: { parentId } }),
};

/** A Write's field changes as they build up: the preview, the mutation input, and what should stick. */
class Changes {
  readonly preview: string[] = [];
  readonly expect: Expectation = {};
  /** The fields changed, as the preview names them. */
  readonly fields: string[] = [];

  constructor(readonly input: Record<string, unknown>) {}

  add(field: string, preview: string[], input: Record<string, unknown>, expect: Expectation): void {
    this.fields.push(field);
    this.preview.push(...preview);
    Object.assign(this.input, input);
    Object.assign(this.expect, expect);
  }
}

const weightUnavailable = (where: string) =>
  refused(`${where}, weight isn't available: it needs GitLab EE on Premium or above. Nothing was prepared.`);

const cantComment = (item: WorkItem) => refused(`On ${item.reference}, your token can't post Comments. Nothing was prepared.`);

export class Planner {
  constructor(
    private readonly gitlab: GitLab,
    private readonly reader: Reader,
    private readonly seen: Seen,
    private readonly lookups: Lookups,
  ) {}

  plan(request: WriteRequest): Promise<Omit<PlannedWrite, "number">> {
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

  private parse(reference: string): ParsedReference {
    return parseReference(reference, this.gitlab.config);
  }

  private async planCreate(request: CreateRequest): Promise<Omit<PlannedWrite, "number">> {
    let fullPath: string;
    let parent: WorkItem | undefined;
    if (request.type === "Task") {
      if (!request.parent) throw refused("A Task needs a parent Issue: pass its Reference as parent.");
      parent = await this.reader.fetch(this.parse(request.parent));
      if (parent.type !== "Issue") throw refused(`${parent.reference} is a ${parent.type}; a Task's parent must be an Issue.`);
      if (!parent.permissions.adminParentLink) throw refused(`Your token can't add Tasks under ${parent.reference}. Nothing was prepared.`);
      fullPath = parent.fullPath;
    } else {
      if (!request.project) throw refused("An Issue needs a project: pass its full path as project, for example acme/app.");
      if (request.parent) throw refused("An Issue's parent would be an Epic, and Epics aren't supported.");
      await this.gitlab.instance.requireSupported();
      const data = await this.gitlab.gateway.graphql("CheckProject", CHECK_PROJECT, { fullPath: request.project });
      if (!data?.project) throw notFound(request.project, this.gitlab.config);
      if (!data.project.userPermissions?.createWorkItem) throw refused(`Your token can't create Work Items in ${request.project}. Nothing was prepared.`);
      fullPath = request.project;
    }
    if (request.weight !== undefined && !(await this.lookups.typeOffers(fullPath, request.type, "WEIGHT"))) {
      throw weightUnavailable(`In ${fullPath}`);
    }

    const description = request.description ? this.withFooter(request.description) : this.gitlab.config.footer ? FOOTER : undefined;
    const confidential = request.confidential === true;
    const changes = new Changes({ namespacePath: fullPath, workItemTypeId: await this.lookups.typeId(fullPath, request.type), confidential });
    changes.add("title", [`  title: ${request.title}`], { title: request.title }, { title: request.title });
    if (description !== undefined) {
      changes.add("description", ["  description:", ...quote(description), ...quickActionWarning(description, "saving")], WIDGETS.description(description), { description });
    }
    if (request.labels?.length) {
      const labelIds = await Promise.all(request.labels.map((t) => this.lookups.labelId(fullPath, t)));
      changes.add("labels", [`  labels: ${joinOrNone(request.labels)}`], { labelsWidget: { labelIds } }, { labelsInclude: request.labels });
    }
    if (request.assignees?.length) {
      changes.add("assignees", [`  assignees: ${joinOrNone(request.assignees)}`], WIDGETS.assignees(await this.lookups.userIds(request.assignees)), { assignees: request.assignees });
    }
    if (request.milestone) {
      changes.add("milestone", [`  milestone: ${request.milestone}`], WIDGETS.milestone(await this.lookups.milestoneId(fullPath, request.milestone)), { milestone: request.milestone });
    }
    if (request.dueDate) {
      changes.add("due date", [`  due date: ${request.dueDate}`], WIDGETS.dueDate(request.dueDate), { dueDate: request.dueDate });
    }
    if (request.weight !== undefined) {
      changes.add("weight", [`  weight: ${request.weight}`], WIDGETS.weight(request.weight), { weight: request.weight });
    }
    if (parent) changes.add("parent", [], WIDGETS.parent(parent.id), { parent: parent.reference });

    const summary = parent ? `Create a Task under ${parent.reference}` : `Create an Issue in ${fullPath}`;
    return {
      summary,
      ...(parent ? { url: parent.url } : {}),
      preview: [parent ? `${summary} (${parent.url})` : summary, ...changes.preview, `  confidential: ${confidential ? "yes" : "no"}`],
      guard: { kind: "none" },
      steps: [{ operationName: "CreateWorkItem", query: CREATE, input: changes.input, field: "workItemCreate", sends: [summary] }],
      expect: changes.expect,
    };
  }

  private withFooter(body: string): string {
    return this.gitlab.config.footer ? `${body}\n\n${FOOTER}` : body;
  }

  private async planComment(request: CommentRequest): Promise<Omit<PlannedWrite, "number">> {
    const ref = this.parse(request.reference);
    const item = await this.reader.fetch(ref);
    if (!item.permissions.createNote) throw cantComment(item);
    const internal = request.internal === true;
    if (internal && !item.permissions.markNoteAsInternal) {
      throw refused(
        `Your role on ${item.reference} can't post internal Comments (that needs the Planner role or higher). Ask the user whether to post it publicly instead, or cancel. Nothing was prepared.`,
      );
    }
    const body = this.withFooter(request.body);
    const what = request.startThread ? "New Thread" : "Comment";
    const input = { noteableId: item.id, body, internal };
    return {
      summary: `${what} on ${item.reference}`,
      url: item.url,
      preview: [`${what} on ${item.reference} (${internal ? "internal" : "public"}) ${item.url}`, ...quote(body), ...quickActionWarning(body, "posting")],
      target: targetOf(ref, item),
      guard: { kind: "none" },
      steps: [
        request.startThread
          ? { operationName: "CreateDiscussion", query: CREATE_DISCUSSION, input, field: "createDiscussion", sends: [what] }
          : { operationName: "CreateNote", query: CREATE_NOTE, input, field: "createNote", sends: [what] },
      ],
      expect: {},
    };
  }

  private async planThread(request: ThreadRequest): Promise<Omit<PlannedWrite, "number">> {
    const ref = this.parse(request.reference);
    const item = await this.reader.fetch(ref);
    const thread = findThread(item, request.thread, ref.commentNumber);
    const first = thread.comments[0];
    const internal = Boolean(first?.internal);
    const comments = this.seen.comments(thread);
    if (thread.commentCount !== comments) {
      throw refused(
        `That Thread on ${item.reference} has new Comments since you fetched it. Fetch ${item.reference} again and show the user the new Comments first. Nothing was prepared.`,
      );
    }
    const guard: Guard = { kind: "thread", threadId: thread.id, comments };
    const replies = thread.commentCount - 1;
    const about = `"${excerpt(first?.body ?? "")}" by ${first?.author ?? "unknown"}, ${replies} repl${replies === 1 ? "y" : "ies"}`;

    if (request.kind === "reply") {
      if (!item.permissions.createNote) throw cantComment(item);
      const body = this.withFooter(request.body);
      return {
        summary: `Reply on ${item.reference}`,
        url: item.url,
        preview: [`Reply on ${item.reference} (${internal ? "internal, like its Thread" : "public, like its Thread"}) ${item.url}`, `  in the Thread ${about}`, ...quote(body), ...quickActionWarning(body, "posting")],
        target: targetOf(ref, item),
        guard,
        steps: [{ operationName: "CreateNote", query: CREATE_NOTE, input: { noteableId: item.id, discussionId: thread.replyId, body }, field: "createNote", sends: ["reply"] }],
        expect: {},
      };
    }

    if (!thread.resolvable) throw refused(`That's a plain Comment on ${item.reference}, not a Thread, so it can't be resolved.`);
    if (thread.resolved) throw refused(`That Thread on ${item.reference} is already resolved.`);
    if (!thread.canResolve) throw refused(`On ${item.reference}, your token can't resolve that Thread. Nothing was prepared.`);
    return {
      summary: `Resolve a Thread on ${item.reference}`,
      url: item.url,
      preview: [`Resolve the Thread on ${item.reference} ${item.url}: ${about}`],
      target: targetOf(ref, item),
      guard,
      steps: [{ operationName: "ResolveThread", query: RESOLVE_THREAD, input: { id: thread.id, resolve: true }, field: "discussionToggleResolve", sends: ["resolution"] }],
      expect: {},
    };
  }

  private async planEdit(request: EditRequest): Promise<Omit<PlannedWrite, "number">> {
    const ref = this.parse(request.reference);
    const item = await this.current(ref);
    requirePermissions(item, request);
    const changes = new Changes({ id: item.id });
    const change = (before: string | number | null, after: string | number | null) => `${before ?? "none"} → ${after ?? "none"}`;

    if (request.title !== undefined && request.title !== item.title) {
      changes.add("title", [`  title: ${change(item.title, request.title)}`], { title: request.title }, { title: request.title });
    }
    if (request.description !== undefined && request.description !== item.description) {
      changes.add(
        "description",
        ["  description:", ...lineDiff(item.description, request.description).map((line) => `    ${line}`), ...quickActionWarning(request.description, "saving")],
        WIDGETS.description(request.description),
        { description: request.description },
      );
    }
    const add = request.addLabels ?? [];
    const remove = request.removeLabels ?? [];
    if (add.length || remove.length) {
      const current = item.labels.map((l) => l.title);
      const after = [...current.filter((t) => !remove.includes(t)), ...add.filter((t) => !current.includes(t))];
      const labelsWidget = {
        addLabelIds: await Promise.all(add.map((t) => this.lookups.labelId(ref.fullPath, t))),
        removeLabelIds: item.labels.filter((l) => remove.includes(l.title)).map((l) => l.id),
      };
      changes.add("labels", [`  labels: ${joinOrNone(current)} → ${joinOrNone(after)}`], { labelsWidget }, { labelsInclude: add, labelsExclude: remove });
    }
    if (request.assignees !== undefined) {
      changes.add(
        "assignees",
        [`  assignees: ${joinOrNone(item.assignees.map((a) => a.username))} → ${joinOrNone(request.assignees)}`],
        WIDGETS.assignees(await this.lookups.userIds(request.assignees)),
        { assignees: request.assignees },
      );
    }
    if (request.milestone !== undefined) {
      const milestoneId = request.milestone === null ? null : await this.lookups.milestoneId(ref.fullPath, request.milestone);
      changes.add("milestone", [`  milestone: ${change(item.milestone?.title ?? null, request.milestone)}`], WIDGETS.milestone(milestoneId), { milestone: request.milestone });
    }
    if (request.state !== undefined) {
      const state = request.state === "close" ? "closed" : "open";
      changes.add("state", [`  state: ${change(item.state, state)}`], { stateEvent: request.state === "close" ? "CLOSE" : "REOPEN" }, { state });
    }
    if (request.dueDate !== undefined) {
      changes.add("due date", [`  due date: ${change(item.dueDate, request.dueDate)}`], WIDGETS.dueDate(request.dueDate), { dueDate: request.dueDate });
    }
    if (request.weight !== undefined) {
      if (item.weight === undefined) throw weightUnavailable(`On ${item.reference}`);
      changes.add("weight", [`  weight: ${change(item.weight, request.weight)}`], WIDGETS.weight(request.weight), { weight: request.weight });
    }
    if (request.parent !== undefined) {
      const parent = request.parent === null ? null : await this.reader.resolve(this.parse(request.parent));
      changes.add(
        "parent",
        [`  parent: ${change(item.parent?.reference ?? null, parent?.reference ?? null)}`],
        WIDGETS.parent(parent?.id ?? null),
        { parent: parent?.reference ?? null },
      );
    }

    const steps: Step[] = [];
    if (changes.fields.length) {
      steps.push({ operationName: "UpdateWorkItem", query: UPDATE, input: changes.input, field: "workItemUpdate", sends: changes.fields });
    }

    // GitLab grants blockedWorkItems only on Premium or above; CE doesn't have it at all.
    const blocking = (request.addLinks ?? []).find((l) => l.linkType !== "relates_to");
    if (blocking && !item.permissions.blockedWorkItems) {
      throw refused(`"${blocking.linkType.replaceAll("_", " ")}" links need GitLab Premium or above, which ${item.reference} doesn't have. Nothing was prepared.`);
    }
    const preview = [...changes.preview];
    const expect = changes.expect;
    const linksByType = new Map<string, { id: string; part: string }[]>();
    for (const link of request.addLinks ?? []) {
      const linked = await this.reader.resolve(this.parse(link.reference));
      const part = `link: ${link.linkType.replaceAll("_", " ")} ${linked.reference}`;
      preview.push(`  ${part}`);
      const linkType = LINK_TYPES[link.linkType];
      linksByType.set(linkType, [...(linksByType.get(linkType) ?? []), { id: linked.id, part }]);
      (expect.linksInclude ??= []).push(linked.reference);
    }
    for (const [linkType, links] of linksByType) {
      for (const batch of batches(links)) {
        steps.push({
          operationName: "AddLinkedItems",
          query: ADD_LINKS,
          input: { id: item.id, workItemsIds: batch.map((l) => l.id), linkType },
          field: "workItemAddLinkedItems",
          sends: batch.map((l) => l.part),
        });
      }
    }
    const unlinks: { id: string; part: string }[] = [];
    for (const reference of request.removeLinks ?? []) {
      const linked = await this.reader.resolve(this.parse(reference));
      const part = `unlink: ${linked.reference}`;
      preview.push(`  ${part}`);
      unlinks.push({ id: linked.id, part });
      (expect.linksExclude ??= []).push(linked.reference);
    }
    for (const batch of batches(unlinks)) {
      steps.push({
        operationName: "RemoveLinkedItems",
        query: REMOVE_LINKS,
        input: { id: item.id, workItemsIds: batch.map((l) => l.id) },
        field: "workItemRemoveLinkedItems",
        sends: batch.map((l) => l.part),
      });
    }

    if (steps.length === 0) throw refused(`The Edit to ${item.reference} doesn't change anything.`);
    return {
      summary: `Edit ${item.reference}`,
      url: item.url,
      preview: [`Edit ${item.reference} (${item.url})`, ...preview],
      target: targetOf(ref, item),
      guard: { kind: "version" },
      steps,
      expect,
    };
  }

  /** Fetches a Work Item for a Write, refusing if it changed since Claude last saw it. */
  private async current(ref: ParsedReference): Promise<WorkItem> {
    const item = await this.reader.fetch(ref);
    if (this.seen.changed(item)) {
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
    [request.parent !== undefined, "adminParentLink", "change its parent"],
    [Boolean(request.addLinks?.length || request.removeLinks?.length), "adminWorkItemLink", "change its Linked Items"],
  ];
  const denied = needs.filter(([wanted, permission]) => wanted && !item.permissions[permission]).map(([, , what]) => what);
  if (denied.length) throw refused(`On ${item.reference}, your token can't ${denied.join(", or ")}. Nothing was prepared.`);
}

function targetOf(ref: ParsedReference, item: WorkItem): Target {
  return { ref, id: item.id, reference: item.reference, updatedAt: item.updatedAt };
}

/** The Thread a reply or resolution is about: named by ID, or by a Comment link's Comment. */
function findThread(item: WorkItem, threadId: string | undefined, commentNumber: string | undefined): Thread {
  const wanted = threadId && !threadId.startsWith("gid://") ? `gid://gitlab/Discussion/${threadId}` : threadId;
  const thread = wanted
    ? item.threads.find((t) => t.id === wanted)
    : commentNumber
      ? threadWithComment(item, commentNumber)?.thread
      : undefined;
  if (!thread) {
    throw refused(
      wanted || commentNumber
        ? `That Thread isn't on ${item.reference}, or your token can't see it.`
        : `Say which Thread on ${item.reference}: pass its ID from a Fetch, or use a link to one of its Comments.`,
    );
  }
  return thread;
}
