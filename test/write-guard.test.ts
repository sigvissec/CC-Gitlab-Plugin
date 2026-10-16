// The write-guard hook, driven the way Claude Code runs a PreToolUse hook: JSON on stdin,
// a decision as JSON on stdout.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const HOOK = resolve(import.meta.dirname, "../plugins/gitlab-work-items/hooks/write-guard.mjs");
const PREFIX = "mcp__plugin_gitlab-work-items_gitlab__";

function runHook(toolName: string) {
  const input = { session_id: "s", hook_event_name: "PreToolUse", tool_name: toolName, tool_input: {} };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
  return { code: result.status, output: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
}

describe("the write-guard hook", () => {
  it("always asks the user before apply_writes, even if they set it to always allow", () => {
    const { code, output } = runHook(`${PREFIX}apply_writes`);
    expect(code).toBe(0);
    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "ask" });
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/GitLab/);
  });

  it.each(["status", "fetch_work_item", "list_work_items", "my_work_items", "pick_work_item", "prepare_writes"])(
    "lets the read-only %s tool run without a prompt",
    (tool) => {
      const { code, output } = runHook(`${PREFIX}${tool}`);
      expect(code).toBe(0);
      expect(output.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "allow" });
    },
  );

  it("leaves every other tool alone", () => {
    for (const tool of ["Bash", "mcp__plugin_other_gitlab__apply_writes", `${PREFIX}something_new`]) {
      const { code, output } = runHook(tool);
      expect(code).toBe(0);
      expect(output).toBeUndefined();
    }
  });
});
