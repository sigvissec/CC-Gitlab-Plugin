// Filtered lists of Work Items: compact summaries, most recently updated first.
import { z } from "zod";
import type { GitLab } from "./gitlab.js";
import { summaryOf, widgetOf } from "./nodes.js";
import { SUPPORTED_TYPES, notFound, refused } from "./references.js";
import { WAYFINDER_TICKET_LABELS } from "./wayfinder.js";

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

/** How much of a list to return: the list tools all take these. */
export const PAGING_SCHEMA = {
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many Work Items (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`),
  after: z.string().optional().describe("Cursor from a previous list, to continue it"),
};

/** The filters list_work_items accepts; my_work_items takes some of them. */
export const FILTER_SCHEMA = {
  state: z.enum(["opened", "closed", "all"]).optional().describe("Default: opened"),
  types: z.array(z.enum(SUPPORTED_TYPES)).optional().describe("Default: both"),
  assignees: z.array(z.string()).optional().describe("Usernames; every one must be assigned"),
  assignedToMe: z.boolean().optional().describe("Only Work Items assigned to the signed-in user"),
  author: z.string().optional().describe("Author's username"),
  labels: z.array(z.string()).optional().describe("Every one of these labels"),
  excludeLabels: z.array(z.string()).optional().describe("None of these labels"),
  anyLabels: z.array(z.string()).optional().describe("At least one of these labels"),
  wayfinderTickets: z
    .boolean()
    .optional()
    .describe(`Only Wayfinder tickets: Work Items labelled ${WAYFINDER_TICKET_LABELS.join(", ")}. Not with anyLabels.`),
  milestone: z.string().optional().describe("Milestone title"),
  parent: z.string().optional().describe("The parent Work Item's URL or full reference, to list its children"),
  search: z.string().optional().describe("Text to find in titles and descriptions"),
};

/** The filters, with the parent already resolved to its global ID. */
export type Filters = Omit<z.infer<z.ZodObject<typeof FILTER_SCHEMA>>, "parent"> & { parentId?: string };

function entry(node: any): ListEntry {
  const widget = (type: string) => widgetOf(node, type);
  const { reference, title, type, state, url } = summaryOf(node);
  return {
    reference,
    title,
    type,
    state,
    assignees: (widget("ASSIGNEES")?.assignees?.nodes ?? []).map((a: any) => a.username),
    labels: (widget("LABELS")?.labels?.nodes ?? []).map((l: any) => l.title),
    milestone: widget("MILESTONE")?.milestone?.title ?? null,
    parent: widget("HIERARCHY")?.parent?.reference ?? null,
    updatedAt: node.updatedAt,
    url,
  };
}

export class Lists {
  constructor(private readonly gitlab: GitLab) {}

  private async variables(filters: Filters): Promise<Record<string, unknown>> {
    const nonEmpty = (values?: string[]) => (values?.length ? values : undefined);
    const assignees = [...(filters.assignees ?? [])];
    if (filters.assignedToMe) {
      const { username } = await this.gitlab.instance.probe();
      if (!assignees.includes(username)) assignees.push(username);
    }
    return {
      state: filters.state ?? "opened",
      types: (filters.types?.length ? filters.types : SUPPORTED_TYPES).map((t) => t.toUpperCase()),
      sort: "UPDATED_DESC",
      assigneeUsernames: nonEmpty(assignees),
      authorUsername: filters.author || undefined,
      labelName: nonEmpty(filters.labels),
      not: filters.excludeLabels?.length ? { labelName: filters.excludeLabels } : undefined,
      or: this.anyOfLabels(filters),
      milestoneTitle: filters.milestone ? [filters.milestone] : undefined,
      parentIds: filters.parentId ? [filters.parentId] : undefined,
      search: filters.search || undefined,
      in: filters.search ? ["TITLE", "DESCRIPTION"] : undefined,
    };
  }

  /** GitLab takes one set of labels a Work Item needs at least one of. */
  private anyOfLabels(filters: Filters): { labelNames: string[] } | undefined {
    if (filters.wayfinderTickets && filters.anyLabels?.length) {
      throw refused("Use anyLabels or wayfinderTickets, not both: GitLab takes one set of labels to match any of.");
    }
    if (filters.wayfinderTickets) return { labelNames: WAYFINDER_TICKET_LABELS };
    return filters.anyLabels?.length ? { labelNames: filters.anyLabels } : undefined;
  }

  /** Lists a project's or group's Work Items, subgroups and projects included. */
  async within(fullPath: string, filters: Filters, limit = DEFAULT_LIMIT, after?: string): Promise<ListResult> {
    await this.gitlab.instance.requireSupported();
    const base = { fullPath, includeDescendants: true, ...(await this.variables(filters)) };
    return this.pages(limit, after, async (first, cursor) => {
      const data = await this.gitlab.gateway.graphql("ListWorkItems", NAMESPACE_LIST, { ...base, first, after: cursor });
      if (!data?.namespace) return null;
      return data.namespace.workItems;
    }, fullPath);
  }

  /** The signed-in user's Work Items across the Instance, assigned to them. */
  async mine(filters: Filters, limit = DEFAULT_LIMIT, after?: string): Promise<ListResult> {
    await this.gitlab.instance.requireSupported();
    const base = await this.variables({ ...filters, assignedToMe: true });
    return this.pages(limit, after, async (first, cursor) => {
      const data = await this.gitlab.gateway.graphql("ListMyWorkItems", MY_LIST, { ...base, first, after: cursor });
      return data?.currentUser?.workItems ?? null;
    }, "Your Work Items");
  }

  private async pages(
    limit: number,
    after: string | undefined,
    fetchPage: (first: number, after: string | undefined) => Promise<any>,
    what: string,
  ): Promise<ListResult> {
    const wanted = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
    const items: ListEntry[] = [];
    let cursor = after;
    let hasMore = false;
    let endCursor: string | null = null;
    while (items.length < wanted) {
      const connection = await fetchPage(Math.min(PAGE_MAX, wanted - items.length), cursor);
      if (!connection) throw notFound(what, this.gitlab.config);
      items.push(...(connection.nodes ?? []).map(entry));
      hasMore = Boolean(connection.pageInfo?.hasNextPage);
      endCursor = connection.pageInfo?.endCursor ?? null;
      if (!hasMore || !endCursor) break;
      cursor = endCursor;
    }
    return { items, hasMore, endCursor: hasMore ? endCursor : null };
  }
}
