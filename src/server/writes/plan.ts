// Turns a Write request into a planned Write: validated, permission-checked, previewed, and
// reduced to the exact GitLab mutations to send, with what must still hold before sending
// them and what GitLab should show afterwards.
import type { Config } from "../config.js";
import type { Gateway } from "../gateway.js";
import type { Instance } from "../instance.js";
import type { Lookups } from "../lookups.js";
import { threadWithComment, type Reader, type Thread, type WorkItem } from "../reader.js";
import { lineDiff } from "../diff.js";
import { notFound, parseReference, refused, type WorkItemRef } from "../references.js";
import { excerpt, joinOrNone, quote, stateLines } from "./render.js";
import type { CommentRequest, CreateRequest, EditRequest, ThreadRequest, WriteRequest } from "./requests.js";

export const FOOTER = "_Posted with Claude Code_";

export interface Step {
  operationName: string;
  query: string;
  input: Record<string, unknown>;
  /** The mutation's payload field, whose `errors` array GitLab fills on failure. */
  field: string;
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

export interface PlannedWrite {
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

export class Planner {
  constructor(
    private readonly config: Config,
    private readonly gateway: Gateway,
    private readonly instance: Instance,
    private readonly reader: Reader,
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
      if (!data?.project) throw notFound(request.project, this.config);
      if (!data.project.userPermissions?.createWorkItem) throw refused(`Your token can't create Work Items in ${request.project}. Nothing was prepared.`);
      fullPath = request.project;
    }
    if (request.weight !== undefined && !(await this.lookups.typeOffers(fullPath, request.type, "WEIGHT"))) {
      throw refused(`In ${fullPath}, weight isn't available: it needs GitLab EE on Premium or above. Nothing was prepared.`);
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
      preview.push(`  labels: ${joinOrNone(request.labels)}`);
    }
    if (request.assignees?.length) {
      input.assigneesWidget = { assigneeIds: await this.lookups.userIds(request.assignees) };
      expect.assignees = request.assignees;
      preview.push(`  assignees: ${joinOrNone(request.assignees)}`);
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
    const comments = this.reader.commentsSeen(thread);
    if (thread.commentCount !== comments) {
      throw refused(
        `That Thread on ${item.reference} has new Comments since you fetched it. Fetch ${item.reference} again and show the user the new Comments first. Nothing was prepared.`,
      );
    }
    const guard: Guard = { kind: "thread", threadId: thread.id, comments };
    const replies = thread.commentCount - 1;
    const about = `"${excerpt(first?.body ?? "")}" by ${first?.author ?? "unknown"}, ${replies} repl${replies === 1 ? "y" : "ies"}`;

    if (request.kind === "reply") {
      if (!item.permissions.createNote) throw refused(`On ${item.reference}, your token can't post Comments. Nothing was prepared.`);
      const body = this.withFooter(request.body);
      return {
        summary: `Reply on ${item.reference}`,
        preview: [`Reply on ${item.reference} (${internal ? "internal, like its Thread" : "public, like its Thread"}) ${item.url}`, `  in the Thread ${about}`, ...quote(body)],
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
      preview: [`Resolve the Thread on ${item.reference} ${item.url}: ${about}`],
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
      preview.push(`  labels: ${joinOrNone(current)} → ${joinOrNone(after)}`);
      input.labelsWidget = {
        addLabelIds: await Promise.all(add.map((t) => this.lookups.labelId(ref.fullPath, t))),
        removeLabelIds: item.labels.filter((l) => remove.includes(l.title)).map((l) => l.id),
      };
      expect.labelsInclude = add;
      expect.labelsExclude = remove;
    }

    if (request.assignees !== undefined) {
      preview.push(`  assignees: ${joinOrNone(item.assignees.map((a) => a.username))} → ${joinOrNone(request.assignees)}`);
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

    const blocking = (request.addLinks ?? []).find((l) => l.linkType !== "relates_to");
    if (blocking && !(await this.instance.probe()).enterprise) {
      throw refused(`"${blocking.linkType.replaceAll("_", " ")}" links need GitLab Premium, and this Instance runs CE. Nothing was prepared.`);
    }
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
    const { item, changed } = await this.reader.fetchSinceSeen(ref);
    if (changed) {
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
  ];
  needs.push(
    [request.parent !== undefined, "adminParentLink", "change its parent"],
    [Boolean(request.addLinks?.length || request.removeLinks?.length), "adminWorkItemLink", "change its Linked Items"],
  );
  const denied = needs.filter(([wanted, permission]) => wanted && !item.permissions[permission]).map(([, , what]) => what);
  if (denied.length) throw refused(`On ${item.reference}, your token can't ${denied.join(", or ")}. Nothing was prepared.`);
}

function targetOf(ref: WorkItemRef, item: WorkItem): PlannedWrite["target"] {
  return { ref, id: item.id, reference: item.reference, updatedAt: item.updatedAt };
}

/** The Thread a reply or resolution is about: named by ID, or by a Comment link's note. */
function findThread(item: WorkItem, threadId: string | undefined, noteId: string | undefined): Thread {
  const wanted = threadId && !threadId.startsWith("gid://") ? `gid://gitlab/Discussion/${threadId}` : threadId;
  const thread = wanted
    ? item.threads.find((t) => t.id === wanted)
    : noteId
      ? threadWithComment(item, noteId)?.thread
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
