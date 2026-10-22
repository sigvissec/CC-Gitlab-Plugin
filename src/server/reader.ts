// Fetches one Work Item with everything Claude needs: fields, Hierarchy, Linked Items,
// Threads, and the merge requests associated with it.
import type { GitLab } from "./gitlab.js";
import { SUMMARY_FIELDS, stateOf, summaryOf, typeOf, widgetOf, type ItemSummary } from "./nodes.js";
import { SUPPORTED_TYPES, fullReference, notFound, refused, type ParsedReference } from "./references.js";

export type { ItemSummary } from "./nodes.js";

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
  /** The first 100 Comments; a longer Thread has more in GitLab. */
  comments: Comment[];
  /** How many Comments the Thread has in GitLab, including any not fetched. */
  commentCount: number;
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
  /** The first 100 children; `childrenCount` counts them all. */
  children: ItemSummary[];
  childrenCount: number;
  linkedItems: (ItemSummary & { linkType: string })[];
  threads: Thread[];
  /**
   * `hidden` counts closing merge requests the token can't see; `unfetched` counts those past
   * the first 100, which may or may not be visible.
   */
  mergeRequests: { all: MergeRequestLink[]; hidden: number; unfetched: number };
  permissions: Record<string, boolean>;
}

const PAGE = "pageInfo { hasNextPage endCursor }";
const LINKS = `nodes { linkType workItem { ${SUMMARY_FIELDS} } } ${PAGE}`;
const THREADS = `
            nodes {
              id replyId resolvable resolved
              userPermissions { resolveNote }
              notes(first: 100) { count nodes { id body internal createdAt url author { username } } }
            }
            ${PAGE}`;

function fetchQuery(enterprise: boolean): string {
  return /* GraphQL */ `
query FetchWorkItem($fullPath: ID!, $iid: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      id iid reference(full: true) title state confidential description webUrl createdAt updatedAt
      workItemType { name }
      author { username }
      userPermissions {
        updateWorkItem setWorkItemMetadata adminParentLink adminWorkItemLink createNote markNoteAsInternal${enterprise ? " blockedWorkItems" : ""}
      }
      widgets {
        type
        ... on WorkItemWidgetLabels { labels { nodes { id title } } }
        ... on WorkItemWidgetAssignees { assignees { nodes { id username } } }
        ... on WorkItemWidgetMilestone { milestone { id title } }
        ... on WorkItemWidgetStartAndDueDate { dueDate startDate }${enterprise ? "\n        ... on WorkItemWidgetWeight { weight }" : ""}
        ... on WorkItemWidgetHierarchy {
          parent { ${SUMMARY_FIELDS} }
          hasChildren
          children(first: 100) { count nodes { ${SUMMARY_FIELDS} } }
        }
        ... on WorkItemWidgetLinkedItems { linkedItems(first: 100) { ${LINKS} } }
        ... on WorkItemWidgetNotes { discussions(filter: ONLY_COMMENTS, first: 100) { ${THREADS} } }
        ... on WorkItemWidgetDevelopment {
          closingMergeRequests(first: 100) {
            count
            nodes { fromMrDescription mergeRequest { id reference(full: true) title state draft webUrl } }
            pageInfo { hasNextPage }
          }
          relatedMergeRequests(first: 100) { nodes { id reference(full: true) title state draft webUrl } }
        }
      }
    }
  }
}`;
}

/** Later pages of the connections a Fetch reads in full: Threads and Linked Items. */
const PAGED = [
  {
    widget: "NOTES",
    field: "discussions",
    operationName: "FetchWorkItemThreads",
    query: /* GraphQL */ `
query FetchWorkItemThreads($fullPath: ID!, $iid: String!, $after: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      widgets { type ... on WorkItemWidgetNotes { discussions(filter: ONLY_COMMENTS, first: 100, after: $after) { ${THREADS} } } }
    }
  }
}`,
  },
  {
    widget: "LINKED_ITEMS",
    field: "linkedItems",
    operationName: "FetchWorkItemLinks",
    query: /* GraphQL */ `
query FetchWorkItemLinks($fullPath: ID!, $iid: String!, $after: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) { widgets { type ... on WorkItemWidgetLinkedItems { linkedItems(first: 100, after: $after) { ${LINKS} } } } }
  }
}`,
  },
] as const;


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
  const count = widget?.closingMergeRequests?.count ?? closing.length;
  // Past the first page, GitLab's count can't tell unfetched merge requests from ones the token can't see.
  return widget?.closingMergeRequests?.pageInfo?.hasNextPage
    ? { all, hidden: closing.length - visibleClosing, unfetched: Math.max(0, count - closing.length) }
    : { all, hidden: Math.max(0, count - visibleClosing), unfetched: 0 };
}

