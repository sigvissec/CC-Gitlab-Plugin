import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { fetchWorkItem } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withItems(interactions: Interaction[], options: { baseUrl?: string; version?: string; enterprise?: boolean } = {}) {
  const host = options.baseUrl ? new URL(options.baseUrl).hostname : undefined;
  session = await start({
    baseUrl: options.baseUrl,
    cassette: cassette({
      auth: loggedIn(host),
      interactions: [instanceProbe({ version: options.version, enterprise: options.enterprise }), ...interactions],
    }),
  });
  return session;
}

describe("fetching one Work Item", () => {
  it("returns a digest from a Work Item URL", async () => {
    const s = await withItems([
      fetchWorkItem({
        title: "Login times out",
        labels: ["bug", "auth"],
        assignees: ["alice"],
        milestone: "18.2",
        dueDate: "2026-11-01",
        parent: { reference: "acme/app#3", title: "Auth hardening", type: "Issue" },
        children: [{ reference: "acme/app#13", title: "Write repro test" }],
        linked: [{ linkType: "relates_to", reference: "acme/app#20", title: "Session cookie" }],
        threads: [
          { id: "d1", resolved: false, notes: [{ id: 101, author: "bob", body: "Can you add logs?" }] },
          { id: "d2", resolved: true, notes: [{ id: 102, author: "carol", body: "Done" }] },
        ],
      }),
    ]);

    const result = await s.call("fetch_work_item", { reference: "https://gitlab.example.com/acme/app/-/work_items/12" });

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      reference: "acme/app#12",
      url: "https://gitlab.example.com/acme/app/-/work_items/12",
      title: "Login times out",
      type: "Issue",
      state: "open",
      assignees: ["alice"],
      labels: ["bug", "auth"],
      milestone: "18.2",
      dueDate: "2026-11-01",
      parent: { reference: "acme/app#3", title: "Auth hardening" },
      childrenCount: 1,
      linkedItemsCount: 1,
      threads: { total: 2, unresolved: 1 },
    });
    expect(result.text).toContain("acme/app#12");
    expect(result.text).toContain("Can you add logs?");
  });

  it("accepts a full reference and the older /-/issues/ URL", async () => {
    const s = await withItems([fetchWorkItem({ fullPath: "acme/platform/app", iid: "7" })]);

    const byReference = await s.call("fetch_work_item", { reference: "acme/platform/app#7" });
    const byIssueUrl = await s.call("fetch_work_item", { reference: "https://gitlab.example.com/acme/platform/app/-/issues/7" });

    expect(byReference.data.reference).toBe("acme/platform/app#7");
    expect(byIssueUrl.data.reference).toBe("acme/platform/app#7");
  });

  it("puts a linked Comment's Thread in focus", async () => {
    const s = await withItems([
      fetchWorkItem({
        threads: [
          { id: "d1", notes: [{ id: 101, author: "bob", body: "First" }] },
          { id: "d2", notes: [{ id: 456, author: "carol", body: "Which browser?" }, { id: 457, author: "alice", body: "Firefox" }] },
        ],
      }),
    ]);

    const result = await s.call("fetch_work_item", { reference: "https://gitlab.example.com/acme/app/-/work_items/12#note_457" });

    expect(result.data.focus).toMatchObject({ threadId: "gid://gitlab/Discussion/d2", commentId: "gid://gitlab/Note/457" });
  });

  it("works on an Instance under a sub-path", async () => {
    const s = await withItems([fetchWorkItem()], { baseUrl: "https://example.com/gitlab" });

    const result = await s.call("fetch_work_item", { reference: "https://example.com/gitlab/acme/app/-/work_items/12" });

    expect(result.isError).toBe(false);
    expect(result.data.reference).toBe("acme/app#12");
  });

  describe("refusals", () => {
    it("refuses a Reference to a different Instance, naming both", async () => {
      const s = await withItems([]);
      const result = await s.call("fetch_work_item", { reference: "https://gitlab.com/acme/app/-/work_items/12" });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("https://gitlab.com");
      expect(result.text).toContain("https://gitlab.example.com");
      expect(s.glabCalls().filter((c) => c.body?.operationName === "FetchWorkItem")).toHaveLength(0);
    });

    it.each([
      ["acme&45", /Epic/],
      ["https://gitlab.example.com/groups/acme/-/epics/45", /Epic/],
      ["https://gitlab.example.com/groups/acme/-/work_items/45", /Epic/],
      ["acme/app!34", /merge request/],
      ["https://gitlab.example.com/acme/app/-/merge_requests/34", /merge request/],
    ])("refuses %s as unsupported", async (reference, message) => {
      const s = await withItems([]);
      const result = await s.call("fetch_work_item", { reference });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(message);
    });

    it("refuses a short Reference, which Claude must resolve to a full one first", async () => {
      const s = await withItems([]);
      const result = await s.call("fetch_work_item", { reference: "#12" });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/full reference/);
    });

    it("refuses an unsupported Work Item Type, naming it", async () => {
      const s = await withItems([fetchWorkItem({ type: "Incident", iid: "57" })]);
      const result = await s.call("fetch_work_item", { reference: "acme/app#57" });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("acme/app#57 is an Incident");
      expect(result.text).toMatch(/Issues and Tasks/);
    });

    it("says not found, or not visible to the token, without claiming which", async () => {
      const s = await withItems([fetchWorkItem({ iid: "99" }, { missing: true })]);
      const result = await s.call("fetch_work_item", { reference: "acme/app#99" });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("acme/app#99");
      expect(result.text).toMatch(/not found, or your token can't see it/);
      expect(result.text).toContain("https://gitlab.example.com");
    });

    it("stops on GitLab older than 18.1", async () => {
      const s = await withItems([], { version: "17.11.2-ee" });
      const result = await s.call("fetch_work_item", { reference: "acme/app#12" });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/needs GitLab 18\.1 or later/);
    });
  });

  it("doesn't ask a CE Instance for EE-only fields", async () => {
    const s = await withItems([fetchWorkItem({}, { enterprise: false })], { enterprise: false });

    const result = await s.call("fetch_work_item", { reference: "acme/app#12" });

    expect(result.isError).toBe(false);
    const fetch = s.glabCalls().find((c) => c.body?.operationName === "FetchWorkItem");
    expect(fetch?.body?.query).not.toContain("WorkItemWidgetWeight");
  });
});

