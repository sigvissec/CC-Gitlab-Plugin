// The only way the server reaches GitLab: one GraphQL request at a time through `glab api`,
// with the token chosen by precedence and every other token variable removed.
import { spawn } from "node:child_process";
import type { Config } from "./config.js";
import { onceItWorks } from "./once.js";

/**
 * Variables glab reads that decide which credential it sends, how, or whether it checks TLS.
 * glab never sees any the plugin didn't choose itself, so nothing meant for another tool or
 * another GitLab reaches this one (glab 1.123.0: internal/config/schema.go, config_mapping.go).
 */
const REMOVED_VARIABLES = [
  "GITLAB_TOKEN",
  "GITLAB_ACCESS_TOKEN",
  "OAUTH_TOKEN",
  "JOB_TOKEN",
  "CI_JOB_TOKEN",
  "GLAB_IS_OAUTH2",
  // With GITLAB_CI=true it signs in from CI variables and ignores the endpoint variables.
  "GLAB_ENABLE_CI_AUTOLOGIN",
  "GLAB_SKIP_TLS_VERIFY",
  "SKIP_TLS_VERIFY",
] as const;

/** No update checks, telemetry, or what's-new notes on stderr from glab runs the plugin starts. */
const QUIET = { GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", GLAB_SHOW_WHATS_NEW: "false" };

export type TokenSource = "plugin setting" | "glab login" | "GITLAB_TOKEN";

export class GitLabError extends Error {
  constructor(
    message: string,
    readonly kind: "not-set-up" | "glab-missing" | "graphql" | "glab" | "refused" | "not-found",
  ) {
    super(message);
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("glab", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new GitLabError("glab isn't installed or isn't on PATH. Install glab, then try again.", "glab-missing"));
      } else reject(error);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

/** The environment glab runs with: the server's own, minus the removed variables, kept quiet. */
function scrubbed(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...QUIET };
  for (const name of REMOVED_VARIABLES) delete env[name];
  return env;
}

/** How to sign glab in to this Instance, as a command the user can run. */
function loginCommand(config: Config): string {
  const { GITLAB_API_HOST, GLAB_API_PROTOCOL, GITLAB_SUBFOLDER } = config.endpoint;
  const parts = [`glab auth login --hostname ${config.glabHost}`];
  if (GITLAB_API_HOST !== config.glabHost) parts.push(`--api-host ${GITLAB_API_HOST}`);
  if (GLAB_API_PROTOCOL !== "https") parts.push(`--api-protocol ${GLAB_API_PROTOCOL}`);
  const login = parts.join(" ");
  // glab's login checks the token against the API, which needs the subfolder already set.
  return GITLAB_SUBFOLDER === "/" ? login : `glab config set subfolder ${GITLAB_SUBFOLDER} --host ${config.glabHost}\`, then \`${login}`;
}

export class Gateway {
  constructor(private readonly config: Config) {}

  /** Which token the server uses: decided once per session, or again until one is found. */
  readonly source = onceItWorks(() => this.chooseSource());

  private async chooseSource(): Promise<TokenSource> {
    if (this.config.settingToken) return "plugin setting";
    const status = await run(
      ["auth", "status", "--hostname", this.config.glabHost, "--output", "json"],
      { ...scrubbed(process.env), ...this.config.endpoint },
    );
    if (status.code === 0) return "glab login";
    if (process.env.GITLAB_TOKEN?.trim()) return "GITLAB_TOKEN";
    throw new GitLabError(
      `No GitLab token for ${this.config.baseUrl}. Either log glab in with \`${loginCommand(this.config)}\`, or enter a token in the plugin's settings.`,
      "not-set-up",
    );
  }

  /** glab's environment: only the chosen token, if glab needs one handed to it. */
  private async envFor(): Promise<NodeJS.ProcessEnv> {
    const source = await this.source();
    const env: NodeJS.ProcessEnv = { ...scrubbed(process.env), ...this.config.endpoint };
    if (source === "plugin setting") env.GITLAB_TOKEN = this.config.settingToken;
    if (source === "GITLAB_TOKEN") env.GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    return env;
  }

  async glabVersion(): Promise<string> {
    const result = await run(["version"], scrubbed(process.env));
    const match = /glab (?:version )?v?(\d+\.\d+\.\d+)/.exec(result.stdout);
    if (!match?.[1]) throw new GitLabError(`Couldn't read glab's version: ${result.stdout || result.stderr}`, "glab");
    return match[1];
  }

  /** Runs one GraphQL operation and returns its `data`, or throws GitLab's own error text. */
  async graphql(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
    const env = await this.envFor();
    const body = JSON.stringify({ operationName, query, variables });
    const result = await run(["api", "graphql", "--hostname", this.config.glabHost, "--input", "-"], env, body);
    let parsed: any;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      const detail = (result.stderr || result.stdout).trim().replace(/^glab: /, "");
      throw new GitLabError(detail || `glab exited with code ${result.code}`, "glab");
    }
    if (parsed?.errors?.length) {
      throw new GitLabError(parsed.errors.map((e: { message: string }) => e.message).join("; "), "graphql");
    }
    if (result.code !== 0) {
      throw new GitLabError((result.stderr || `glab exited with code ${result.code}`).trim().replace(/^glab: /, ""), "glab");
    }
    return parsed.data;
  }
}
