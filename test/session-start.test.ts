// The session-start hook at its stdin/stdout seam, with GitLab behind the fake glab.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { repo, runSessionStart } from "./support/session-start-hook.js";

const WAYFINDER_TICKET_LABELS = ["wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];

interface TicketFixture {
  iid: number;
  title: string;
  type: string;
  description?: string;
}

/** GitLab's answer for the user's claimed Wayfinder tickets in a project, and its Wayfinder maps. */
function claimedTickets(
  tickets: TicketFixture[],
  options: { fullPath?: string; assignee?: string; maps?: { iid: number; title: string }[]; count?: number } = {},
): Interaction {
  const fullPath = options.fullPath ?? "acme/app";
  return {
    operationName: "ClaimedWayfinderTickets",
    variables: { fullPath, assignees: [options.assignee ?? "alice"], ticketLabels: WAYFINDER_TICKET_LABELS, mapLabels: ["wayfinder:map"] },
    response: {
      body: {
        data: {
          namespace: {
            tickets: {
              count: options.count ?? tickets.length,
              nodes: tickets.map((t) => ({
                reference: `${fullPath}#${t.iid}`,
                title: t.title,
                webUrl: `https://gitlab.example.com/${fullPath}/-/work_items/${t.iid}`,
                widgets: [
                  { type: "DESCRIPTION", description: t.description ?? "" },
                  { type: "LABELS", labels: { nodes: [{ title: "backend" }, { title: `wayfinder:${t.type}` }] } },
                ],
              })),
            },
            maps: {
              nodes: (options.maps ?? []).map((m) => ({
                reference: `${fullPath}#${m.iid}`,
                title: m.title,
                webUrl: `https://gitlab.example.com/${fullPath}/-/work_items/${m.iid}`,
              })),
            },
          },
        },
      },
    },
  };
}

describe("the session-start hook", () => {
  it("shows the user, and tells Claude, the Wayfinder tickets they've claimed in the repo's project", () => {
    const cwd = repo({ origin: "https://gitlab.example.com/acme/app.git" });
    const run = runSessionStart({
      cwd,
      cassette: cassette({
        auth: loggedIn(),
        interactions: [
          instanceProbe(),
          claimedTickets(
            [
              { iid: 7, title: "Pick a cache", type: "grilling", description: "Part of #3\n\n## Question\n\nWhich cache?" },
              { iid: 9, title: "Spike the API", type: "research", description: "Part of #3" },
            ],
            { maps: [{ iid: 3, title: "Plugin v1" }] },
          ),
        ],
      }),
    });

    expect(run.code).toBe(0);
    expect(run.shown).toBe(
      [
        "Your Wayfinder tickets in acme/app:",
        "1. acme/app#7 Pick a cache https://gitlab.example.com/acme/app/-/work_items/7 (grilling; Wayfinder map: Plugin v1, acme/app#3 https://gitlab.example.com/acme/app/-/work_items/3)",
        "2. acme/app#9 Spike the API https://gitlab.example.com/acme/app/-/work_items/9 (research; Wayfinder map: Plugin v1, acme/app#3 https://gitlab.example.com/acme/app/-/work_items/3)",
        "Say a number to open one in full, or pick one with /gitlab-work-items:open.",
      ].join("\n"),
    );
    expect(run.context).toContain("1. acme/app#7 Pick a cache");
    expect(run.context).toMatch(/fetch_work_item/);
  });

  it("names a map in another project by its Reference, leaves out a missing map, and counts tickets beyond 20", () => {
    const cwd = repo({ origin: "git@gitlab.example.com:acme/app.git" });
    const run = runSessionStart({
      cwd,
      cassette: cassette({
        auth: loggedIn(),
        interactions: [
          instanceProbe(),
          claimedTickets(
            [
              { iid: 7, title: "Pick a cache", type: "prototype", description: "Part of acme/plans#3" },
              { iid: 9, title: "Provision a sandbox", type: "task", description: "No map named here" },
            ],
            { count: 23 },
          ),
        ],
      }),
    });

    expect(run.shown!.split("\n").slice(1, 4)).toEqual([
      "1. acme/app#7 Pick a cache https://gitlab.example.com/acme/app/-/work_items/7 (prototype; Wayfinder map: acme/plans#3 https://gitlab.example.com/acme/plans/-/work_items/3)",
      "2. acme/app#9 Provision a sandbox https://gitlab.example.com/acme/app/-/work_items/9 (task)",
      "…and 21 more; ask Claude to list them.",
    ]);
  });

  it.each([
    ["isn't a git repo", undefined],
    ["has no remote on the Instance", { origin: "https://github.com/acme/app.git" }],
    ["has remotes on the Instance for two projects", { origin: "https://github.com/acme/app.git", a: "https://gitlab.example.com/acme/a.git", b: "https://gitlab.example.com/acme/b.git" }],
  ])("shows nothing, and asks GitLab nothing, when the repo %s", (_, remotes) => {
    const cwd = remotes ? repo(remotes) : mkdtempSync(join(tmpdir(), "gwi-plain-"));
    const run = runSessionStart({ cwd, cassette: cassette({ auth: loggedIn() }) });

    expect(run.code).toBe(0);
    expect(run.shown).toBeUndefined();
    expect(run.context).toBeUndefined();
    expect(run.glabCalls).toEqual([]);
  });

  it("shows nothing when the user has claimed no Wayfinder tickets there", () => {
    const cwd = repo({ origin: "https://gitlab.example.com/acme/app.git" });
    const run = runSessionStart({ cwd, cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe(), claimedTickets([])] }) });

    expect(run.code).toBe(0);
    expect(run.shown).toBeUndefined();
    expect(run.glabCalls.some((c) => c.body?.operationName === "ClaimedWayfinderTickets")).toBe(true);
  });

  it.each([
    ["an SSH origin", { origin: "ssh://git@gitlab.example.com:2222/acme/app.git" }, "https://gitlab.example.com"],
    ["the only remote on the Instance when origin is elsewhere", { origin: "https://github.com/me/app.git", upstream: "https://gitlab.example.com/acme/app" }, "https://gitlab.example.com"],
    ["an HTTPS origin on an Instance under a sub-path", { origin: "https://gitlab.example.com/gitlab/acme/app.git" }, "https://gitlab.example.com/gitlab"],
    ["an SSH origin on an Instance under a sub-path", { origin: "git@gitlab.example.com:acme/app.git" }, "https://gitlab.example.com/gitlab"],
  ])("finds the project from %s", (_, remotes, instanceUrl) => {
    const cwd = repo(remotes);
    const run = runSessionStart({
      cwd,
      instanceUrl,
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe(), claimedTickets([{ iid: 7, title: "Pick a cache", type: "grilling" }])] }),
    });

    expect(run.shown).toMatch(/^Your Wayfinder tickets in acme\/app:\n1\. acme\/app#7 Pick a cache \S+\/acme\/app\/-\/work_items\/7 \(grilling\)$/m);
  });

  it("uses the plugin's own settings: the Instance and the token", () => {
    const cwd = repo({ origin: "https://gitlab.example.com:8443/acme/app.git" });
    const run = runSessionStart({
      cwd,
      instanceUrl: "https://gitlab.example.com:8443",
      token: "glpat-from-settings",
      cassette: cassette({ interactions: [instanceProbe(), claimedTickets([{ iid: 7, title: "Pick a cache", type: "grilling" }])] }),
    });

    const query = run.glabCalls.find((c) => c.body?.operationName === "ClaimedWayfinderTickets")!;
    expect(query.env).toMatchObject({ GITLAB_TOKEN: "glpat-from-settings" });
    expect(query.endpoint).toMatchObject({ GITLAB_API_HOST: "gitlab.example.com:8443" });
    expect(run.shown).toMatch(/acme\/app#7/);
  });

  it("says in one line why it couldn't check, and lets the session start", () => {
    const cwd = repo({ origin: "https://gitlab.example.com/acme/app.git" });
    const run = runSessionStart({ cwd, cassette: cassette({ auth: { "gitlab.example.com": { loggedIn: false } } }) });

    expect(run.code).toBe(0);
    expect(run.shown).toMatch(/^gitlab-work-items couldn't check your Wayfinder tickets in acme\/app: .+/);
    expect(run.shown).not.toContain("\n");
    expect(run.context).toBeUndefined();
  });
});
