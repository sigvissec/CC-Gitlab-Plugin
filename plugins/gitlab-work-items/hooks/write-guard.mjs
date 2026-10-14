import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hook/write-guard.ts
import { readFileSync } from "node:fs";
var PREFIX = "mcp__plugin_gitlab-work-items_gitlab__";
var WRITE_TOOLS = /* @__PURE__ */ new Set(["apply_writes"]);
var READ_TOOLS = /* @__PURE__ */ new Set(["status", "fetch_work_item", "list_work_items", "my_work_items", "prepare_writes"]);
function decide(toolName) {
  if (!toolName.startsWith(PREFIX)) return void 0;
  const tool = toolName.slice(PREFIX.length);
  if (WRITE_TOOLS.has(tool)) {
    return {
      permissionDecision: "ask",
      permissionDecisionReason: "This sends the previewed Writes to GitLab. Only approve it if you've reviewed the preview."
    };
  }
  if (READ_TOOLS.has(tool)) {
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
export {
  PREFIX
};
