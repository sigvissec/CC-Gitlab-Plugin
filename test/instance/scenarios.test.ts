// End-to-end scenarios against a real GitLab Test Instance.
//
// Record mode (scripts/test-instance.mjs sets SCENARIO_MODE=record): the server talks to a
// seeded Test Instance through the real glab, and every response is recorded under
// test/recordings/instances/<label>/. Replay mode (the default): the same scenarios run
// against each recorded Instance through the fake glab, with no GitLab needed.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { start, type Session } from "../support/harness.js";

const RECORDINGS = resolve(import.meta.dirname, "../recordings/instances");
const recording = process.env.SCENARIO_MODE === "record";

interface Seed {
  label: string;
  url: string;
  version: string;
  edition: "EE" | "CE";
  project: string;
  group: string;
  issue: string;
  task: string;
  related: string;
  plain: string;
  mergeRequest: string;
  threadNoteUrl: string;
  users: string[];
}

interface Target {
  dir: string;
  seed: Seed;
}

function targets(): Target[] {
  if (recording) {
    const dir = process.env.RECORDINGS_DIR!;
    return [{ dir, seed: JSON.parse(readFileSync(join(dir, "seed.json"), "utf8")) }];
  }
  if (!existsSync(RECORDINGS)) return [];
  return readdirSync(RECORDINGS)
    .map((label) => join(RECORDINGS, label))
    .filter((dir) => existsSync(join(dir, "seed.json")))
    .map((dir) => ({ dir, seed: JSON.parse(readFileSync(join(dir, "seed.json"), "utf8")) }));
}

/** Starts a session that records (live) or replays (from the recording) one scenario. */
async function session(target: Target, name: string, options: { elicit?: boolean } = {}): Promise<Session> {
  const cassettePath = join(target.dir, `${name}.json`);
  const elicit = options.elicit ? () => ({ action: "accept" as const, content: { confirm: true } }) : undefined;
  if (recording) {
    mkdirSync(target.dir, { recursive: true });
    rmSync(cassettePath, { force: true });
    return start({
      baseUrl: target.seed.url,
      cassette: { interactions: [] },
      record: { cassettePath, realGlab: process.env.REAL_GLAB!, glabConfigDir: process.env.GLAB_CONFIG_DIR! },
      elicit,
    });
  }
  return start({ baseUrl: target.seed.url, cassette: JSON.parse(readFileSync(cassettePath, "utf8")), elicit });
}

/** Changes GitLab behind the server's back. Only happens live; replays see its recorded effect. */
function changeBehindTheServersBack(target: Target, iid: string, title: string) {
  if (!recording) return;
  const project = encodeURIComponent(target.seed.project);
  const result = spawnSync(
    process.env.REAL_GLAB!,
    ["api", "--hostname", new URL(target.seed.url).hostname, "--method", "PUT", `projects/${project}/issues/${iid}`, "-f", `title=${title}`],
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) throw new Error(`Couldn't change the Issue: ${result.stderr}`);
}

const iidOf = (reference: string) => reference.split("#")[1]!;
const all = targets();

it.skipIf(all.length > 0)("has Test Instance recordings to replay (run scripts/test-instance.mjs to make them)", () => {});

