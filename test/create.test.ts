import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { fetchWorkItem, lookupLabel, lookupTypes, lookupUsers, mutation, projectPermissions } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withGitLab(interactions: Interaction[]) {
  session = await start({ cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe(), ...interactions] }) });
  return session;
}

const FOOTER = "\n\n_Posted with Claude Code_";

describe("creating a Work Item", () => {
  it("creates an Issue in a project, previewing every field, and checks it came out as asked", async () => {
    const input = {
      namespacePath: "acme/app",
      workItemTypeId: "gid://gitlab/WorkItems::Type/1",
      title: "Session cookie expires early",
      descriptionWidget: { description: `It expires after 5 minutes.${FOOTER}` },
      labelsWidget: { labelIds: ["gid://gitlab/ProjectLabel/3"] },
      assigneesWidget: { assigneeIds: ["gid://gitlab/User/1"] },
      confidential: false,
    };
    const s = await withGitLab([
      projectPermissions("acme/app"),
      lookupTypes("acme/app"),
      lookupLabel("acme/app", "bug", 3),
      lookupUsers(["alice"], { alice: 1 }),
      mutation("CreateWorkItem", input, { workItem: { id: "gid://gitlab/WorkItem/1040", reference: "acme/app#40", webUrl: "https://gitlab.example.com/acme/app/-/work_items/40" } }),
      fetchWorkItem({ iid: "40", id: 1040, title: "Session cookie expires early", description: `It expires after 5 minutes.${FOOTER}`, labels: ["bug"], assignees: ["alice"] }),
    ]);

    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "create", type: "Issue", project: "acme/app", title: "Session cookie expires early", description: "It expires after 5 minutes.", labels: ["bug"], assignees: ["alice"] }],
    });

    expect(prepared.text).toContain("Create an Issue in acme/app");
    expect(prepared.text).toContain("title: Session cookie expires early");
    expect(prepared.text).toContain("labels: bug");
    expect(prepared.text).toContain("assignees: alice");
    expect(prepared.text).toContain("confidential: no");
    expect(prepared.text).toContain("_Posted with Claude Code_");

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [], created: "acme/app#40" });
    expect(applied.text).toContain("acme/app#40");
  });

  it("creates a Task under an Issue, in the Issue's project", async () => {
    const parent = fetchWorkItem({ iid: "12" });
    const input = {
      namespacePath: "acme/app",
      workItemTypeId: "gid://gitlab/WorkItems::Type/5",
      title: "Write repro test",
      descriptionWidget: { description: `${FOOTER.trimStart()}` },
      hierarchyWidget: { parentId: "gid://gitlab/WorkItem/1012" },
      confidential: false,
    };
    const s = await withGitLab([
      parent,
      lookupTypes("acme/app"),
      mutation("CreateWorkItem", input, { workItem: { id: "gid://gitlab/WorkItem/1041", reference: "acme/app#41", webUrl: "https://gitlab.example.com/acme/app/-/work_items/41" } }),
      fetchWorkItem({ iid: "41", id: 1041, type: "Task", title: "Write repro test", description: FOOTER.trimStart(), parent: { reference: "acme/app#12", title: "Login" } }),
    ]);

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Task", parent: "acme/app#12", title: "Write repro test" }] });

    expect(prepared.text).toContain("Create a Task under acme/app#12");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [], created: "acme/app#41" });
  });

  it("refuses a Task without a parent Issue, and an Issue without a project", async () => {
    const s = await withGitLab([]);
    const task = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Task", title: "x" }] });
    const issue = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Issue", title: "x" }] });
    expect(task.isError).toBe(true);
    expect(task.text).toMatch(/Task needs a parent Issue/);
    expect(issue.isError).toBe(true);
    expect(issue.text).toMatch(/Issue needs a project/);
  });

  it("refuses when the token can't create Work Items in the project", async () => {
    const s = await withGitLab([projectPermissions("acme/app", false)]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Issue", project: "acme/app", title: "x" }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/can't create Work Items in acme\/app/);
  });

  it("can create a confidential Issue when asked", async () => {
    const s = await withGitLab([
      projectPermissions("acme/app"),
      lookupTypes("acme/app"),
      mutation(
        "CreateWorkItem",
        { namespacePath: "acme/app", workItemTypeId: "gid://gitlab/WorkItems::Type/1", title: "Secret", descriptionWidget: { description: FOOTER.trimStart() }, confidential: true },
        { workItem: { id: "gid://gitlab/WorkItem/1042", reference: "acme/app#42", webUrl: "u" } },
      ),
      fetchWorkItem({ iid: "42", id: 1042, title: "Secret", description: FOOTER.trimStart(), confidential: true }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Issue", project: "acme/app", title: "Secret", confidential: true }] });
    expect(prepared.text).toContain("confidential: yes");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("refuses weight up front where the namespace's tier doesn't offer it", async () => {
    const s = await withGitLab([projectPermissions("acme/app"), lookupTypes("acme/app", { weight: false })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "create", type: "Issue", project: "acme/app", title: "x", weight: 2 }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/weight isn't available/);
  });
});
