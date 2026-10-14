// Filtered lists of Work Items: compact summaries, most recently updated first.
import { GitLabError, type Gateway } from "./gateway.js";
import type { Instance } from "./instance.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;
const PAGE_MAX = 100;

export interface ListEntry {
  reference: string;
  title: string;
  type: string;
  state: "open" | "closed";
  assignees: string[];
  labels: string[];
  milestone: string | null;
  parent: string | null;
  updatedAt: string;
  url: string;
}

export interface ListResult {
  items: ListEntry[];
  hasMore: boolean;
  /** Pass back as `after` to continue the list. */
  endCursor: string | null;
}

const ENTRY = /* GraphQL */ `
  nodes {
    id reference(full: true) title state webUrl updatedAt
    workItemType { name }
    widgets(onlyTypes: [ASSIGNEES, LABELS, MILESTONE, HIERARCHY]) {
      type
      ... on WorkItemWidgetAssignees { assignees { nodes { username } } }
      ... on WorkItemWidgetLabels { labels { nodes { title } } }
      ... on WorkItemWidgetMilestone { milestone { title } }
      ... on WorkItemWidgetHierarchy { parent { reference(full: true) } }
    }
  }
  pageInfo { hasNextPage endCursor }`;

const FILTER_VARIABLES =
  "$first: Int!, $after: String, $state: IssuableState, $types: [IssueType!], $assigneeUsernames: [String!], $authorUsername: String, $labelName: [String!], $milestoneTitle: [String!], $parentIds: [WorkItemID!], $search: String, $in: [IssuableSearchableField!], $not: NegatedWorkItemFilterInput, $or: UnionedWorkItemFilterInput, $sort: WorkItemSort";
const FILTER_ARGUMENTS =
  "first: $first, after: $after, state: $state, types: $types, assigneeUsernames: $assigneeUsernames, authorUsername: $authorUsername, labelName: $labelName, milestoneTitle: $milestoneTitle, parentIds: $parentIds, search: $search, in: $in, not: $not, or: $or, sort: $sort";

const NAMESPACE_LIST = /* GraphQL */ `
query ListWorkItems($fullPath: ID!, $includeDescendants: Boolean, ${FILTER_VARIABLES}) {
  namespace(fullPath: $fullPath) {
    workItems(includeDescendants: $includeDescendants, ${FILTER_ARGUMENTS}) {${ENTRY}
    }
  }
}`;

const MY_LIST = /* GraphQL */ `
query ListMyWorkItems(${FILTER_VARIABLES}) {
  currentUser {
    workItems(${FILTER_ARGUMENTS}) {${ENTRY}
    }
  }
}`;

export interface Filters {
  state?: "opened" | "closed" | "all";
  types?: ("Issue" | "Task")[];
  assignees?: string[];
  assignedToMe?: boolean;
  author?: string;
  labels?: string[];
  excludeLabels?: string[];
  anyLabels?: string[];
  milestone?: string;
  parentId?: string;
  search?: string;
}

function entry(node: any): ListEntry {
  const widget = (type: string) => (node.widgets ?? []).find((w: any) => w.type === type);
  return {
    reference: node.reference,
    title: node.title,
    type: node.workItemType?.name ?? "Unknown",
    state: node.state === "CLOSED" ? "closed" : "open",
    assignees: (widget("ASSIGNEES")?.assignees?.nodes ?? []).map((a: any) => a.username),
    labels: (widget("LABELS")?.labels?.nodes ?? []).map((l: any) => l.title),
    milestone: widget("MILESTONE")?.milestone?.title ?? null,
    parent: widget("HIERARCHY")?.parent?.reference ?? null,
    updatedAt: node.updatedAt,
    url: node.webUrl,
  };
}

export class Lists {
  constructor(
    private readonly gateway: Gateway,
    private readonly instance: Instance,
  ) {}

  private async variables(filters: Filters): Promise<Record<string, unknown>> {
    const nonEmpty = (values?: string[]) => (values?.length ? values : undefined);
    const assignees = [...(filters.assignees ?? [])];
    if (filters.assignedToMe) {
      const { username } = await this.instance.probe();
      if (!assignees.includes(username)) assignees.push(username);
    }
    return {
      state: filters.state ?? "opened",
      types: (filters.types?.length ? filters.types : ["Issue", "Task"]).map((t) => t.toUpperCase()),
      sort: "UPDATED_DESC",
      assigneeUsernames: nonEmpty(assignees),
      authorUsername: filters.author || undefined,
      labelName: nonEmpty(filters.labels),
      not: filters.excludeLabels?.length ? { labelName: filters.excludeLabels } : undefined,
      or: filters.anyLabels?.length ? { labelNames: filters.anyLabels } : undefined,
      milestoneTitle: filters.milestone ? [filters.milestone] : undefined,
      parentIds: filters.parentId ? [filters.parentId] : undefined,
      search: filters.search || undefined,
      in: filters.search ? ["TITLE", "DESCRIPTION"] : undefined,
    };
  }

  /** Lists a project's or group's Work Items, subgroups and projects included. */
  async namespace(fullPath: string, filters: Filters, limit = DEFAULT_LIMIT, after?: string): Promise<ListResult> {
    await this.instance.requireSupported();
    const base = { fullPath, includeDescendants: true, ...(await this.variables(filters)) };
    return this.pages(limit, after, async (first, cursor) => {
      const data = await this.gateway.graphql("ListWorkItems", NAMESPACE_LIST, { ...base, first, after: cursor });
      if (!data?.namespace) return null;
      return data.namespace.workItems;
    }, fullPath);
  }

  /** The signed-in user's Work Items across the Instance, assigned to them. */
  async mine(filters: Filters, limit = DEFAULT_LIMIT, after?: string): Promise<ListResult> {
    await this.instance.requireSupported();
    const base = await this.variables({ ...filters, assignedToMe: true });
    return this.pages(limit, after, async (first, cursor) => {
      const data = await this.gateway.graphql("ListMyWorkItems", MY_LIST, { ...base, first, after: cursor });
      return data?.currentUser?.workItems ?? null;
    }, "Your Work Items");
  }

  private async pages(
    limit: number,
    after: string | undefined,
    fetchPage: (first: number, after: string | undefined) => Promise<any>,
    scope: string,
  ): Promise<ListResult> {
    const wanted = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
    const items: ListEntry[] = [];
    let cursor = after;
    let hasMore = false;
    let endCursor: string | null = null;
    while (items.length < wanted) {
      const connection = await fetchPage(Math.min(PAGE_MAX, wanted - items.length), cursor);
      if (!connection) throw new GitLabError(`${scope}: not found, or your token can't see it.`, "not-found");
      items.push(...(connection.nodes ?? []).map(entry));
      hasMore = Boolean(connection.pageInfo?.hasNextPage);
      endCursor = connection.pageInfo?.endCursor ?? null;
      if (!hasMore || !endCursor) break;
      cursor = endCursor;
    }
    return { items, hasMore, endCursor: hasMore ? endCursor : null };
  }
}
