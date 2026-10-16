import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hook/write-guard.ts
import { readFileSync } from "node:fs";

// src/tool-names.ts
var TOOL_PREFIX = "mcp__plugin_gitlab-work-items_gitlab__";
var TOOLS = {
  status: "read",
  fetch_work_item: "read",
  list_work_items: "read",
  my_work_items: "read",
  pick_work_item: "read",
  prepare_writes: "read",
  apply_writes: "write"
};

// src/hook/write-guard.ts
function decide(toolName) {
  if (!toolName.startsWith(TOOL_PREFIX)) return void 0;
  const kind = TOOLS[toolName.slice(TOOL_PREFIX.length)];
  if (kind === "write") {
    return {
      permissionDecision: "ask",
      permissionDecisionReason: "This sends the previewed Writes to GitLab. Only approve it if you've reviewed the preview."
    };
  }
  if (kind === "read") {
    return { permissionDecision: "allow", permissionDecisionReason: "Reading from GitLab changes nothing." };
  }
  return void 0;
}
var input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
}
var decision = typeof input.tool_name === "string" ? decide(input.tool_name) : void 0;
if (decision) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
}
