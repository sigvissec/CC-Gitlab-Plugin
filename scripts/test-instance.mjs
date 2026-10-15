#!/usr/bin/env node
// Boots a throwaway GitLab Test Instance in a container, seeds it, records the end-to-end
// scenarios against it with the real glab, and removes it.
//
//   node scripts/test-instance.mjs <label>
//
// Labels and their images are listed in INSTANCES below. Override the image with
// GITLAB_IMAGE (for example a mirror), and the glab binary with REAL_GLAB (default: glab).
// Recordings land in test/recordings/instances/<label>/ and are replayed by `npm test`.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const INSTANCES = {
  "ee-18.1": { image: "gitlab/gitlab-ee:18.1.6-ee.0", edition: "EE" },
  "ee-newest": { image: "gitlab/gitlab-ee:19.4.2-ee.0", edition: "EE" },
  "ce-newest": { image: "gitlab/gitlab-ce:19.4.2-ce.0", edition: "CE" },
};

const label = process.argv[2];
const instance = INSTANCES[label];
if (!instance) {
  console.error(`Usage: node scripts/test-instance.mjs <${Object.keys(INSTANCES).join("|")}>`);
  process.exit(64);
}

const ROOT = resolve(import.meta.dirname, "..");
const IMAGE = process.env.GITLAB_IMAGE || instance.image;
const PORT = Number(process.env.GITLAB_PORT || 8929);
// glab names an Instance by its bare hostname; the port and protocol travel separately.
const HOST = "localhost";
const API_HOST = `localhost:${PORT}`;
const URL_BASE = `http://${API_HOST}`;
const CONTAINER = `gwi-test-instance-${label}`;
const REAL_GLAB = resolveGlab(process.env.REAL_GLAB || "glab");
const RECORDINGS_DIR = join(ROOT, "test/recordings/instances", label);
const GLAB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "gwi-glab-"));
const READY_MINUTES = Number(process.env.GITLAB_READY_MINUTES || 25);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

/** glab runs with its own throwaway config and none of the caller's token variables. */
const glabEnv = { ...process.env, GLAB_CONFIG_DIR, GITLAB_API_HOST: API_HOST, GLAB_API_PROTOCOL: "http", GITLAB_SUBFOLDER: "" };
for (const name of ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"]) delete glabEnv[name];

/** The recorder runs with a minimal PATH, so it needs glab's absolute path. */
function resolveGlab(glab) {
  if (glab.includes("/")) return resolve(glab);
  const found = spawnSync("sh", ["-c", `command -v ${glab}`], { encoding: "utf8" }).stdout.trim();
  if (!found) {
    console.error("glab isn't on PATH; install it or set REAL_GLAB.");
    process.exit(69);
  }
  return found;
}

/** Calls GitLab's REST API as root through glab, returning the parsed response. */
function rest(method, path, fields = {}) {
  const args = ["api", "--hostname", HOST, "--method", method, path];
  for (const [key, value] of Object.entries(fields)) args.push("-F", `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  const result = run(REAL_GLAB, args, { env: glabEnv });
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

function graphql(query, variables) {
  const result = run(REAL_GLAB, ["api", "graphql", "--hostname", HOST, "--input", "-"], {
    env: glabEnv,
    input: JSON.stringify({ query, variables }),
  });
  const parsed = JSON.parse(result.stdout);
  if (parsed.errors) throw new Error(JSON.stringify(parsed.errors));
  return parsed.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntilReady() {
  const deadline = Date.now() + READY_MINUTES * 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${URL_BASE}/-/readiness?all=1`);
      if (response.ok) {
        const signIn = await fetch(`${URL_BASE}/users/sign_in`);
        if (signIn.ok) return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(10_000);
  }
  throw new Error(`GitLab wasn't ready after ${READY_MINUTES} minutes`);
}

function startContainer() {
  run("docker", ["rm", "-f", CONTAINER], { allowFailure: true });
  const omnibus = [
    `external_url '${URL_BASE}'`,
    "gitlab_rails['initial_root_password'] = 'Suite-Passw0rd-not-secret'",
    "gitlab_rails['monitoring_whitelist'] = ['0.0.0.0/0']",
    "gitlab_rails['usage_ping_enabled'] = false",
    "puma['worker_processes'] = 0",
    "sidekiq['concurrency'] = 5",
    "prometheus_monitoring['enable'] = false",
    "gitlab_kas['enable'] = false",
  ].join("; ");
  run("docker", ["run", "-d", "--name", CONTAINER, "--shm-size", "256m", "-p", `${PORT}:${PORT}`, "-e", `GITLAB_OMNIBUS_CONFIG=${omnibus}`, IMAGE]);
}

function rootToken() {
  const script =
    "t = User.find_by_username('root').personal_access_tokens.create!(scopes: ['api'], name: 'suite', expires_at: 2.days.from_now); puts t.token";
  const result = run("docker", ["exec", CONTAINER, "gitlab-rails", "runner", script]);
  const token = result.stdout.trim().split("\n").pop();
  if (!token?.startsWith("glpat-")) throw new Error(`Couldn't create a token: ${result.stdout}`);
  return token;
}

/** Waits for Sidekiq to link the Issue to every merge request that closes or mentions it. */
async function waitForRelatedMergeRequests(projectId, issueIid, mergeRequestIids) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const related = rest("GET", `projects/${projectId}/issues/${issueIid}/related_merge_requests`) ?? [];
    if (mergeRequestIids.every((iid) => related.some((mr) => mr.iid === iid))) return;
    await sleep(2_000);
  }
  throw new Error(`GitLab never related merge requests ${mergeRequestIids.join(", ")} to Issue ${issueIid}.`);
}

