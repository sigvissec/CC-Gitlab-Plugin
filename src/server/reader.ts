// Fetches one Work Item with everything Claude needs: fields, Hierarchy, Linked Items,
// Threads, and the merge requests associated with it.
import type { Config } from "./config.js";
import { GitLabError, type Gateway } from "./gateway.js";
import type { Instance } from "./instance.js";
import { SUPPORTED_TYPES, fullReference, refused, type WorkItemRef } from "./references.js";

export interface Comment {
  id: string;
  author: string;
  body: string;
  internal: boolean;
  createdAt: string;
  url?: string;
}

export interface Thread {
  id: string;
  replyId: string;
  resolvable: boolean;
  resolved: boolean;
  canResolve: boolean;
  comments: Comment[];
}

export interface ItemSummary {
  id: string;
  reference: string;
  title: string;
  type: string;
  state: "open" | "closed";
  url: string;
}

export interface MergeRequestLink {
  reference: string;
  title: string;
  state: "draft" | "open" | "merged" | "closed";
  relation: "closes" | "mentions";
  url: string;
}

export interface WorkItem {
  id: string;
  reference: string;
  url: string;
  fullPath: string;
  iid: string;
  title: string;
  type: string;
  state: "open" | "closed";
  confidential: boolean;
  author: string;
  description: string;
  updatedAt: string;
  labels: { id: string; title: string }[];
  assignees: { id: string; username: string }[];
  milestone: { id: string; title: string } | null;
  dueDate: string | null;
  weight: number | null | undefined;
  parent: ItemSummary | null;
  children: ItemSummary[];
  linkedItems: (ItemSummary & { linkType: string })[];
  threads: Thread[];
  mergeRequests: { all: MergeRequestLink[]; hidden: number };
  permissions: Record<string, boolean>;
}

const SUMMARY = "id reference(full: true) title state webUrl workItemType { name }";

function fetchQuery(enterprise: boolean): string {
  return /* GraphQL */ `
query FetchWorkItem($fullPath: ID!, $iid: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      id iid reference(full: true) title state confidential description webUrl createdAt updatedAt
      workItemType { name }
      author { username }
      userPermissions { updateWorkItem setWorkItemMetadata adminParentLink adminWorkItemLink createNote markNoteAsInternal }
      widgets {
        type
        ... on WorkItemWidgetLabels { labels { nodes { id title } } }
        ... on WorkItemWidgetAssignees { assignees { nodes { id username } } }
        ... on WorkItemWidgetMilestone { milestone { id title } }
        ... on WorkItemWidgetStartAndDueDate { dueDate startDate }${enterprise ? "\n        ... on WorkItemWidgetWeight { weight }" : ""}
        ... on WorkItemWidgetHierarchy {
          parent { ${SUMMARY} }
          hasChildren
          children(first: 100) { nodes { ${SUMMARY} } pageInfo { hasNextPage endCursor } }
        }
        ... on WorkItemWidgetLinkedItems { linkedItems(first: 100) { nodes { linkType workItem { ${SUMMARY} } } } }
        ... on WorkItemWidgetNotes {
          discussions(filter: ONLY_COMMENTS, first: 100) {
            nodes {
              id replyId resolvable resolved
              userPermissions { resolveNote }
              notes(first: 100) { nodes { id body internal createdAt url author { username } } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        ... on WorkItemWidgetDevelopment {
          closingMergeRequests(first: 100) {
            count
            nodes { fromMrDescription mergeRequest { id reference(full: true) title state draft webUrl } }
          }
          relatedMergeRequests(first: 100) { nodes { id reference(full: true) title state draft webUrl } }
        }
      }
    }
  }
}`;
}

const lower = (state: string): "open" | "closed" => (state === "CLOSED" ? "closed" : "open");

function summary(node: any): ItemSummary {
  return {
    id: node.id,
    reference: node.reference,
    title: node.title,
    type: node.workItemType?.name ?? "Unknown",
    state: lower(node.state),
    url: node.webUrl,
  };
}

function mrState(mr: any): MergeRequestLink["state"] {
  if (mr.state === "opened") return mr.draft ? "draft" : "open";
  if (mr.state === "merged") return "merged";
  return "closed";
}

