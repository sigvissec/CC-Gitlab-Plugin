// Reading the Work Item nodes GitLab's GraphQL API returns.

/** A Work Item named in another's Hierarchy, Linked Items, or a list. */
export interface ItemSummary {
  id: string;
  reference: string;
  title: string;
  type: string;
  state: "open" | "closed";
  url: string;
}

/** The GraphQL fields an ItemSummary is read from. */
export const SUMMARY_FIELDS = "id reference(full: true) title state webUrl workItemType { name }";

/** A Work Item node's widget of one type, if GitLab returned it. */
export const widgetOf = (node: any, type: string): any => (node?.widgets ?? []).find((w: any) => w.type === type);

/** A Work Item's state, as the plugin reports it. */
export const stateOf = (state: string): "open" | "closed" => (state === "CLOSED" ? "closed" : "open");

/** A Work Item node's type name, as GitLab gives it. */
export const typeOf = (node: any): string => node?.workItemType?.name ?? "Unknown";

export function summaryOf(node: any): ItemSummary {
  return { id: node.id, reference: node.reference, title: node.title, type: typeOf(node), state: stateOf(node.state), url: node.webUrl };
}
