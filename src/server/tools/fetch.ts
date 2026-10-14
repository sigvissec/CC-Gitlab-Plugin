import type { Config } from "../config.js";
import type { Reader, Thread, WorkItem } from "../reader.js";
import { parseReference } from "../references.js";
import { answer } from "../result.js";

const MR_LIMIT = 10;

function focusOf(item: WorkItem, noteId: string | undefined): { threadId: string; commentId: string } | undefined {
  if (!noteId) return undefined;
  const commentId = `gid://gitlab/Note/${noteId}`;
  const thread = item.threads.find((t) => t.comments.some((c) => c.id === commentId));
  return thread ? { threadId: thread.id, commentId } : undefined;
}

function threadText(thread: Thread, index: number): string {
  const status = thread.resolvable ? (thread.resolved ? "resolved" : "unresolved") : "comment";
  const lines = [`Thread ${index + 1} (${status}, id ${thread.id}${thread.canResolve ? "" : ", you can't resolve it"}):`];
  for (const c of thread.comments) {
    lines.push(`  - ${c.author}${c.internal ? " (internal)" : ""}, ${c.createdAt}, comment ${c.id}:`);
    lines.push(...c.body.split("\n").map((line) => `      ${line}`));
  }
  return lines.join("\n");
}

export async function fetchWorkItem(config: Config, reader: Reader, reference: string) {
  const ref = parseReference(reference, config);
  const item = await reader.fetch(ref);
  reader.remember(item);
  const unresolved = item.threads.filter((t) => t.resolvable && !t.resolved).length;
  const shown = item.mergeRequests.all.slice(0, MR_LIMIT);
  const more = item.mergeRequests.all.length - shown.length;
  const focus = focusOf(item, ref.noteId);

  const data = {
    reference: item.reference,
    url: item.url,
    title: item.title,
    type: item.type,
    state: item.state,
    confidential: item.confidential,
    author: item.author,
    assignees: item.assignees.map((a) => a.username),
    labels: item.labels.map((l) => l.title),
    milestone: item.milestone?.title ?? null,
    dueDate: item.dueDate,
    ...(item.weight !== undefined ? { weight: item.weight } : {}),
    parent: item.parent ? { reference: item.parent.reference, title: item.parent.title, url: item.parent.url } : null,
    childrenCount: item.children.length,
    children: item.children.map(({ reference, title, type, state }) => ({ reference, title, type, state })),
    linkedItemsCount: item.linkedItems.length,
    linkedItems: item.linkedItems.map(({ reference, title, state, linkType }) => ({ reference, title, state, linkType })),
    threads: { total: item.threads.length, unresolved },
    mergeRequests: { shown, more, hidden: item.mergeRequests.hidden },
    updatedAt: item.updatedAt,
    ...(focus ? { focus } : {}),
  };

  const digest = [
    `${item.reference}: ${item.title}`,
    item.url,
    `${item.type}, ${item.state}${item.confidential ? ", confidential" : ""}`,
    `Assignees: ${data.assignees.join(", ") || "none"}`,
    `Labels: ${data.labels.join(", ") || "none"}`,
    `Milestone: ${data.milestone ?? "none"}  Due: ${item.dueDate ?? "none"}${item.weight !== undefined ? `  Weight: ${item.weight ?? "none"}` : ""}`,
    `Parent: ${item.parent ? `${item.parent.reference} (${item.parent.title})` : "none"}`,
    `Children: ${item.children.length}  Linked Items: ${item.linkedItems.length}`,
    `Threads: ${item.threads.length} (${unresolved} unresolved)`,
  ];
  const mrLines = shown.map((m) => `  - ${m.relation} ${m.reference}: ${m.title} [${m.state}] ${m.url}`);
  if (more > 0) mrLines.push(`  - ${more} more not shown`);
  if (item.mergeRequests.hidden > 0) mrLines.push(`  - ${item.mergeRequests.hidden} more that your token can't see`);
  if (item.type === "Issue" || item.type === "Task") {
    digest.push(mrLines.length ? `Merge requests:\n${mrLines.join("\n")}` : "Merge requests: none");
  }
  if (focus) digest.push(`Focus: comment ${focus.commentId} in thread ${focus.threadId}`);

  const details = [
    "",
    "Description:",
    item.description || "(empty)",
    ...(item.children.length ? ["", "Children:", ...item.children.map((c) => `  - ${c.reference} ${c.title} [${c.type}, ${c.state}]`)] : []),
    ...(item.linkedItems.length ? ["", "Linked Items:", ...item.linkedItems.map((l) => `  - ${l.linkType} ${l.reference} ${l.title} [${l.state}]`)] : []),
    ...(item.threads.length ? ["", ...item.threads.map(threadText)] : []),
  ];
  return answer([...digest, ...details].join("\n"), data);
}
