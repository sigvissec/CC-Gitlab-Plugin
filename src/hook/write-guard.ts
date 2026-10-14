// The plugin's PreToolUse hook. Claude Code's approval prompt is the confirmation for a
// Write wherever the client can't ask the user directly, so apply_writes always asks,
// even if the user once chose "always allow". The read-only tools never prompt.
import { readFileSync } from "node:fs";

export const PREFIX = "mcp__plugin_gitlab-work-items_gitlab__";
const WRITE_TOOLS = new Set(["apply_writes"]);
const READ_TOOLS = new Set(["status", "fetch_work_item", "list_work_items", "my_work_items", "prepare_writes"]);

function decide(toolName: string): { permissionDecision: "ask" | "allow"; permissionDecisionReason: string } | undefined {
  if (!toolName.startsWith(PREFIX)) return undefined;
  const tool = toolName.slice(PREFIX.length);
  if (WRITE_TOOLS.has(tool)) {
    return {
      permissionDecision: "ask",
      permissionDecisionReason: "This sends the previewed Writes to GitLab. Only approve it if you've reviewed the preview.",
    };
  }
  if (READ_TOOLS.has(tool)) {
    return { permissionDecision: "allow", permissionDecisionReason: "Reading from GitLab changes nothing." };
  }
  return undefined;
}

let input: { tool_name?: unknown } = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Nothing to decide on; let Claude Code apply its normal rules.
}
const decision = typeof input.tool_name === "string" ? decide(input.tool_name) : undefined;
if (decision) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
}
