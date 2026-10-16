// How tools answer Claude: readable text, which is all Claude reads.
//
// The same facts go along as data in `_meta` for other MCP clients. They aren't sent as
// structuredContent, because Claude Code shows the model the structured content in place of
// the text when a result has both, and the text carries what Claude needs: descriptions,
// Comments, previews.
import { GitLabError } from "./gateway.js";

/** Where in a result's `_meta` the data rides. */
export const DATA_KEY = "gitlab-work-items/data";

export interface ToolAnswer {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export function answer(text: string, data?: Record<string, unknown>): ToolAnswer {
  return { content: [{ type: "text", text }], ...(data ? { _meta: { [DATA_KEY]: data } } : {}) };
}

export function failure(text: string, data?: Record<string, unknown>): ToolAnswer {
  return { ...answer(text, data), isError: true };
}

/** Wraps a tool so GitLab and setup problems reach Claude as readable errors. */
export function guarded<A>(handler: (args: A) => Promise<ToolAnswer>): (args: A) => Promise<ToolAnswer> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof GitLabError) {
        const hint = error.kind === "not-set-up" || error.kind === "glab-missing" ? " Run /gitlab-work-items:status for details." : "";
        return failure(`${error.message}${hint}`, { error: error.kind, message: error.message });
      }
      throw error;
    }
  };
}
