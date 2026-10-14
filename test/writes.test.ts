import { afterEach, describe, expect, it } from "vitest";
import { start, type Session, type StartOptions } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { fetchWorkItem, lookupLabel, mutation } from "./support/fixtures.js";

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
    expect(applied.data.results).toEqual([expect.objectContaining({ index: 1, outcome: "done", didNotStick: [] })]);
  });

  it("isn't sent if the Work Item changed after the preview, and nothing after it runs", async () => {
    const before = fetchWorkItem({ labels: ["bug"] });
    const s = await withGitLab([
      before,
      lookupLabel("acme/app", "blocked", 7),
      fetchWorkItem({ labels: ["bug"], updatedAt: "2026-10-03T00:00:00Z" }), // a colleague edited it
    ]);
    const prepared = await s.call("prepare_writes", {
      writes: [
        { kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] },
        { kind: "edit", reference: "acme/app#12", removeLabels: ["bug"] },
      ],
    });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results).toEqual([
      expect.objectContaining({ index: 1, outcome: "not applied", detail: expect.stringMatching(/changed in GitLab since it was fetched/) }),
      expect.objectContaining({ index: 2, outcome: "not applied" }),
    ]);
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
});
