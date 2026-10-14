// How tools answer Claude: readable text, plus the same facts as structured content.
import { GitLabError } from "./gateway.js";

export interface ToolAnswer {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function answer(text: string, data?: Record<string, unknown>): ToolAnswer {
  return { content: [{ type: "text", text }], ...(data ? { structuredContent: data } : {}) };
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
