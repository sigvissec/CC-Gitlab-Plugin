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

/** The filters as a tool takes them: a parent by its Reference. */
export type ToolFilters = Omit<Filters, "parentId"> & { parent?: string };

/** Resolves a parent given by Reference to the global ID GitLab filters on. */
export async function resolveFilters(config: Config, reader: Reader, { parent, ...filters }: ToolFilters): Promise<Filters> {
  return parent ? { ...filters, parentId: (await reader.resolve(parseReference(parent, config))).id } : filters;
}

/** Lists a project's or group's Work Items. */
export async function listWorkItems(
  config: Config,
  reader: Reader,
  lists: Lists,
  { fullPath, limit, after, ...filters }: ToolFilters & { fullPath: string; limit?: number; after?: string },
) {
  return listAnswer(`Work Items in ${fullPath}`, await lists.within(fullPath, await resolveFilters(config, reader, filters), limit, after));
}