async function seed() {
  const users = ["alice", "bob"].map((username) =>
    rest("POST", "users", { username, name: username, email: `${username}@example.test`, password: "Suite-Passw0rd-not-secret", skip_confirmation: true }),
  );
  const group = rest("POST", "groups", { name: "acme", path: "acme", visibility: "private" });
  const project = rest("POST", "projects", { name: "app", path: "app", namespace_id: group.id, initialize_with_readme: true });
  for (const user of users) rest("POST", `projects/${project.id}/members`, { user_id: user.id, access_level: 30 });
  for (const name of ["bug", "blocked", "auth"]) rest("POST", `projects/${project.id}/labels`, { name, color: "#cc3333" });
  const milestone = rest("POST", `projects/${project.id}/milestones`, { title: "18.2" });

  const issue = rest("POST", `projects/${project.id}/issues`, {
    title: "Login times out after 30 seconds",
    description: "Steps:\n1. Log in\n2. Wait",
    labels: "bug",
  });
  const types = graphql("query($p: ID!) { namespace(fullPath: $p) { workItemTypes { nodes { id name } } } }", { p: "acme/app" });
  const taskType = types.namespace.workItemTypes.nodes.find((t) => t.name === "Task").id;
  const issueGid = graphql("query($p: ID!, $i: String!) { namespace(fullPath: $p) { workItem(iid: $i) { id } } }", { p: "acme/app", i: String(issue.iid) })
    .namespace.workItem.id;
  const task = graphql(
    "mutation($input: WorkItemCreateInput!) { workItemCreate(input: $input) { workItem { iid } errors } }",
    { input: { namespacePath: "acme/app", workItemTypeId: taskType, title: "Write a repro test", hierarchyWidget: { parentId: issueGid } } },
  ).workItemCreate.workItem;
  // Assigned to the signed-in user, so "my Work Items" has something to list.
  const me = rest("GET", "user");
  const related = rest("POST", `projects/${project.id}/issues`, { title: "Session cookie expires early", assignee_id: me.id });
  const plain = rest("POST", `projects/${project.id}/issues`, { title: "An Issue for Edits" });
  rest("POST", `projects/${project.id}/issues/${issue.iid}/links`, { target_project_id: project.id, target_issue_iid: related.iid });
  const thread = rest("POST", `projects/${project.id}/issues/${issue.iid}/discussions`, { body: "Which browser?" });

  const mergeRequest = (branch, title, description) => {
    rest("POST", `projects/${project.id}/repository/commits`, {
      branch,
      start_branch: "main",
      commit_message: title,
      actions: [{ action: "create", file_path: `${branch}.txt`, content: title }],
    });
    return rest("POST", `projects/${project.id}/merge_requests`, { source_branch: branch, target_branch: "main", title, description });
  };
  const mr = mergeRequest("fix-timeout", "Fix the login timeout", `Closes #${issue.iid}`);
  const mention = mergeRequest("log-timeouts", "Log session timeouts", `Related to #${issue.iid}`);
  await waitForRelatedMergeRequests(project.id, issue.iid, [mr.iid, mention.iid]);

  const version = rest("GET", "version");
  return {
    label,
    url: URL_BASE,
    version: version.version,
    edition: instance.edition,
    project: "acme/app",
    group: "acme",
    issue: `acme/app#${issue.iid}`,
    task: `acme/app#${task.iid}`,
    related: `acme/app#${related.iid}`,
    plain: `acme/app#${plain.iid}`,
    mergeRequest: `acme/app!${mr.iid}`,
    mentioningMergeRequest: `acme/app!${mention.iid}`,
    milestone: milestone.title,
    threadNoteUrl: `${URL_BASE}/acme/app/-/work_items/${issue.iid}#note_${thread.notes[0].id}`,
    users: users.map((u) => u.username),
  };
}

async function main() {
  console.log(`Starting ${IMAGE} as ${CONTAINER} on ${URL_BASE}…`);
  startContainer();
  try {
    await waitUntilReady();
    console.log("GitLab is ready. Signing glab in and seeding…");
    run(REAL_GLAB, ["auth", "login", "--hostname", HOST, "--api-host", API_HOST, "--token", rootToken(), "--api-protocol", "http", "--git-protocol", "http"], {
      env: glabEnv,
    });
    const manifest = await seed();
    rmSync(RECORDINGS_DIR, { recursive: true, force: true });
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    writeFileSync(join(RECORDINGS_DIR, "seed.json"), `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`Seeded ${manifest.version}. Recording scenarios…`);
    run("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    const result = spawnSync("npx", ["vitest", "run", "test/instance"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...glabEnv, SCENARIO_MODE: "record", RECORDINGS_DIR, REAL_GLAB, GLAB_CONFIG_DIR },
    });
    process.exitCode = result.status ?? 1;
  } finally {
    if (!process.env.KEEP_TEST_INSTANCE) run("docker", ["rm", "-f", CONTAINER], { allowFailure: true });
    rmSync(GLAB_CONFIG_DIR, { recursive: true, force: true });
  }
}

await main();