function toWorkItem(node: any, ref: ParsedReference): WorkItem {
  const widget = (type: string) => widgetOf(node, type);
  const hierarchy = widget("HIERARCHY");
  const weight = widget("WEIGHT");
  return {
    id: node.id,
    reference: node.reference ?? fullReference(ref),
    url: node.webUrl,
    fullPath: ref.fullPath,
    iid: node.iid,
    title: node.title,
    type: typeOf(node),
    state: stateOf(node.state),
    confidential: Boolean(node.confidential),
    author: node.author?.username ?? "",
    description: node.description ?? "",
    updatedAt: node.updatedAt,
    labels: widget("LABELS")?.labels?.nodes ?? [],
    assignees: widget("ASSIGNEES")?.assignees?.nodes ?? [],
    milestone: widget("MILESTONE")?.milestone ?? null,
    dueDate: widget("START_AND_DUE_DATE")?.dueDate ?? null,
    weight: weight ? (weight.weight ?? null) : undefined,
    parent: hierarchy?.parent ? summaryOf(hierarchy.parent) : null,
    children: (hierarchy?.children?.nodes ?? []).map(summaryOf),
    childrenCount: hierarchy?.children?.count ?? (hierarchy?.children?.nodes ?? []).length,
    linkedItems: (widget("LINKED_ITEMS")?.linkedItems?.nodes ?? []).map((n: any) => ({ ...summaryOf(n.workItem), linkType: n.linkType })),
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
      commentCount: d.notes?.count ?? (d.notes?.nodes ?? []).length,
    })),
    mergeRequests: mergeRequests(widget("DEVELOPMENT")),
    permissions: node.userPermissions ?? {},
  };
}

const RESOLVE = /* GraphQL */ `
query ResolveWorkItem($fullPath: ID!, $iid: String!) {
  namespace(fullPath: $fullPath) { workItem(iid: $iid) { id reference(full: true) workItemType { name } } }
}`;

export interface ResolvedWorkItem {
  id: string;
  reference: string;
  type: string;
}

/**
 * The Thread holding a Comment, by the Comment's number from a Comment link. GitLab's
 * global ID names the note's class (`Note`, or `DiscussionNote` inside a resolvable Thread),
 * so only the number is compared.
 */
export function threadWithComment(item: WorkItem, commentNumber: string): { thread: Thread; commentId: string } | undefined {
  for (const thread of item.threads) {
    const comment = thread.comments.find((c) => c.id.slice(c.id.lastIndexOf("/") + 1) === commentNumber);
    if (comment) return { thread, commentId: comment.id };
  }
  return undefined;
}

export class Reader {
  constructor(private readonly gitlab: GitLab) {}

  private requireSupportedType(reference: string, type: string): void {
    if (!(SUPPORTED_TYPES as readonly string[]).includes(type)) {
      throw refused(`${reference} is an ${type}; only Issues and Tasks are supported.`);
    }
  }

  /** Looks up a Work Item's global ID without fetching the rest of it. */
  async resolve(ref: ParsedReference): Promise<ResolvedWorkItem> {
    await this.gitlab.instance.requireSupported();
    const data = await this.gitlab.gateway.graphql("ResolveWorkItem", RESOLVE, { fullPath: ref.fullPath, iid: ref.iid });
    const node = data?.namespace?.workItem;
    if (!node) throw notFound(fullReference(ref), this.gitlab.config);
    const resolved = { id: node.id, reference: node.reference ?? fullReference(ref), type: typeOf(node) };
    this.requireSupportedType(resolved.reference, resolved.type);
    return resolved;
  }

  /** The nodes on every page after the first of a Work Item's paged connection. */
  private async laterPages(ref: ParsedReference, paged: (typeof PAGED)[number], pageInfo: any): Promise<any[]> {
    const nodes: any[] = [];
    while (pageInfo?.hasNextPage && pageInfo.endCursor) {
      const variables = { fullPath: ref.fullPath, iid: ref.iid, after: pageInfo.endCursor };
      const data = await this.gitlab.gateway.graphql(paged.operationName, paged.query, variables);
      const connection = widgetOf(data?.namespace?.workItem, paged.widget)?.[paged.field];
      nodes.push(...(connection?.nodes ?? []));
      pageInfo = connection?.pageInfo;
    }
    return nodes;
  }

  /** Fetches a supported Work Item, or throws a readable refusal. */
  async fetch(ref: ParsedReference): Promise<WorkItem> {
    const info = await this.gitlab.instance.requireSupported();
    const data = await this.gitlab.gateway.graphql("FetchWorkItem", fetchQuery(info.enterprise), {
      fullPath: ref.fullPath,
      iid: ref.iid,
    });
    const node = data?.namespace?.workItem;
    if (!node) throw notFound(fullReference(ref), this.gitlab.config);
    for (const paged of PAGED) {
      const connection = widgetOf(node, paged.widget)?.[paged.field];
      if (connection) connection.nodes = [...(connection.nodes ?? []), ...(await this.laterPages(ref, paged, connection.pageInfo))];
    }
    const item = toWorkItem(node, ref);
    this.requireSupportedType(item.reference, item.type);
    return item;
  }
}
