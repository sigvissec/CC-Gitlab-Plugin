import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hook/session-start.ts
import { readFileSync } from "node:fs";

// src/server/config.ts
function readHookConfig() {
  const env = process.env;
  return configOf(env.CLAUDE_PLUGIN_OPTION_INSTANCE_URL, env.CLAUDE_PLUGIN_OPTION_TOKEN, env.CLAUDE_PLUGIN_OPTION_FOOTER);
}
function configOf(instanceUrl, token, footer) {
  const raw = (instanceUrl || "https://gitlab.com").trim();
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: `${url.protocol}//${url.host}${path}`,
    glabHost: url.hostname,
    endpoint: {
      GITLAB_API_HOST: url.host,
      GLAB_API_PROTOCOL: url.protocol.replace(":", ""),
      GITLAB_SUBFOLDER: path.replace(/^\/+/, "") || "/"
    },
    settingToken: (token ?? "").trim(),
    footer: (footer ?? "true").trim().toLowerCase() !== "false"
  };
}

// src/server/gateway.ts
import { spawn } from "node:child_process";

// src/server/once.ts
function onceItWorks(check) {
  let answer;
  return () => answer ??= check().catch((error) => {
    answer = void 0;
    throw error;
  });
}

// src/server/gateway.ts
var REMOVED_VARIABLES = [
  "GITLAB_TOKEN",
  "GITLAB_ACCESS_TOKEN",
  "OAUTH_TOKEN",
  "JOB_TOKEN",
  "CI_JOB_TOKEN",
  "GLAB_IS_OAUTH2",
  // With GITLAB_CI=true it signs in from CI variables and ignores the endpoint variables.
  "GLAB_ENABLE_CI_AUTOLOGIN",
  "GLAB_SKIP_TLS_VERIFY",
  "SKIP_TLS_VERIFY"
];
var QUIET = { GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", GLAB_SHOW_WHATS_NEW: "false" };
var GitLabError = class extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
  kind;
};
function run(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("glab", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new GitLabError("glab isn't installed or isn't on PATH. Install glab, then try again.", "glab-missing"));
      } else reject(error);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}
function scrubbed(base) {
  const env = { ...base, ...QUIET };
  for (const name of REMOVED_VARIABLES) delete env[name];
  return env;
}
function loginCommand(config) {
  const { GITLAB_API_HOST, GLAB_API_PROTOCOL, GITLAB_SUBFOLDER } = config.endpoint;
  const parts = [`glab auth login --hostname ${config.glabHost}`];
  if (GITLAB_API_HOST !== config.glabHost) parts.push(`--api-host ${GITLAB_API_HOST}`);
  if (GLAB_API_PROTOCOL !== "https") parts.push(`--api-protocol ${GLAB_API_PROTOCOL}`);
  const login = parts.join(" ");
  return GITLAB_SUBFOLDER === "/" ? login : `glab config set subfolder ${GITLAB_SUBFOLDER} --host ${config.glabHost}\`, then \`${login}`;
}
var Gateway = class {
  constructor(config) {
    this.config = config;
  }
  config;
  /** Which token the server uses: decided once per session, or again until one is found. */
  source = onceItWorks(() => this.chooseSource());
  async chooseSource() {
    if (this.config.settingToken) return "plugin setting";
    const status = await run(
      ["auth", "status", "--hostname", this.config.glabHost, "--output", "json"],
      { ...scrubbed(process.env), ...this.config.endpoint }
    );
    if (status.code === 0) return "glab login";
    if (process.env.GITLAB_TOKEN?.trim()) return "GITLAB_TOKEN";
    throw new GitLabError(
      `No GitLab token for ${this.config.baseUrl}. Either log glab in with \`${loginCommand(this.config)}\`, or enter a token in the plugin's settings.`,
      "not-set-up"
    );
  }
  /** glab's environment: only the chosen token, if glab needs one handed to it. */
  async envFor() {
    const source = await this.source();
    const env = { ...scrubbed(process.env), ...this.config.endpoint };
    if (source === "plugin setting") env.GITLAB_TOKEN = this.config.settingToken;
    if (source === "GITLAB_TOKEN") env.GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    return env;
  }
  async glabVersion() {
    const result = await run(["version"], scrubbed(process.env));
    const match = /glab (?:version )?v?(\d+\.\d+\.\d+)/.exec(result.stdout);
    if (!match?.[1]) throw new GitLabError(`Couldn't read glab's version: ${result.stdout || result.stderr}`, "glab");
    return match[1];
  }
  /** Runs one GraphQL operation and returns its `data`, or throws GitLab's own error text. */
  async graphql(operationName, query, variables = {}) {
    const env = await this.envFor();
    const body = JSON.stringify({ operationName, query, variables });
    const result = await run(["api", "graphql", "--hostname", this.config.glabHost, "--input", "-"], env, body);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      const detail = (result.stderr || result.stdout).trim().replace(/^glab: /, "");
      throw new GitLabError(detail || `glab exited with code ${result.code}`, "glab");
    }
    if (parsed?.errors?.length) {
      throw new GitLabError(parsed.errors.map((e) => e.message).join("; "), "graphql");
    }
    if (result.code !== 0) {
      throw new GitLabError((result.stderr || `glab exited with code ${result.code}`).trim().replace(/^glab: /, ""), "glab");
    }
    return parsed.data;
  }
};

