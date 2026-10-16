// The plugin's SessionStart hook. In a repo whose project is on the configured Instance, it shows
// the user the wayfinder tickets they've claimed there, numbered, and tells Claude the same list,
// so "open 2" works. It shows nothing elsewhere, and never stops a session from starting.
import { readFileSync } from "node:fs";
import { readHookConfig } from "../server/config.js";
import { Gateway, GitLabError } from "../server/gateway.js";
import { Instance } from "../server/instance.js";
import { Wayfinder, type ClaimedTicket, type ClaimedTickets } from "../server/wayfinder.js";
import { repoProject } from "./repo.js";

interface Output {
  systemMessage: string;
  hookSpecificOutput?: { hookEventName: "SessionStart"; additionalContext: string };
}

function entry(ticket: ClaimedTicket, index: number): string {
  const map = ticket.map ? `on the map ${ticket.map.title ? `${ticket.map.title}, ` : ""}${ticket.map.reference}` : "";
  return `${index + 1}. ${ticket.reference} ${ticket.title} (${[ticket.type, map].filter(Boolean).join(", ")})`;
}

function report(project: string, claimed: ClaimedTickets): Output {
  const entries = claimed.tickets.map(entry);
  if (claimed.more > 0) entries.push(`…and ${claimed.more} more; ask Claude to list them.`);
  const shown = [
    `Your wayfinder tickets in ${project}:`,
    ...entries,
    "Say a number to open one in full, or pick one with /gitlab-work-items:open.",
  ].join("\n");
  const context = [
    `At session start, the gitlab-work-items plugin showed the user the wayfinder tickets they've claimed in ${project} (open, labelled wayfinder:<type>, assigned to them):`,
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
  const gateway = new Gateway(config);
  try {
    const claimed = await new Wayfinder(config, gateway, new Instance(gateway)).claimedTickets(project);
    return claimed.tickets.length ? report(project, claimed) : undefined;
  } catch (error) {
    const reason = error instanceof GitLabError ? error.message : "something unexpected went wrong.";
    return { systemMessage: `gitlab-work-items couldn't check your wayfinder tickets in ${project}: ${reason}` };
  }
}

const output = await run().catch(() => undefined);
if (output) process.stdout.write(JSON.stringify(output));