describe("associated merge requests in the digest", () => {
  it("merges closing and mentioning merge requests, once each, labelled", async () => {
    const s = await withItems([
      fetchWorkItem({
        closingMrs: [{ id: 1, reference: "acme/app!34", title: "Fix timeout", state: "opened" }],
        relatedMrs: [
          { id: 1, reference: "acme/app!34", title: "Fix timeout", state: "opened" },
          { id: 2, reference: "acme/web!8", title: "Mention it", state: "merged" },
        ],
      }),
    ]);

    const result = await s.call("fetch_work_item", { reference: "acme/app#12" });

    expect(result.data.mergeRequests.shown).toEqual([
      { reference: "acme/app!34", title: "Fix timeout", state: "open", relation: "closes", url: "https://gitlab.example.com/acme/app/-/merge_requests/34" },
      { reference: "acme/web!8", title: "Mention it", state: "merged", relation: "mentions", url: "https://gitlab.example.com/acme/web/-/merge_requests/8" },
    ]);
  });

  it("shows at most 10, draft and open first, then merged, then closed, and counts the rest", async () => {
    const related = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, reference: `acme/app!${10 + i}`, title: `Closed ${i}`, state: "closed" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: 20 + i, reference: `acme/app!${20 + i}`, title: `Merged ${i}`, state: "merged" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: 30 + i, reference: `acme/app!${30 + i}`, title: `Open ${i}`, state: "opened" as const })),
      { id: 40, reference: "acme/app!40", title: "Draft", state: "opened" as const, draft: true },
    ];
    const s = await withItems([fetchWorkItem({ relatedMrs: related })]);

    const result = await s.call("fetch_work_item", { reference: "acme/app#12" });

    const states = result.data.mergeRequests.shown.map((m: { state: string }) => m.state);
    expect(states).toEqual(["draft", "open", "open", "open", "merged", "merged", "merged", "merged", "closed", "closed"]);
    expect(result.data.mergeRequests.more).toBe(3);
  });

  it("reports closing merge requests the token can't see as hidden", async () => {
    const s = await withItems([
      fetchWorkItem({ closingMrs: [{ id: 1, reference: "acme/app!34", title: "Visible", state: "opened" }], closingCount: 3 }),
    ]);

    const result = await s.call("fetch_work_item", { reference: "acme/app#12" });

    expect(result.data.mergeRequests.hidden).toBe(2);
    expect(result.text).toMatch(/2 more.*can't see/);
  });
});
