import type { ListResult } from "../lists.js";
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
