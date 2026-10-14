// The plugin's PreToolUse hook. Claude Code's approval prompt is the confirmation for a
// Write wherever the client can't ask the user directly, so apply_writes always asks,
// even if the user once chose "always allow". The read-only tools never prompt.
import { readFileSync } from "node:fs";
import { TOOLS, TOOL_PREFIX } from "../tool-names.js";

function decide(toolName: string): { permissionDecision: "ask" | "allow"; permissionDecisionReason: string } | undefined {
  if (!toolName.startsWith(TOOL_PREFIX)) return undefined;
  const kind = (TOOLS as Record<string, "read" | "write">)[toolName.slice(TOOL_PREFIX.length)];
  if (kind === "write") {
    return {
      permissionDecision: "ask",
      permissionDecisionReason: "This sends the previewed Writes to GitLab. Only approve it if you've reviewed the preview.",
    };
  }
  if (kind === "read") {
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
