// How Writes read to the user: previews before anything is sent, and reports after.
import type { WorkItem } from "../reader.js";
import type { Plan } from "./plan.js";
import type { WriteResult } from "./writes.js";

export const joinOrNone = (values: string[]) => (values.length ? values.join(", ") : "none");

/** Lines GitLab runs as quick actions (a slash command starting a line, outside code blocks). */
function quickActions(text: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^\/[a-z_]+(\s|$)/.test(line)) found.push(line.trim());
  }
  return found;
}

/** A preview line warning that GitLab will run some lines instead of posting or saving them. */
export function quickActionWarning(text: string, verb: "posting" | "saving"): string[] {
  const lines = quickActions(text);
  return lines.length ? [`  ! GitLab runs these lines as quick actions instead of ${verb} them: ${lines.join(", ")}`] : [];
}

export function quote(body: string): string[] {
  return body.split("\n").map((line) => `  > ${line}`);
}

export function excerpt(body: string, length = 80): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

export function stateLines(item: WorkItem): string[] {
  return [
    `  ${item.title} [${item.type}, ${item.state}]`,
    `  labels: ${joinOrNone(item.labels.map((l) => l.title))}`,
    `  assignees: ${joinOrNone(item.assignees.map((a) => a.username))}`,
    `  milestone: ${item.milestone?.title ?? "none"}, due: ${item.dueDate ?? "none"}`,
  ];
}

/** Every Write in full, numbered as the user sees them. */
function writeLines(plan: Plan): string[] {
  return plan.writes.flatMap((write) => [`${write.number}. ${write.preview[0]}`, ...write.preview.slice(1)]);
}

export function renderPreview(plan: Plan): string {
  const count = `${plan.writes.length} Write${plan.writes.length === 1 ? "" : "s"}`;
  return [`Plan ${plan.id}: ${count}. Nothing has been sent yet.`, ...writeLines(plan)].join("\n");
}

/**
 * The confirmation dialog's message. Claude Code's terminal shows only its first three lines,
 * so it opens on the Writes: a lone Write in full, or a list of them all ahead of the detail.
 */
export function renderConfirmation(plan: Plan): string {
  if (plan.writes.length === 1) return writeLines(plan).join("\n");
  return [...plan.writes.map((write) => `${write.number}. ${write.preview[0]}`), "", ...writeLines(plan)].join("\n");
}

export function renderReport(results: WriteResult[]): string {
  return results
    .map((r) => {
      const head = `${r.number}. ${r.summary}: ${r.outcome}${r.created ? `, created ${r.created} ${r.url}` : ""}`;
      const notes = [r.detail ? `   ${r.detail}` : "", ...r.didNotStick.map((d) => `   didn't stick: ${d}`)].filter(Boolean);
      return [head, ...notes].join("\n");
    })
    .join("\n");
}
