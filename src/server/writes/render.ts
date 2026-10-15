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

export function renderPreview(plan: Plan): string {
  const lines = [`Plan ${plan.id}: ${plan.writes.length} Write${plan.writes.length === 1 ? "" : "s"}. Nothing has been sent yet.`];
  for (const write of plan.writes) {
    lines.push(`${write.number}. ${write.preview[0]}`, ...write.preview.slice(1));
  }
  return lines.join("\n");
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
