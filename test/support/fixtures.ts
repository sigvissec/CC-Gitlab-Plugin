// Hand-written GitLab GraphQL responses, shaped like GitLab 18.1's schema. Recorded responses
// from a Test Instance replace or confirm these.
import type { Interaction } from "./cassette.js";

export interface MrFixture {
  id: number;
  reference: string;
  title: string;
  state: "opened" | "merged" | "closed" | "locked";
  draft?: boolean;
}

export interface WorkItemFixture {
  fullPath?: string;
  iid?: string;
  id?: number;
  type?: string;
  title?: string;
  state?: "OPEN" | "CLOSED";
  updatedAt?: string;
  description?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
  dueDate?: string | null;
  weight?: number | null;
  parent?: { reference: string; title: string; type?: string } | null;
  children?: { reference: string; title: string; state?: string; type?: string }[];
  linked?: { linkType: string; reference: string; title: string; state?: string }[];
  threads?: {
    id: string;
    resolvable?: boolean;
    resolved?: boolean;
    canResolve?: boolean;
    notes: { id: number; author: string; body: string; internal?: boolean }[];
  }[];
  closingMrs?: MrFixture[];
  closingCount?: number;
  relatedMrs?: MrFixture[];
  permissions?: Partial<Record<string, boolean>>;
  confidential?: boolean;
}

const BASE = "https://gitlab.example.com";

function mr(m: MrFixture) {
  return {
    id: `gid://gitlab/MergeRequest/${m.id}`,
    reference: m.reference,
    title: m.title,
    state: m.state,
    draft: m.draft ?? false,
    webUrl: `${BASE}/${m.reference.replace("!", "/-/merge_requests/")}`,
  };
}

function itemRef(reference: string) {
  return `${BASE}/${reference.replace("#", "/-/work_items/")}`;
}

export function workItemNode(f: WorkItemFixture = {}, options: { enterprise?: boolean } = {}) {
  const fullPath = f.fullPath ?? "acme/app";
  const iid = f.iid ?? "12";
  const reference = `${fullPath}#${iid}`;
  const widgets: any[] = [
    { type: "LABELS", labels: { nodes: (f.labels ?? []).map((title, i) => ({ id: `gid://gitlab/ProjectLabel/${i + 1}`, title })) } },
    { type: "ASSIGNEES", assignees: { nodes: (f.assignees ?? []).map((username, i) => ({ id: `gid://gitlab/User/${i + 1}`, username })) } },
    { type: "MILESTONE", milestone: f.milestone ? { id: "gid://gitlab/Milestone/1", title: f.milestone } : null },
    { type: "START_AND_DUE_DATE", dueDate: f.dueDate ?? null, startDate: null },
    {
      type: "HIERARCHY",
      parent: f.parent
        ? { id: "gid://gitlab/WorkItem/900", reference: f.parent.reference, title: f.parent.title, webUrl: itemRef(f.parent.reference), workItemType: { name: f.parent.type ?? "Issue" } }
        : null,
      hasChildren: (f.children ?? []).length > 0,
      children: {
        nodes: (f.children ?? []).map((c, i) => ({
          id: `gid://gitlab/WorkItem/${500 + i}`,
          reference: c.reference,
          title: c.title,
          state: c.state ?? "OPEN",
          webUrl: itemRef(c.reference),
          workItemType: { name: c.type ?? "Task" },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    {
      type: "LINKED_ITEMS",
      linkedItems: {
        nodes: (f.linked ?? []).map((l, i) => ({
          linkType: l.linkType,
          workItem: { id: `gid://gitlab/WorkItem/${700 + i}`, reference: l.reference, title: l.title, state: l.state ?? "OPEN", webUrl: itemRef(l.reference), workItemType: { name: "Issue" } },
        })),
      },
    },
    {
      type: "NOTES",
      discussions: {
        nodes: (f.threads ?? []).map((t) => ({
          id: `gid://gitlab/Discussion/${t.id}`,
          replyId: `gid://gitlab/Discussion/${t.id}`,
          resolvable: t.resolvable ?? true,
          resolved: t.resolved ?? false,
          userPermissions: { resolveNote: t.canResolve ?? true },
          notes: {
            nodes: t.notes.map((n) => ({
              id: `gid://gitlab/Note/${n.id}`,
              body: n.body,
              internal: n.internal ?? false,
              createdAt: "2026-10-01T10:00:00Z",
              author: { username: n.author },
              url: `${itemRef(reference)}#note_${n.id}`,
            })),
          },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    {
      type: "DEVELOPMENT",
      closingMergeRequests: {
        count: f.closingCount ?? (f.closingMrs ?? []).length,
        nodes: (f.closingMrs ?? []).map((m) => ({ fromMrDescription: true, mergeRequest: mr(m) })),
      },
      relatedMergeRequests: { nodes: (f.relatedMrs ?? []).map(mr) },
    },
  ];
  if (options.enterprise !== false) widgets.push({ type: "WEIGHT", weight: f.weight ?? null });
  return {
    id: `gid://gitlab/WorkItem/${f.id ?? 1012}`,
    iid,
    reference,
    title: f.title ?? "Login times out after 30 seconds",
    state: f.state ?? "OPEN",
    confidential: f.confidential ?? false,
    description: f.description ?? "Steps to reproduce:\n1. Log in\n2. Wait",
    webUrl: itemRef(reference),
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: f.updatedAt ?? "2026-10-01T12:00:00Z",
    workItemType: { name: f.type ?? "Issue" },
    author: { username: "bob" },
    userPermissions: {
      updateWorkItem: true,
      setWorkItemMetadata: true,
      adminParentLink: true,
      adminWorkItemLink: true,
      createNote: true,
      markNoteAsInternal: true,
      ...f.permissions,
    },
    widgets,
  };
}

/** The response to the single-Work-Item Fetch. */
export function fetchWorkItem(f: WorkItemFixture = {}, options: { enterprise?: boolean; missing?: boolean } = {}): Interaction {
  return {
    operationName: "FetchWorkItem",
    variables: { fullPath: f.fullPath ?? "acme/app", iid: f.iid ?? "12" },
    response: {
      body: { data: { namespace: options.missing ? null : { workItem: workItemNode(f, options) } } },
    },
  };
}
