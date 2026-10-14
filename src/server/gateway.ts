// The only way the server reaches GitLab: one GraphQL request at a time through `glab api`,
// with the token chosen by precedence and every other token variable removed.
import { spawn } from "node:child_process";
import type { Config } from "./config.js";

/** The oldest glab the test suites pass with. */
export const MINIMUM_GLAB = "1.123.0";

export function glabMeetsMinimum(version: string): boolean {
  const have = version.split(".").map(Number);
  const need = MINIMUM_GLAB.split(".").map(Number);
  for (let i = 0; i < need.length; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) > (need[i] ?? 0);
  }
  return true;
}

export const TOKEN_VARIABLES = ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"] as const;

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

/** The environment glab runs with: the server's own, minus every token variable. */
function scrubbed(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of TOKEN_VARIABLES) delete env[name];
  return env;
}

export class Gateway {
  private tokenSource: Promise<TokenSource> | undefined;

  constructor(
    private readonly config: Config,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Which token the server uses, decided once per session. */
  source(): Promise<TokenSource> {
    this.tokenSource ??= this.chooseSource();
    return this.tokenSource;
  }

  private async chooseSource(): Promise<TokenSource> {
    if (this.config.settingToken) return "plugin setting";
    const status = await run(
      ["auth", "status", "--hostname", this.config.glabHost, "--output", "json"],
      scrubbed(this.baseEnv),
    );
    if (status.code === 0) return "glab login";
    if (this.baseEnv.GITLAB_TOKEN?.trim()) return "GITLAB_TOKEN";
    throw new GitLabError(
      `No GitLab token for ${this.config.baseUrl}. Either log glab in with \`glab auth login --hostname ${this.config.glabHost}\`, or enter a token in the plugin's settings.`,
      "not-set-up",
    );
  }

  /** glab's environment: only the chosen token, if glab needs one handed to it. */
  private async envFor(): Promise<NodeJS.ProcessEnv> {
    const source = await this.source();
    const env = scrubbed(this.baseEnv);
    if (source === "plugin setting") env.GITLAB_TOKEN = this.config.settingToken;
    if (source === "GITLAB_TOKEN") env.GITLAB_TOKEN = this.baseEnv.GITLAB_TOKEN;
    return env;
  }

  async glabVersion(): Promise<string> {
    const result = await run(["version"], scrubbed(this.baseEnv));
    const match = /glab (?:version )?v?(\d+\.\d+\.\d+)/.exec(result.stdout);
    if (!match?.[1]) throw new GitLabError(`Couldn't read glab's version: ${result.stdout || result.stderr}`, "glab");
    return match[1];
  }

  /** Runs one GraphQL operation and returns its `data`, or throws GitLab's own error text. */
  async graphql<T = any>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
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
    return parsed.data as T;
  }
}
