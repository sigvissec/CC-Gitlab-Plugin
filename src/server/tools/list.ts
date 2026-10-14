import type { Config } from "../config.js";
import type { Filters, ListResult, Lists } from "../lists.js";
import type { Reader } from "../reader.js";
import { parseReference } from "../references.js";
import { answer } from "../result.js";

export function listAnswer(heading: string, result: ListResult) {
  const lines = result.items.map((item) => {
    const extras = [
      item.assignees.length ? `assignees: ${item.assignees.join(", ")}` : "",
      item.labels.length ? `labels: ${item.labels.join(", ")}` : "",
      item.milestone ? `milestone: ${item.milestone}` : "",
      item.parent ? `parent: ${item.parent}` : "",
    ].filter(Boolean);
    return `- ${item.reference} ${item.title} [${item.type}, ${item.state}, updated ${item.updatedAt}]${extras.length ? ` (${extras.join("; ")})` : ""} ${item.url}`;
  });
  const footer = result.hasMore
    ? `More Work Items exist. To continue, call again with after: "${result.endCursor}".`
    : "That's all of them.";
  const text = [`${heading}: ${result.items.length} shown`, ...lines, footer].join("\n");
  return answer(text, { ...result });
}

/** Lists a project's or group's Work Items; a parent given by Reference is resolved first. */
export async function listWorkItems(
  config: Config,
  reader: Reader,
  lists: Lists,
  { fullPath, limit, after, parent, ...filters }: Omit<Filters, "parentId"> & { fullPath: string; limit?: number; after?: string; parent?: string },
) {
  const parentId = parent ? (await reader.resolve(parseReference(parent, config))).id : undefined;
  return listAnswer(`Work Items in ${fullPath}`, await lists.within(fullPath, { ...filters, parentId }, limit, after));
}
