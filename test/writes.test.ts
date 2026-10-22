import { afterEach, describe, expect, it } from "vitest";
import { start, type Session, type StartOptions } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { fetchWorkItem, lookupLabel, lookupMilestone, lookupUsers, mutation, resolveWorkItem } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withGitLab(interactions: Interaction[], options: Partial<StartOptions> = {}) {
  session = await start({
    ...options,
    cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe(), ...interactions] }),
  });
  return session;
}

const ID = "gid://gitlab/WorkItem/1012";

describe("an Edit", () => {
  it("previews labels as before → after, then applies them and confirms they stuck", async () => {
    const before = fetchWorkItem({ labels: ["bug"] });
    const s = await withGitLab([
      before, // prepare
      lookupLabel("acme/app", "blocked", 7),
      before, // staleness check right before sending
      mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/7"], removeLabelIds: [] } }, { workItem: { id: ID } }),
      fetchWorkItem({ labels: ["bug", "blocked"], updatedAt: "2026-10-02T08:00:00Z" }), // re-read
    ]);

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

    expect(prepared.isError).toBe(false);
    expect(prepared.text).toContain("acme/app#12");
    expect(prepared.text).toMatch(/labels: bug → bug, blocked/);
    expect(s.glabCalls().some((c) => c.body?.operationName === "UpdateWorkItem")).toBe(false);

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.isError).toBe(false);
    expect(applied.data.results).toEqual([expect.objectContaining({ number: 1, outcome: "done", didNotStick: [] })]);
  });

  it("isn't sent if the Work Item changed after the preview, and nothing after it runs", async () => {
    const before = fetchWorkItem({ labels: ["bug"] });
    const s = await withGitLab([
      before,
      lookupLabel("acme/app", "blocked", 7),
      fetchWorkItem({ labels: ["bug", "p1"], updatedAt: "2026-10-03T00:00:00Z" }), // a colleague edited it
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] },
        { kind: "edit", reference: "acme/app#12", removeLabels: ["bug"] },
      ],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results).toEqual([
      expect.objectContaining({ number: 1, outcome: "not applied", detail: expect.stringMatching(/changed in GitLab since it was fetched/) }),
      expect.objectContaining({ number: 2, outcome: "not applied" }),
    ]);
    expect(applied.data.results[0].detail).toMatch(/labels: bug, p1/);
    expect(s.glabCalls().some((c) => c.body?.operationName === "UpdateWorkItem")).toBe(false);
  });

  it("is refused at preview time if the Work Item changed since Claude fetched it", async () => {
    const s = await withGitLab([
      fetchWorkItem({ labels: ["bug"] }), // Claude's fetch
      fetchWorkItem({ labels: ["bug", "p1"], updatedAt: "2026-10-03T00:00:00Z" }), // prepare sees a newer version
    ]);
    await s.call("fetch_work_item", { reference: "acme/app#12" });

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/changed in GitLab since you fetched it/);
    expect(prepared.text).toContain("p1");
  });

  it("applies several Writes to the same Work Item in order, each checked against the version before it", async () => {
    const v1 = fetchWorkItem({ labels: ["bug"] });
    const v2 = fetchWorkItem({ labels: ["bug", "blocked"], updatedAt: "2026-10-02T08:00:00Z" });
    const v3 = fetchWorkItem({ labels: ["blocked"], updatedAt: "2026-10-02T08:01:00Z" });
    const s = await withGitLab([
      v1, lookupLabel("acme/app", "blocked", 7), v1, // prepare both
      v1, mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/7"], removeLabelIds: [] } }, { workItem: { id: ID } }), v2,
      v2, mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: [], removeLabelIds: ["gid://gitlab/ProjectLabel/1"] } }, { workItem: { id: ID } }), v3,
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] },
        { kind: "edit", reference: "acme/app#12", removeLabels: ["bug"] },
      ],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results.map((r: { outcome: string }) => r.outcome)).toEqual(["done", "done"]);
  });

  it("asks the user directly when the client supports it, and applies only on their yes", async () => {
    const v1 = fetchWorkItem({ labels: ["bug"] });
    const s = await withGitLab(
      [
        v1, lookupLabel("acme/app", "blocked", 7),
        v1, mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/7"], removeLabelIds: [] } }, { workItem: { id: ID } }),
        fetchWorkItem({ labels: ["bug", "blocked"], updatedAt: "2026-10-02T08:00:00Z" }),
      ],
      { elicit: () => ({ action: "accept", content: { confirm: true } }) },
    );
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(s.elicitations).toHaveLength(1);
    expect(s.elicitations[0]!.message).toMatch(/labels: bug → bug, blocked/);
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  // Claude Code's terminal shows a dialog's first three lines, so they name the Writes.
  it("opens the dialog on the Write itself, and says beside the tick box that it sends one", async () => {
    const s = await withGitLab([fetchWorkItem({ labels: ["bug"] }), lookupLabel("acme/app", "blocked", 7)], { elicit: () => ({ action: "decline" }) });
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

    await s.call("apply_writes", { planId: prepared.data.planId });

    const [dialog] = s.elicitations;
    expect(dialog!.message.split("\n").slice(0, 2)).toEqual([expect.stringMatching(/^1\. Edit acme\/app#12\b/), "  labels: bug → bug, blocked"]);
    expect(dialog!.requestedSchema.properties.confirm.description).toBe("Tick to send this Write to GitLab.");
  });

  it("opens the dialog on a list of the Writes, and says beside the tick box how many it sends", async () => {
    const s = await withGitLab(
      [fetchWorkItem({ iid: "12", labels: [] }), lookupLabel("acme/app", "p1", 9), fetchWorkItem({ iid: "13", id: 1013, labels: [] }), lookupLabel("acme/app", "p1", 9)],
      { elicit: () => ({ action: "decline" }) },
    );
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["p1"] },
        { kind: "edit", reference: "acme/app#13", addLabels: ["p1"] },
      ],
    });

    await s.call("apply_writes", { planId: prepared.data.planId });

    const [dialog] = s.elicitations;
    expect(dialog!.message.split("\n").slice(0, 3)).toEqual([
      expect.stringMatching(/^1\. Edit acme\/app#12\b/),
      expect.stringMatching(/^2\. Edit acme\/app#13\b/),
      "",
    ]);
    expect(dialog!.message).toMatch(/^2\. Edit acme\/app#13\b.*\n  labels: none → p1/m);
    expect(dialog!.requestedSchema.properties.confirm.description).toBe("Tick to send these 2 Writes to GitLab.");
  });

  it.each([
    ["declines", { action: "decline" as const }],
    ["cancels", { action: "cancel" as const }],
    ["accepts without ticking confirm", { action: "accept" as const, content: { confirm: false } }],
  ])("sends nothing when the user %s", async (_, response) => {
    const v1 = fetchWorkItem({ labels: ["bug"] });
    const s = await withGitLab([v1, lookupLabel("acme/app", "blocked", 7)], { elicit: () => response });
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "not applied" });
    expect(applied.text).toMatch(/didn't confirm/);
    expect(s.glabCalls().some((c) => c.body?.operationName === "UpdateWorkItem")).toBe(false);
  });

  it("previews and applies title, description (as a diff), assignees, milestone, state, and due date", async () => {
    const v1 = fetchWorkItem({ title: "Login slow", description: "Steps:\n1. Log in\n2. Wait", assignees: ["alice"], milestone: null, dueDate: null });
    const input = {
      id: ID,
      title: "Login times out",
      descriptionWidget: { description: "Steps:\n1. Log in\n2. Wait 30 seconds" },
      assigneesWidget: { assigneeIds: ["gid://gitlab/User/2"] },
      milestoneWidget: { milestoneId: "gid://gitlab/Milestone/4" },
      stateEvent: "CLOSE",
      startAndDueDateWidget: { dueDate: "2026-11-01" },
    };
    const s = await withGitLab([
      v1, lookupUsers(["bob"], { bob: 2 }), lookupMilestone("acme/app", "18.2", 4),
      v1, mutation("UpdateWorkItem", input, { workItem: { id: ID } }),
      fetchWorkItem({
        title: "Login times out", description: "Steps:\n1. Log in\n2. Wait 30 seconds", assignees: ["bob"], milestone: "18.2",
        state: "CLOSED", dueDate: "2026-11-01", updatedAt: "2026-10-02T08:00:00Z",
      }),
    ]);

    const prepared = await s.call("prepare_writes", {
      writes: [{
        kind: "edit", reference: "acme/app#12", title: "Login times out", description: "Steps:\n1. Log in\n2. Wait 30 seconds",
        assignees: ["bob"], milestone: "18.2", state: "close", dueDate: "2026-11-01",
      }],
    });

    expect(prepared.text).toContain("title: Login slow → Login times out");
    expect(prepared.text).toContain("- 2. Wait");
    expect(prepared.text).toContain("+ 2. Wait 30 seconds");
    expect(prepared.text).toContain("assignees: alice → bob");
    expect(prepared.text).toContain("milestone: none → 18.2");
    expect(prepared.text).toContain("state: open → closed");
    expect(prepared.text).toContain("due date: none → 2026-11-01");

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("clears a milestone and a due date", async () => {
    const v1 = fetchWorkItem({ milestone: "18.2", dueDate: "2026-11-01" });
    const s = await withGitLab([
      v1,
      v1, mutation("UpdateWorkItem", { id: ID, milestoneWidget: { milestoneId: null }, startAndDueDateWidget: { dueDate: null } }, { workItem: { id: ID } }),
      fetchWorkItem({ milestone: null, dueDate: null, updatedAt: "2026-10-02T08:00:00Z" }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", milestone: null, dueDate: null }] });
    expect(prepared.text).toContain("milestone: 18.2 → none");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("reports a field GitLab silently dropped, such as a second assignee on Free", async () => {
    const v1 = fetchWorkItem({ assignees: [] });
    const s = await withGitLab([
      v1, lookupUsers(["alice", "bob"], { alice: 1, bob: 2 }),
      v1, mutation("UpdateWorkItem", { id: ID, assigneesWidget: { assigneeIds: ["gid://gitlab/User/1", "gid://gitlab/User/2"] } }, { workItem: { id: ID } }),
      fetchWorkItem({ assignees: ["alice"], updatedAt: "2026-10-02T08:00:00Z" }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", assignees: ["alice", "bob"] }] });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: ["assignees: asked for alice, bob; GitLab kept alice"] });
    expect(applied.text).toContain("didn't stick: assignees");
  });

  it("stops at the first failure, reporting GitLab's error and what wasn't applied", async () => {
    const one = fetchWorkItem({ iid: "12", labels: ["bug"] });
    const two = fetchWorkItem({ iid: "13", id: 1013, labels: ["bug"] });
    const s = await withGitLab([
      one, lookupLabel("acme/app", "blocked", 7), two, lookupLabel("acme/app", "blocked", 7),
      one,
      mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/7"], removeLabelIds: [] } }, { workItem: null }, ["Label not allowed here"]),
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] },
        { kind: "edit", reference: "acme/app#13", addLabels: ["blocked"] },
      ],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results).toEqual([
      expect.objectContaining({ number: 1, outcome: "failed", detail: "Label not allowed here" }),
      expect.objectContaining({ number: 2, outcome: "not applied" }),
    ]);
  });

  it.each([
    ["title", { title: "New" }, { updateWorkItem: false }],
    ["labels", { addLabels: ["blocked"] }, { setWorkItemMetadata: false }],
    ["state", { state: "close" }, { updateWorkItem: false }],
  ])("refuses at preview time when the token can't change the %s", async (_, change, permissions) => {
    const s = await withGitLab([fetchWorkItem({ permissions })]);

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", ...change }] });

    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/your token can't/);
  });

  it("refuses weight up front where the Instance doesn't offer it", async () => {
    session = await start({
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ enterprise: false }), fetchWorkItem({}, { enterprise: false })] }),
    });

    const prepared = await session.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", weight: 3 }] });

    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/weight isn't available/);
  });

  it("previews and sends weight where the Instance offers it", async () => {
    const v1 = fetchWorkItem({ weight: null });
    const s = await withGitLab([
      v1,
      v1, mutation("UpdateWorkItem", { id: ID, weightWidget: { weight: 3 } }, { workItem: { id: ID } }),
      fetchWorkItem({ weight: 3, updatedAt: "2026-10-02T08:00:00Z" }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", weight: 3 }] });
    expect(prepared.text).toContain("weight: none → 3");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("sets a Task's parent Issue", async () => {
    const task = fetchWorkItem({ iid: "13", id: 1013, type: "Task", parent: null });
    const s = await withGitLab([
      task, resolveWorkItem("acme/app", "12", 1012),
      task, mutation("UpdateWorkItem", { id: "gid://gitlab/WorkItem/1013", hierarchyWidget: { parentId: ID } }, { workItem: { id: "gid://gitlab/WorkItem/1013" } }),
      fetchWorkItem({ iid: "13", id: 1013, type: "Task", parent: { reference: "acme/app#12", title: "Login times out" }, updatedAt: "2026-10-02T08:00:00Z" }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#13", parent: "acme/app#12" }] });
    expect(prepared.text).toContain("parent: none → acme/app#12");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
  });

  it("adds and removes Linked Items", async () => {
    const v1 = fetchWorkItem({ linked: [{ linkType: "relates_to", reference: "acme/app#30", title: "Old link" }] });
    const s = await withGitLab([
      v1, resolveWorkItem("acme/app", "20", 1020), resolveWorkItem("acme/app", "30", 1030),
      v1,
      mutation("AddLinkedItems", { id: ID, workItemsIds: ["gid://gitlab/WorkItem/1020"], linkType: "RELATED" }, { workItem: { id: ID } }),
      mutation("RemoveLinkedItems", { id: ID, workItemsIds: ["gid://gitlab/WorkItem/1030"] }, { workItem: { id: ID } }),
      fetchWorkItem({ linked: [{ linkType: "relates_to", reference: "acme/app#20", title: "New link" }], updatedAt: "2026-10-02T08:00:00Z" }),
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "edit", reference: "acme/app#12", addLinks: [{ reference: "acme/app#20", linkType: "relates_to" }], removeLinks: ["acme/app#30"] }],
    });
    expect(prepared.text).toContain("link: relates to acme/app#20");
    expect(prepared.text).toContain("unlink: acme/app#30");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
    expect(s.glabCalls().some((c) => c.body?.operationName === "UpdateWorkItem")).toBe(false);
  });

  it("says which parts of an Edit reached GitLab when a later part fails", async () => {
    const v1 = fetchWorkItem();
    const s = await withGitLab([
      v1, resolveWorkItem("acme/app", "20", 1020),
      v1,
      mutation("UpdateWorkItem", { id: ID, title: "Renamed" }, { workItem: { id: ID } }),
      mutation("AddLinkedItems", { id: ID, workItemsIds: ["gid://gitlab/WorkItem/1020"], linkType: "RELATED" }, { workItem: null }, ["Linked item limit reached"]),
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "edit", reference: "acme/app#12", title: "Renamed", addLinks: [{ reference: "acme/app#20", linkType: "relates_to" }] }],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "failed" });
    expect(applied.data.results[0].detail).toBe(
      "GitLab refused part of it: Linked item limit reached. Sent before that: title. Not sent: link: relates to acme/app#20.",
    );
  });

  it("links more than 10 Work Items in batches of 10, GitLab's limit per request", async () => {
    const targets = Array.from({ length: 11 }, (_, i) => ({ iid: String(100 + i), id: 2000 + i }));
    const s = await withGitLab([
      fetchWorkItem(),
      ...targets.map((t) => resolveWorkItem("acme/app", t.iid, t.id)),
      fetchWorkItem(),
      mutation("AddLinkedItems", { id: ID, workItemsIds: targets.slice(0, 10).map((t) => `gid://gitlab/WorkItem/${t.id}`), linkType: "RELATED" }, { workItem: { id: ID } }),
      mutation("AddLinkedItems", { id: ID, workItemsIds: [`gid://gitlab/WorkItem/${targets[10]!.id}`], linkType: "RELATED" }, { workItem: { id: ID } }),
      fetchWorkItem({
        linked: targets.map((t) => ({ linkType: "relates_to", reference: `acme/app#${t.iid}`, title: "Linked" })),
        updatedAt: "2026-10-02T08:00:00Z",
      }),
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "edit", reference: "acme/app#12", addLinks: targets.map((t) => ({ reference: `acme/app#${t.iid}`, linkType: "relates_to" })) }],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "done", didNotStick: [] });
    expect(s.glabCalls().filter((c) => c.body?.operationName === "AddLinkedItems")).toHaveLength(2);
  });

  it("refuses parent and link changes the token can't make", async () => {
    const s = await withGitLab([fetchWorkItem({ permissions: { adminParentLink: false, adminWorkItemLink: false } })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", parent: null, removeLinks: ["acme/app#30"] }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/can't change its parent, or change its Linked Items/);
  });
});

describe("applying", () => {
  it("is the one tool Claude Code must ask the user about on every call, whatever their permission mode", async () => {
    const s = await withGitLab([]);

    const tools = await s.tools();

    const asking = tools.filter((t) => t._meta?.["anthropic/requiresUserInteraction"] === true).map((t) => t.name);
    expect(asking).toEqual(["apply_writes"]);
  });
});

describe("a plan", () => {
  it("reaches Claude as the preview text alone, so Claude can show it, and so does the report", async () => {
    const s = await withGitLab(
      [fetchWorkItem(), lookupLabel("acme/app", "p1", 9), fetchWorkItem(), mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/9"], removeLabelIds: [] } }, { workItem: { id: ID } }), fetchWorkItem({ labels: ["bug", "p1"], updatedAt: "2026-10-02T08:00:00Z" })],
    );

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["p1"] }] });
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(prepared.structured).toBeUndefined();
    expect(prepared.text).toMatch(/labels: .* → .*p1/);
    expect(applied.structured).toBeUndefined();
    expect(applied.text).toMatch(/^1\. Edit acme\/app#12 https:\/\/gitlab\.example\.com\/acme\/app\/-\/work_items\/12: done$/m);
  });


  it("lets the user drop Writes before applying; the rest still apply, and dropped ones aren't sent", async () => {
    const one = fetchWorkItem({ iid: "12", labels: [] });
    const two = fetchWorkItem({ iid: "13", id: 1013, labels: [] });
    const s = await withGitLab([
      one, lookupLabel("acme/app", "p1", 9), two, lookupLabel("acme/app", "p1", 9),
      two, mutation("UpdateWorkItem", { id: "gid://gitlab/WorkItem/1013", labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/9"], removeLabelIds: [] } }, { workItem: { id: "x" } }),
      fetchWorkItem({ iid: "13", id: 1013, labels: ["p1"], updatedAt: "2026-10-02T08:00:00Z" }),
    ], { elicit: () => ({ action: "accept", content: { confirm: true } }) });
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["p1"] },
        { kind: "edit", reference: "acme/app#13", addLabels: ["p1"] },
      ],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId, drop: [1] });

    expect(s.elicitations[0]!.message).not.toContain("acme/app#12");
    expect(s.elicitations[0]!.message).toMatch(/^2\. Edit acme\/app#13/m);
    expect(applied.data.results).toEqual([
      expect.objectContaining({ number: 1, outcome: "not applied", detail: expect.stringMatching(/dropped/i) }),
      expect.objectContaining({ number: 2, outcome: "done" }),
    ]);
  });

  it("holds at most 20 Writes", async () => {
    const s = await withGitLab([]);
    const writes = Array.from({ length: 21 }, (_, i) => ({ kind: "comment", reference: `acme/app#${i + 1}`, body: "x" }));
    const prepared = await s.call("prepare_writes", { writes });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/at most 20.*Split/);
  });

  it("can only be applied once", async () => {
    const s = await withGitLab([fetchWorkItem(), mutation("CreateNote", { noteableId: ID, body: "Hi\n\n_Posted with Claude Code_", internal: false }, { note: { id: "n" } })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "Hi" }] });
    await s.call("apply_writes", { planId: prepared.data.planId });

    const again = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/no prepared plan/);
    expect(s.glabCalls().filter((c) => c.body?.operationName === "CreateNote")).toHaveLength(1);
  });
});

describe("blocking links", () => {
  const blocks = { kind: "edit", reference: "acme/app#12", addLinks: [{ reference: "acme/app#20", linkType: "blocks" }] };

  it("are refused up front on EE below Premium", async () => {
    const s = await withGitLab([fetchWorkItem({ permissions: { blockedWorkItems: false } })]);
    const prepared = await s.call("prepare_writes", { writes: [blocks] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/"blocks" links need GitLab Premium/);
  });

  it("are prepared where the tier has them", async () => {
    const s = await withGitLab([fetchWorkItem(), resolveWorkItem("acme/app", "20", 1020)]);
    const prepared = await s.call("prepare_writes", { writes: [blocks] });
    expect(prepared.isError).toBe(false);
    expect(prepared.text).toContain("link: blocks acme/app#20");
  });

  it("are refused up front on CE, which doesn't have them", async () => {
    session = await start({
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ enterprise: false }), fetchWorkItem({}, { enterprise: false })] }),
    });
    const prepared = await session.call("prepare_writes", {
      writes: [{ kind: "edit", reference: "acme/app#12", addLinks: [{ reference: "acme/app#20", linkType: "blocks" }] }],
    });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/"blocks" links need GitLab Premium/);
  });
});
