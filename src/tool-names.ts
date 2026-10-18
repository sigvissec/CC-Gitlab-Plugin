// The plugin's MCP tools, shared by the server that registers them and the hook that guards them.

/** How Claude Code names a tool from this plugin's "gitlab" MCP server. */
export const TOOL_PREFIX = "mcp__plugin_gitlab-work-items_gitlab__";

/**
 * Every tool and whether it reads or writes. Reading tools never need the user's approval
 * (prepare_writes only previews); apply_writes is the one tool that changes GitLab.
 */
export const TOOLS = {
  status: "read",
  fetch_work_item: "read",
  list_work_items: "read",
  my_work_items: "read",
  pick_work_item: "read",
  prepare_writes: "read",
  apply_writes: "write",
} as const;

export type ToolName = keyof typeof TOOLS;