describe.runIf(all.length > 0).each(all)("on $seed.label (GitLab $seed.version $seed.edition)", (target) => {
  const { seed } = target;

  it("status reports the Instance and passes its read-only probes", async () => {
    const s = await session(target, "status");
    const result = await s.call("status", { project: seed.project });
    await s.close();
    expect(result.data).toMatchObject({ edition: seed.edition, meetsMinimumVersion: true, tokenSource: "glab login" });
    expect(result.data.probes.every((p: { ok: boolean }) => p.ok)).toBe(true);
  });

  it("fetches a seeded Issue with its Task, Linked Item, Thread, and closing merge request", async () => {
    const s = await session(target, "fetch");
    const result = await s.call("fetch_work_item", { reference: seed.issue });
    await s.close();
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ reference: seed.issue, type: "Issue", labels: expect.arrayContaining(["bug"]) });
    expect(result.data.children).toEqual([expect.objectContaining({ reference: seed.task, type: "Task" })]);
    expect(result.data.linkedItems).toEqual([expect.objectContaining({ reference: seed.related })]);
    expect(result.data.threads).toMatchObject({ total: 1, unresolved: 1 });
    expect(result.data.mergeRequests.shown).toEqual([expect.objectContaining({ reference: seed.mergeRequest, relation: "closes", state: "open" })]);
  });

  it("lists the group's Work Items with filters, including text, label, and parent", async () => {
    const s = await session(target, "lists");
    const byLabel = await s.call("list_work_items", { scope: seed.group, labels: ["bug"] });
    const byText = await s.call("list_work_items", { scope: seed.group, search: "timeout" });
    const children = await s.call("list_work_items", { scope: seed.project, parent: seed.issue });
    await s.close();
    expect(byLabel.data.items.map((i: { reference: string }) => i.reference)).toContain(seed.issue);
    expect(byText.data.items.map((i: { reference: string }) => i.reference)).toContain(seed.issue);
    expect(children.data.items.map((i: { reference: string }) => i.reference)).toEqual([seed.task]);
  });

  it("edits fields, and reports a second assignee GitLab drops on Free", async () => {
    const s = await session(target, "edit");
    await s.call("fetch_work_item", { reference: seed.plain });
    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "edit", reference: seed.plain, title: "Renamed by the suite", addLabels: ["blocked"], assignees: seed.users, dueDate: "2027-01-31", state: "close" }],
    });
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    const reopened = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: seed.plain, state: "reopen" }] });
    const reopenApplied = await s.call("apply_writes", { planId: reopened.data.planId });
    await s.close();
    expect(prepared.isError).toBe(false);
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
    expect(applied.data.results[0].didNotStick).toEqual([expect.stringMatching(/^assignees: asked for/)]);
    expect(reopenApplied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("comments, replies in the seeded Thread, and resolves it, confirming through the dialog", async () => {
    const s = await session(target, "comments", { elicit: true });
    const commented = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: seed.issue, body: "A Comment from the suite" }] });
    const commentApplied = await s.call("apply_writes", { planId: commented.data.planId });
    await s.call("fetch_work_item", { reference: seed.threadNoteUrl });
    const replied = await s.call("prepare_writes", { writes: [{ kind: "reply", reference: seed.threadNoteUrl, body: "A reply from the suite" }] });
    const replyApplied = await s.call("apply_writes", { planId: replied.data.planId });
    await s.call("fetch_work_item", { reference: seed.threadNoteUrl });
    const resolved = await s.call("prepare_writes", { writes: [{ kind: "resolve", reference: seed.threadNoteUrl }] });
    const resolveApplied = await s.call("apply_writes", { planId: resolved.data.planId });
    await s.close();
    expect(commentApplied.data.results[0]).toMatchObject({ outcome: "done" });
    expect(replyApplied.data.results[0]).toMatchObject({ outcome: "done" });
    expect(resolveApplied.data.results[0]).toMatchObject({ outcome: "done" });
    expect(s.elicitations).toHaveLength(3);
  });

  it("creates an Issue and a Task under it", async () => {
    const s = await session(target, "create");
    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "create", type: "Issue", project: seed.project, title: "Created by the suite", labels: ["bug"] }],
    });
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    const issue = applied.data.results[0].created as string;
    const task = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Task", parent: issue, title: "A Task from the suite" }] });
    const taskApplied = await s.call("apply_writes", { planId: task.data.planId });
    await s.close();
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
    expect(issue).toMatch(new RegExp(`^${seed.project}#\\d+$`));
    expect(taskApplied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("links and unlinks Work Items", async () => {
    const s = await session(target, "links");
    const linked = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: seed.plain, addLinks: [{ reference: seed.related, linkType: "relates_to" }] }] });
    const linkApplied = await s.call("apply_writes", { planId: linked.data.planId });
    const unlinked = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: seed.plain, removeLinks: [seed.related] }] });
    const unlinkApplied = await s.call("apply_writes", { planId: unlinked.data.planId });
    await s.close();
    expect(linkApplied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
    expect(unlinkApplied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("holds back an Edit when the Work Item changed after the preview", async () => {
    const s = await session(target, "stale");
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: seed.plain, addLabels: ["auth"] }] });
    changeBehindTheServersBack(target, iidOf(seed.plain), "Changed behind the server's back");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    await s.close();
    expect(applied.data.results[0]).toMatchObject({ outcome: "not applied", detail: expect.stringMatching(/changed in GitLab/) });
  });

  it("refuses weight on Free and CE, and Epic References", async () => {
    const s = await session(target, "refusals");
    const weight = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: seed.plain, weight: 3 }] });
    const epic = await s.call("fetch_work_item", { reference: `${seed.group}&1` });
    await s.close();
    expect(weight.isError).toBe(true);
    expect(weight.text).toMatch(/weight isn't available/);
    expect(epic.text).toMatch(/Epics aren't supported/);
  });
});
