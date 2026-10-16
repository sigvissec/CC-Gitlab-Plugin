// Runs the session-start hook the way Claude Code does: JSON on stdin (with the session's working
// directory), the plugin's settings as CLAUDE_PLUGIN_OPTION_* variables, and its answer as JSON
// on stdout. GitLab sits behind the fake glab, or behind the recorder when recording.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Cassette } from "./cassette.js";
import type { GlabCall } from "./harness.js";

const ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(ROOT, "plugins/gitlab-work-items/hooks/session-start.mjs");
const FAKE_GLAB_DIR = join(ROOT, "test/support/fake-glab");
const RECORDING_GLAB_DIR = join(ROOT, "test/support/recording-glab");

/** A git repo with the given remotes, to start the session in. */
export function repo(remotes: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gwi-repo-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  for (const [name, url] of Object.entries(remotes)) git("remote", "add", name, url);
  return dir;
}

export interface HookRun {
  code: number | null;
  /** What the user sees as Claude Code starts. */
  shown?: string;
  /** What Claude is given. */
  context?: string;
  glabCalls: GlabCall[];
}

export interface HookOptions {
  cwd: string;
  cassette: Cassette;
  /** Record against a real GitLab instead of replaying, as the MCP harness does. */
  record?: { cassettePath: string; realGlab: string; glabConfigDir: string };
  instanceUrl?: string;
  token?: string;
}

export function runSessionStart(options: HookOptions): HookRun {
  chmodSync(join(FAKE_GLAB_DIR, "glab"), 0o755);
  chmodSync(join(RECORDING_GLAB_DIR, "glab"), 0o755);
  const dir = mkdtempSync(join(tmpdir(), "gwi-hook-"));
  const cassettePath = join(dir, "cassette.json");
  const logPath = join(dir, "glab-calls.jsonl");
  writeFileSync(cassettePath, JSON.stringify(options.cassette));
  const env = {
    PATH: [options.record ? RECORDING_GLAB_DIR : FAKE_GLAB_DIR, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: dir,
    FAKE_GLAB_CASSETTE: cassettePath,
    FAKE_GLAB_LOG: logPath,
    CLAUDE_PLUGIN_OPTION_INSTANCE_URL: options.instanceUrl ?? "https://gitlab.example.com",
    CLAUDE_PLUGIN_OPTION_TOKEN: options.token ?? "",
    CLAUDE_PLUGIN_OPTION_FOOTER: "true",
    ...(options.record
      ? { REAL_GLAB: options.record.realGlab, RECORD_CASSETTE: options.record.cassettePath, GLAB_CONFIG_DIR: options.record.glabConfigDir }
      : {}),
  };
  const input = { session_id: "s", hook_event_name: "SessionStart", source: "startup", cwd: options.cwd };
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8", env, cwd: options.cwd });
  const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
  const glabCalls = existsSync(logPath)
    ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { code: result.status, shown: output.systemMessage, context: output.hookSpecificOutput?.additionalContext, glabCalls };
}
