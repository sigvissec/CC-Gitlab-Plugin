// The plugin's SessionStart hook. In a repo whose project is on the configured Instance, it shows
// the user the Wayfinder tickets they've claimed there, numbered, and tells Claude the same list,
// so "open 2" works. It shows nothing elsewhere, and never stops a session from starting.
import { readFileSync } from "node:fs";
import { readHookConfig } from "../server/config.js";
import { GitLabError } from "../server/gateway.js";
import { connect } from "../server/gitlab.js";
import { Wayfinder, type ClaimedWayfinderTicket, type ClaimedWayfinderTickets } from "../server/wayfinder.js";
import { repoProject } from "./repo.js";

interface Output {
  systemMessage: string;
  hookSpecificOutput?: { hookEventName: "SessionStart"; additionalContext: string };
}

function entry(ticket: ClaimedWayfinderTicket, index: number): string {
  const { map } = ticket;
  const onMap = map ? `; Wayfinder map: ${map.title ? `${map.title}, ` : ""}${map.reference} ${map.url}` : "";
  return `${index + 1}. ${ticket.reference} ${ticket.title} ${ticket.url} (${ticket.type}${onMap})`;
}

function report(project: string, claimed: ClaimedWayfinderTickets): Output {
  const entries = claimed.tickets.map(entry);
  if (claimed.more > 0) entries.push(`…and ${claimed.more} more; ask Claude to list them.`);
  const shown = [
    `Your Wayfinder tickets in ${project}:`,
    ...entries,
    "Say a number to open one in full, or pick one with /gitlab-work-items:open.",
  ].join("\n");
  const context = [
    `At session start, the gitlab-work-items plugin showed the user the Wayfinder tickets they've claimed in ${project} (open, labelled wayfinder:<type>, assigned to them):`,
    ...entries,
    "When the user names one of these by its number, Fetch it with fetch_work_item and show it in full.",
  ].join("\n");
  return { systemMessage: shown, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } };
}

async function run(): Promise<Output | undefined> {
  let input: { cwd?: unknown } = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // Claude Code always sends its input; without it, fall back to the working directory.
  }
  const config = readHookConfig();
  const project = repoProject(typeof input.cwd === "string" ? input.cwd : process.cwd(), config);
  if (!project) return undefined;
  try {
    const claimed = await new Wayfinder(connect(config)).claimedTickets(project);
    return claimed.tickets.length ? report(project, claimed) : undefined;
  } catch (error) {
    const reason = error instanceof GitLabError ? error.message : "something unexpected went wrong.";
    return { systemMessage: `gitlab-work-items couldn't check your Wayfinder tickets in ${project}: ${reason}` };
  }
}

const output = await run().catch(() => undefined);
if (output) process.stdout.write(JSON.stringify(output));
