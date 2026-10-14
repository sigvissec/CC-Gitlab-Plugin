import { afterEach, describe, expect, it } from "vitest";
import { start, type Session, type StartOptions } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { fetchWorkItem, mutation } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withGitLab(interactions: Interaction[], options: Partial<StartOptions> = {}) {
  session = await start({ ...options, cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe(), ...interactions] }) });
  return session;
}

const ID = "gid://gitlab/WorkItem/1012";
const FOOTER = "\n\n_Posted with Claude Code_";

describe("a Comment", () => {
  it("is public by default, carries the footer, and is previewed exactly as it will appear", async () => {
    const item = fetchWorkItem();
    const s = await withGitLab([
      item,
      mutation("CreateNote", { noteableId: ID, body: `Can you add logs?${FOOTER}`, internal: false }, { note: { id: "gid://gitlab/Note/900", url: "u" } }),
    ]);

    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "Can you add logs?" }] });

    expect(prepared.text).toContain("Comment on acme/app#12 (public)");
    expect(prepared.text).toContain("Can you add logs?");
    expect(prepared.text).toContain("_Posted with Claude Code_");

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it("is internal only when asked", async () => {
    const s = await withGitLab([
      fetchWorkItem(),
      mutation("CreateNote", { noteableId: ID, body: `Internal note${FOOTER}`, internal: true }, { note: { id: "gid://gitlab/Note/901" } }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "Internal note", internal: true }] });
    expect(prepared.text).toContain("(internal)");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it("asks to post publicly or cancel when the role can't post internal Comments", async () => {
    const s = await withGitLab([fetchWorkItem({ permissions: { markNoteAsInternal: false } })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "x", internal: true }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/can't post internal Comments.*publicly instead, or cancel/s);
  });

  it("leaves the footer off when the setting is off", async () => {
    const s = await withGitLab(
      [fetchWorkItem(), mutation("CreateNote", { noteableId: ID, body: "No footer", internal: false }, { note: { id: "gid://gitlab/Note/902" } })],
      { footer: false },
    );
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "No footer" }] });
    expect(prepared.text).not.toContain("Posted with Claude Code");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it("starts a Thread only when asked", async () => {
    const s = await withGitLab([
      fetchWorkItem(),
      mutation("CreateDiscussion", { noteableId: ID, body: `Let's discuss${FOOTER}`, internal: false }, { note: { id: "gid://gitlab/Note/903" } }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "Let's discuss", startThread: true }] });
    expect(prepared.text).toContain("New Thread on acme/app#12");
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it("is refused when the token can't comment", async () => {
    const s = await withGitLab([fetchWorkItem({ permissions: { createNote: false } })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "comment", reference: "acme/app#12", body: "x" }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/can't post Comments/);
  });
});

const THREADS = {
  threads: [
    { id: "d1", notes: [{ id: 101, author: "bob", body: "Unrelated" }] },
    { id: "d2", notes: [{ id: 456, author: "carol", body: "Which browser?" }] },
  ],
};

describe("a reply", () => {
  it("goes into the Thread of a linked Comment, with the Thread's visibility", async () => {
    const item = fetchWorkItem(THREADS);
    const s = await withGitLab([
      item,
      item, // nothing new in the Thread right before sending
      mutation("CreateNote", { noteableId: ID, discussionId: "gid://gitlab/Discussion/d2", body: `Firefox 130${FOOTER}` }, { note: { id: "gid://gitlab/Note/457" } }),
    ]);

    const prepared = await s.call("prepare_writes", {
      writes: [{ kind: "reply", reference: "https://gitlab.example.com/acme/app/-/work_items/12#note_456", body: "Firefox 130" }],
    });

    expect(prepared.text).toMatch(/Reply on acme\/app#12 \(public, like its Thread\) in the Thread "Which browser\?" by carol, 0 replies/);
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it("isn't sent if the Thread gained Comments after the preview", async () => {
    const s = await withGitLab([
      fetchWorkItem(THREADS),
      fetchWorkItem({
        threads: [THREADS.threads[0]!, { id: "d2", notes: [...THREADS.threads[1]!.notes, { id: 460, author: "dave", body: "Also Safari" }] }],
        updatedAt: "2026-10-03T00:00:00Z",
      }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "reply", reference: "acme/app#12", thread: "d2", body: "Firefox" }] });

    const applied = await s.call("apply_writes", { planId: prepared.data.planId });

    expect(applied.data.results[0]).toMatchObject({ outcome: "not applied", detail: expect.stringMatching(/new Comments/) });
    expect(s.glabCalls().some((c) => c.body?.operationName === "CreateNote")).toBe(false);
  });

  it("asks which Thread when the Reference doesn't name one", async () => {
    const s = await withGitLab([fetchWorkItem(THREADS)]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "reply", reference: "acme/app#12", body: "x" }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(/Say which Thread/);
  });
});

describe("resolving a Thread", () => {
  it("resolves the named Thread after a preview of it", async () => {
    const item = fetchWorkItem(THREADS);
    const s = await withGitLab([
      item,
      item,
      mutation("ResolveThread", { id: "gid://gitlab/Discussion/d2", resolve: true }, { discussion: { id: "gid://gitlab/Discussion/d2", resolved: true } }),
    ]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "resolve", reference: "acme/app#12", thread: "gid://gitlab/Discussion/d2" }] });
    expect(prepared.text).toContain('Resolve the Thread on acme/app#12: "Which browser?" by carol, 0 replies');
    const applied = await s.call("apply_writes", { planId: prepared.data.planId });
    expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
  });

  it.each([
    ["already resolved", { resolved: true }, /already resolved/],
    ["not resolvable by the token", { canResolve: false }, /can't resolve that Thread/],
    ["a plain Comment", { resolvable: false }, /plain Comment/],
  ])("is refused when the Thread is %s", async (_, thread, message) => {
    const s = await withGitLab([fetchWorkItem({ threads: [{ id: "d2", ...thread, notes: [{ id: 456, author: "carol", body: "Q" }] }] })]);
    const prepared = await s.call("prepare_writes", { writes: [{ kind: "resolve", reference: "acme/app#12", thread: "d2" }] });
    expect(prepared.isError).toBe(true);
    expect(prepared.text).toMatch(message);
  });
});
