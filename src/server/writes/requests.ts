// What Claude may ask to write, as the schemas prepare_writes accepts. The request types the
// planner works with are derived from them, so the two can't drift apart.
import { z } from "zod";

export const MAX_WRITES = 20;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const EDIT = z.object({
  kind: z.literal("edit"),
  reference: z.string().describe("Work Item URL or full reference"),
  title: z.string().optional(),
  description: z.string().optional().describe("The whole new description"),
  addLabels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional().describe("Usernames; replaces the current assignees"),
  milestone: z.string().nullable().optional().describe("Milestone title, or null to clear it"),
  state: z.enum(["close", "reopen"]).optional(),
  dueDate: DATE.nullable().optional().describe("YYYY-MM-DD, or null to clear it"),
  weight: z.number().int().min(0).nullable().optional().describe("Needs GitLab EE Premium; null clears it"),
  parent: z.string().nullable().optional().describe("The parent's Reference (a Task's parent Issue), or null to remove it"),
  addLinks: z
    .array(z.object({ reference: z.string(), linkType: z.enum(["relates_to", "blocks", "is_blocked_by"]) }))
    .optional()
    .describe("blocks and is_blocked_by need GitLab Premium"),
  removeLinks: z.array(z.string()).optional().describe("References of Linked Items to unlink"),
});

const COMMENT = z.object({
  kind: z.literal("comment"),
  reference: z.string().describe("Work Item URL or full reference"),
  body: z.string().min(1).describe("The Comment, in Markdown"),
  internal: z.boolean().optional().describe("Internal Comment; public unless the user asks"),
  startThread: z.boolean().optional().describe("Start a resolvable Thread instead of a plain Comment; only when the user asks"),
});

const REPLY = z.object({
  kind: z.literal("reply"),
  reference: z.string().describe("A Comment link, or the Work Item's Reference together with thread"),
  thread: z.string().optional().describe("The Thread's ID from a Fetch"),
  body: z.string().min(1).describe("The reply, in Markdown"),
});

const CREATE = z.object({
  kind: z.literal("create"),
  type: z.enum(["Issue", "Task"]),
  project: z.string().optional().describe("For an Issue: the project's full path"),
  parent: z.string().optional().describe("For a Task: the parent Issue's Reference"),
  title: z.string().min(1),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  milestone: z.string().optional(),
  dueDate: DATE.optional(),
  weight: z.number().int().min(0).optional(),
  confidential: z.boolean().optional().describe("Only when the user asks"),
});

const RESOLVE = z.object({
  kind: z.literal("resolve"),
  reference: z.string().describe("A Comment link, or the Work Item's Reference together with thread"),
  thread: z.string().optional().describe("The Thread's ID from a Fetch"),
});

export const WRITE_SCHEMA = z.discriminatedUnion("kind", [EDIT, COMMENT, REPLY, CREATE, RESOLVE]);

export type EditRequest = z.infer<typeof EDIT>;
export type CommentRequest = z.infer<typeof COMMENT>;
/** A reply in a Thread, or resolving one. */
export type ThreadRequest = z.infer<typeof REPLY> | z.infer<typeof RESOLVE>;
export type CreateRequest = z.infer<typeof CREATE>;
export type WriteRequest = z.infer<typeof WRITE_SCHEMA>;