// src/server/versions.ts
var MINIMUM_GLAB = "1.123.0";
var MINIMUM_GITLAB = "18.1";
function atLeast(version, minimum) {
  const have = version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (const [i, need] of minimum.split(".").map(Number).entries()) {
    const part = have[i] ?? 0;
    if (part !== need) return part > need;
  }
  return true;
}
var glabSupported = (version) => atLeast(version, MINIMUM_GLAB);
var gitlabSupported = (version) => atLeast(version, MINIMUM_GITLAB);
var glabTooOld = (version) => `glab ${version} is installed; the plugin needs glab ${MINIMUM_GLAB} or later.`;
var gitlabTooOld = (version) => `This Instance runs GitLab ${version}; the plugin needs GitLab ${MINIMUM_GITLAB} or later.`;

// src/server/instance.ts
var PROBE = (
  /* GraphQL */
  `
  query InstanceProbe {
    metadata { version enterprise }
    currentUser { username }
  }
`
);
var Instance = class {
  constructor(gateway) {
    this.gateway = gateway;
  }
  gateway;
  /** Probes the Instance once per session, or again after a probe that failed. */
  probe = onceItWorks(async () => {
    const data = await this.gateway.graphql("InstanceProbe", PROBE);
    if (!data?.metadata?.version) {
      throw new GitLabError("GitLab didn't report its version; the token may be missing or invalid.", "not-set-up");
    }
    if (!data.currentUser?.username) {
      throw new GitLabError("The token isn't signed in as any user; it may be expired or revoked.", "not-set-up");
    }
    return {
      version: data.metadata.version,
      enterprise: Boolean(data.metadata.enterprise),
      username: data.currentUser.username,
      meetsMinimumVersion: gitlabSupported(data.metadata.version)
    };
  });
  requireGlab = onceItWorks(async () => {
    const version = await this.gateway.glabVersion();
    if (!glabSupported(version)) throw new GitLabError(glabTooOld(version), "not-set-up");
  });
  /** Throws unless glab and the Instance are new enough; every tool but `status` calls this first. */
  async requireSupported() {
    await this.requireGlab();
    const info = await this.probe();
    if (!info.meetsMinimumVersion) throw new GitLabError(gitlabTooOld(info.version), "not-set-up");
    return info;
  }
};

// src/server/gitlab.ts
function connect(config) {
  const gateway = new Gateway(config);
  return { config, gateway, instance: new Instance(gateway) };
}

// src/server/nodes.ts
var widgetOf = (node, type) => (node?.widgets ?? []).find((w) => w.type === type);

// src/server/references.ts
function notFound(what, config) {
  return new GitLabError(`${what} on ${config.baseUrl}: not found, or your token can't see it.`, "not-found");
}
function workItemUrl(ref, config) {
  return `${config.baseUrl}/${ref.fullPath}/-/work_items/${ref.iid}`;
}