const MR_ORDER: Record<MergeRequestLink["state"], number> = { draft: 0, open: 1, merged: 2, closed: 3 };

function mergeRequests(widget: any): WorkItem["mergeRequests"] {
  const seen = new Map<string, MergeRequestLink>();
  const closing = widget?.closingMergeRequests?.nodes ?? [];
  for (const node of closing) {
    const mr = node.mergeRequest;
    if (mr) seen.set(mr.id, { reference: mr.reference, title: mr.title, state: mrState(mr), relation: "closes", url: mr.webUrl });
  }
  for (const mr of widget?.relatedMergeRequests?.nodes ?? []) {
    if (!seen.has(mr.id)) {
      seen.set(mr.id, { reference: mr.reference, title: mr.title, state: mrState(mr), relation: "mentions", url: mr.webUrl });
    }
  }
  const all = [...seen.values()].sort((a, b) => MR_ORDER[a.state] - MR_ORDER[b.state]);
  const visibleClosing = closing.filter((node: any) => node.mergeRequest).length;
  const hidden = Math.max(0, (widget?.closingMergeRequests?.count ?? visibleClosing) - visibleClosing);
  return { all, hidden };
}

function toWorkItem(node: any, ref: WorkItemRef): WorkItem {
  const widget = (type: string) => (node.widgets ?? []).find((w: any) => w.type === type);
  const hierarchy = widget("HIERARCHY");
  const weight = widget("WEIGHT");
  return {
    id: node.id,
    reference: node.reference ?? fullReference(ref),
    url: node.webUrl,
    fullPath: ref.fullPath,
    iid: node.iid,
    title: node.title,
    type: node.workItemType?.name ?? "Unknown",
    state: lower(node.state),
    confidential: Boolean(node.confidential),
    author: node.author?.username ?? "",
    description: node.description ?? "",
    updatedAt: node.updatedAt,
    labels: widget("LABELS")?.labels?.nodes ?? [],
    assignees: widget("ASSIGNEES")?.assignees?.nodes ?? [],
    milestone: widget("MILESTONE")?.milestone ?? null,
    dueDate: widget("START_AND_DUE_DATE")?.dueDate ?? null,
    weight: weight ? (weight.weight ?? null) : undefined,
    parent: hierarchy?.parent ? summary(hierarchy.parent) : null,
    children: (hierarchy?.children?.nodes ?? []).map(summary),
    linkedItems: (widget("LINKED_ITEMS")?.linkedItems?.nodes ?? []).map((n: any) => ({ ...summary(n.workItem), linkType: n.linkType })),
    threads: (widget("NOTES")?.discussions?.nodes ?? []).map((d: any) => ({
      id: d.id,
      replyId: d.replyId,
      resolvable: Boolean(d.resolvable),
      resolved: Boolean(d.resolved),
      canResolve: Boolean(d.userPermissions?.resolveNote),
      comments: (d.notes?.nodes ?? []).map((n: any) => ({
        id: n.id,
        author: n.author?.username ?? "",
        body: n.body,
        internal: Boolean(n.internal),
        createdAt: n.createdAt,
        url: n.url,
      })),
    })),
    mergeRequests: mergeRequests(widget("DEVELOPMENT")),
    permissions: node.userPermissions ?? {},
  };
}

export class Reader {
  constructor(
    private readonly config: Config,
    private readonly gateway: Gateway,
    private readonly instance: Instance,
  ) {}

  /** Fetches a supported Work Item, or throws a readable refusal. */
  async fetch(ref: WorkItemRef): Promise<WorkItem> {
    const info = await this.instance.requireSupported();
    const data = await this.gateway.graphql("FetchWorkItem", fetchQuery(info.enterprise), {
      fullPath: ref.fullPath,
      iid: ref.iid,
    });
    const node = data?.namespace?.workItem;
    if (!node) {
      throw new GitLabError(
        `${fullReference(ref)} on ${this.config.baseUrl}: not found, or your token can't see it.`,
        "not-found",
      );
    }
    const item = toWorkItem(node, ref);
    if (!(SUPPORTED_TYPES as readonly string[]).includes(item.type)) {
      throw refused(`${item.reference} is an ${item.type}; only Issues and Tasks are supported.`);
    }
    return item;
  }
}
