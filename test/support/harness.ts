// Starts the bundled MCP server the way Claude Code does (a stdio subprocess) with a fake
// `glab` first on PATH, and talks to it as an MCP client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Cassette } from "./cassette.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER = join(ROOT, "plugins/gitlab-work-items/server/gitlab-work-items.mjs");
const FAKE_GLAB_DIR = join(ROOT, "test/support/fake-glab");
const RECORDING_GLAB_DIR = join(ROOT, "test/support/recording-glab");

export interface Session {
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  glabCalls(): GlabCall[];
  /** Elicitation requests the server sent, with the answer the test gave. */
  elicitations: { message: string }[];
  close(): Promise<void>;
}

export interface ToolResult {
  /** What Claude reads. */
  text: string;
  /** The same facts as data, from the result's `_meta`. */
  data: any;
  /** The result's structuredContent, which Claude Code shows the model in place of the text. */
  structured: unknown;
  isError: boolean;
}

export interface GlabCall {
  args: string[];
  /** The token variables glab received. */
  env: Record<string, string>;
  /** The variables telling glab which endpoint to call. */
  endpoint: Record<string, string>;
  host?: string;
  body?: { query: string; operationName?: string; variables?: Record<string, unknown> };
}

export interface StartOptions {
  cassette: Cassette;
  /**
   * Record against a real GitLab instead of replaying: the real glab runs behind a recorder
   * that writes what GitLab answered to this cassette path.
   */
  record?: { cassettePath: string; realGlab: string; glabConfigDir: string };
  baseUrl?: string;
  token?: string;
  footer?: boolean;
  /** Extra environment for the server process, such as a user's GITLAB_TOKEN. */
  env?: Record<string, string>;
  /** How the client answers elicitation; omit to act like a client without elicitation. */
  elicit?: (message: string) => ElicitResult;
  /** Leave the fake glab off PATH, as if glab weren't installed. */
  withoutGlab?: boolean;
}

export async function start(options: StartOptions): Promise<Session> {
  chmodSync(join(FAKE_GLAB_DIR, "glab"), 0o755);
  chmodSync(join(RECORDING_GLAB_DIR, "glab"), 0o755);
  const glabDir = options.record ? RECORDING_GLAB_DIR : FAKE_GLAB_DIR;
  const dir = mkdtempSync(join(tmpdir(), "gwi-test-"));
  const cassettePath = join(dir, "cassette.json");
  const logPath = join(dir, "glab-calls.jsonl");
  writeFileSync(cassettePath, JSON.stringify(options.cassette));

  const env: Record<string, string> = {
    PATH: [options.withoutGlab ? undefined : glabDir, dirname(process.execPath), "/usr/bin", "/bin"]
      .filter(Boolean)
      .join(":"),
    HOME: dir,
    FAKE_GLAB_CASSETTE: cassettePath,
    FAKE_GLAB_LOG: logPath,
    GITLAB_WORK_ITEMS_URL: options.baseUrl ?? "https://gitlab.example.com",
    GITLAB_WORK_ITEMS_TOKEN: options.token ?? "",
    GITLAB_WORK_ITEMS_FOOTER: options.footer === false ? "false" : "true",
    ...(options.record
      ? { REAL_GLAB: options.record.realGlab, RECORD_CASSETTE: options.record.cassettePath, GLAB_CONFIG_DIR: options.record.glabConfigDir }
      : {}),
    ...options.env,
  };

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: "pipe" });
  const capabilities = options.elicit ? { elicitation: { form: {} } } : {};
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities });
  const elicitations: { message: string }[] = [];
  if (options.elicit) {
    const answer = options.elicit;
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const message = String(request.params.message);
      elicitations.push({ message });
      return answer(message);
    });
  }
  await client.connect(transport);

  return {
    elicitations,
    async call(tool, args = {}) {
      const result = (await client.callTool({ name: tool, arguments: args })) as any;
      const text = (result.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      return { text, data: result._meta?.["gitlab-work-items/data"], structured: result.structuredContent, isError: Boolean(result.isError) };
    },
    glabCalls() {
      if (!existsSync(logPath)) return [];
      return readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async close() {
      await client.close();
    },
  };
}
