// Reading the Work Item nodes GitLab's GraphQL API returns.

/** A Work Item node's widget of one type, if GitLab returned it. */
export const widgetOf = (node: any, type: string): any => (node?.widgets ?? []).find((w: any) => w.type === type);

/** A Work Item's state, as the plugin reports it. */
export const stateOf = (state: string): "open" | "closed" => (state === "CLOSED" ? "closed" : "open");