// src/server/wayfinder.ts
var WAYFINDER_TICKET_LABELS = ["wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];
var WAYFINDER_MAP_LABEL = "wayfinder:map";
var SHOWN = 20;
var CLAIMED = (
  /* GraphQL */
  `
query ClaimedWayfinderTickets($fullPath: ID!, $assignees: [String!], $ticketLabels: [String!], $mapLabels: [String!]) {
  namespace(fullPath: $fullPath) {
    tickets: workItems(state: opened, types: [ISSUE, TASK], assigneeUsernames: $assignees, or: { labelNames: $ticketLabels }, sort: UPDATED_DESC, first: ${SHOWN}) {
      count
      nodes {
        reference(full: true) title webUrl
        widgets(onlyTypes: [DESCRIPTION, LABELS]) {
          type
          ... on WorkItemWidgetDescription { description }
          ... on WorkItemWidgetLabels { labels { nodes { title } } }
        }
      }
    }
    maps: workItems(labelName: $mapLabels, first: 100) { nodes { reference(full: true) title webUrl } }
  }
}`
);
function mapOf(description, fullPath) {
  const match = /^\s*Part of\s+((?:[\w.-]+\/)*[\w.-]+)?#(\d+)\b/m.exec(description);
  return match ? { fullPath: match[1] ?? fullPath, iid: match[2] } : void 0;
}
var Wayfinder = class {
  constructor(gitlab) {
    this.gitlab = gitlab;
  }
  gitlab;
  /** The open Wayfinder tickets the signed-in user has claimed in a project, most recently updated first. */
  async claimedTickets(fullPath) {
    const { username } = await this.gitlab.instance.requireSupported();
    const data = await this.gitlab.gateway.graphql("ClaimedWayfinderTickets", CLAIMED, {
      fullPath,
      assignees: [username],
      ticketLabels: WAYFINDER_TICKET_LABELS,
      mapLabels: [WAYFINDER_MAP_LABEL]
    });
    const namespace = data?.namespace;
    if (!namespace?.tickets) throw notFound(fullPath, this.gitlab.config);
    const maps = new Map((namespace.maps?.nodes ?? []).map((m) => [m.reference, { title: m.title, url: m.webUrl }]));
    const tickets = (namespace.tickets.nodes ?? []).map((node) => {
      const labels = (widgetOf(node, "LABELS")?.labels?.nodes ?? []).map((l) => l.title);
      const map = mapOf(widgetOf(node, "DESCRIPTION")?.description ?? "", fullPath);
      const reference = map && `${map.fullPath}#${map.iid}`;
      const known = reference ? maps.get(reference) : void 0;
      return {
        reference: node.reference,
        title: node.title,
        type: (labels.find((l) => WAYFINDER_TICKET_LABELS.includes(l)) ?? "wayfinder:task").slice("wayfinder:".length),
        url: node.webUrl,
        map: map && reference ? { reference, url: known?.url ?? workItemUrl(map, this.gitlab.config), ...known?.title ? { title: known.title } : {} } : null
      };
    });
    return { tickets, more: Math.max(0, (namespace.tickets.count ?? tickets.length) - tickets.length) };
  }
};

// src/hook/repo.ts
import { spawnSync } from "node:child_process";
function remotesOf(cwd) {
  const result = spawnSync("git", ["-C", cwd, "remote", "-v"], { encoding: "utf8" });
  const remotes = /* @__PURE__ */ new Map();
  if (result.status !== 0) return remotes;
  for (const line of result.stdout.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match) remotes.set(match[1], match[2]);
  }
  return remotes;
}
function projectOnInstance(remote, config) {
  const subPath = new URL(config.baseUrl).pathname.replace(/\/+$/, "");
  let host;
  let path;
  const scpLike = remote.includes("://") ? null : /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
  if (scpLike) {
    host = scpLike[1];
    path = `/${scpLike[2].replace(/^\/+/, "")}`;
  } else {
    let url;
    try {
      url = new URL(remote);
    } catch {
      return void 0;
    }
    host = url.hostname;
    path = decodeURIComponent(url.pathname);
    if (/^https?:$/.test(url.protocol) && subPath && !path.startsWith(`${subPath}/`)) return void 0;
  }
  if (host.toLowerCase() !== config.glabHost.toLowerCase()) return void 0;
  if (subPath && path.startsWith(`${subPath}/`)) path = path.slice(subPath.length);
  const fullPath = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return fullPath.includes("/") ? fullPath : void 0;
}
function repoProject(cwd, config) {
  const remotes = remotesOf(cwd);
  const origin = remotes.get("origin");
  const fromOrigin = origin ? projectOnInstance(origin, config) : void 0;
  if (fromOrigin) return fromOrigin;
  const projects = new Set([...remotes.values()].map((url) => projectOnInstance(url, config)).filter((p) => p !== void 0));
  return projects.size === 1 ? [...projects][0] : void 0;
}

// src/hook/session-start.ts
function entry(ticket, index) {
  const { map } = ticket;
  const onMap = map ? `; Wayfinder map: ${map.title ? `${map.title}, ` : ""}${map.reference} ${map.url}` : "";
  return `${index + 1}. ${ticket.reference} ${ticket.title} ${ticket.url} (${ticket.type}${onMap})`;
}
function report(project, claimed) {
  const entries = claimed.tickets.map(entry);
  if (claimed.more > 0) entries.push(`\u2026and ${claimed.more} more; ask Claude to list them.`);
  const shown = [
    `Your Wayfinder tickets in ${project}:`,
    ...entries,
    "Say a number to open one in full, or pick one with /gitlab-work-items:open."
  ].join("\n");
  const context = [
    `At session start, the gitlab-work-items plugin showed the user the Wayfinder tickets they've claimed in ${project} (open, labelled wayfinder:<type>, assigned to them):`,
    ...entries,
    "When the user names one of these by its number, Fetch it with fetch_work_item and show it in full."
  ].join("\n");
  return { systemMessage: shown, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } };
}
async function run2() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
  }
  const config = readHookConfig();
  const project = repoProject(typeof input.cwd === "string" ? input.cwd : process.cwd(), config);
  if (!project) return void 0;
  try {
    const claimed = await new Wayfinder(connect(config)).claimedTickets(project);
    return claimed.tickets.length ? report(project, claimed) : void 0;
  } catch (error) {
    const reason = error instanceof GitLabError ? error.message : "something unexpected went wrong.";
    return { systemMessage: `gitlab-work-items couldn't check your Wayfinder tickets in ${project}: ${reason}` };
  }
}
var output = await run2().catch(() => void 0);
if (output) process.stdout.write(JSON.stringify(output));
