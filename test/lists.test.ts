import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { LIST_DEFAULTS, listPage, resolveWorkItem } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withPages(...interactions: Interaction[]) {
  session = await start({ cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ username: "alice" }), ...interactions] }) });
  return session;
}

describe("listing Work Items", () => {
  it("lists a project's open Issues and Tasks as compact summaries, most recently updated first", async () => {
    const s = await withPages(
      listPage({ fullPath: "acme/app", ...LIST_DEFAULTS }, [
        { reference: "acme/app#12", title: "Login times out", assignees: ["alice"], labels: ["bug"], milestone: "18.2", updatedAt: "2026-10-02T09:00:00Z" },
        { reference: "acme/app#13", title: "Write repro test", type: "Task", parent: "acme/app#12" },
      ]),
    );

    const result = await s.call("list_work_items", { fullPath: "acme/app" });

    expect(result.isError).toBe(false);
    expect(result.data.items).toEqual([
      {
        reference: "acme/app#12",
        title: "Login times out",
        type: "Issue",
        state: "open",
        assignees: ["alice"],
        labels: ["bug"],
        milestone: "18.2",
        parent: null,
        updatedAt: "2026-10-02T09:00:00Z",
        url: "https://gitlab.example.com/acme/app/-/work_items/12",
      },
      {
        reference: "acme/app#13",
        title: "Write repro test",
        type: "Task",
        state: "open",
        assignees: [],
        labels: [],
        milestone: null,
        parent: "acme/app#12",
        updatedAt: "2026-10-01T12:00:00Z",
        url: "https://gitlab.example.com/acme/app/-/work_items/13",
      },
    ]);
    expect(result.data.hasMore).toBe(false);
  });

  it("maps filters onto GitLab's: state, type, assignee, author, labels (all, none of, any of), milestone, and text", async () => {
    const s = await withPages(
      listPage(
        {
          fullPath: "acme",
          ...LIST_DEFAULTS,
          state: "closed",
          types: ["TASK"],
          assigneeUsernames: ["bob"],
          authorUsername: "carol",
          labelName: ["bug", "auth"],
          not: { labelName: ["wontfix"] },
          or: { labelNames: ["p1", "p2"] },
          milestoneTitle: ["18.2"],
          search: "timeout",
          in: ["TITLE", "DESCRIPTION"],
        },
        [{ reference: "acme/app#13", type: "Task", state: "CLOSED" }],
      ),
    );

    const result = await s.call("list_work_items", {
      fullPath: "acme",
      state: "closed",
      types: ["Task"],
      assignees: ["bob"],
      author: "carol",
      labels: ["bug", "auth"],
      excludeLabels: ["wontfix"],
      anyLabels: ["p1", "p2"],
      milestone: "18.2",
      search: "timeout",
    });

    expect(result.isError).toBe(false);
    expect(result.data.items.map((i: { reference: string }) => i.reference)).toEqual(["acme/app#13"]);
  });

  it("filters by \"assigned to me\" using the signed-in username", async () => {
    const s = await withPages(listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, assigneeUsernames: ["alice"] }, [{ reference: "acme/app#12" }]));

    const result = await s.call("list_work_items", { fullPath: "acme/app", assignedToMe: true });

    expect(result.isError).toBe(false);
    expect(result.data.items).toHaveLength(1);
  });

  it("filters by parent, given the parent's Reference", async () => {
    const s = await withPages(
      resolveWorkItem("acme/app", "12", 1012),
      listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, parentIds: ["gid://gitlab/WorkItem/1012"] }, [{ reference: "acme/app#13", type: "Task" }]),
    );

    const result = await s.call("list_work_items", { fullPath: "acme/app", parent: "https://gitlab.example.com/acme/app/-/work_items/12" });

    expect(result.isError).toBe(false);
    expect(result.data.items.map((i: { reference: string }) => i.reference)).toEqual(["acme/app#13"]);
  });

  it("fetches further pages only when asked, up to 200, and says when more exist", async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ reference: `acme/app#${start + i}` }));
    const s = await withPages(
      listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, first: 100 }, page(1, 100), { hasNextPage: true, endCursor: "c1" }),
      listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, first: 50, after: "c1" }, page(101, 50), { hasNextPage: true, endCursor: "c2" }),
    );

    const result = await s.call("list_work_items", { fullPath: "acme/app", limit: 150 });

    expect(result.data.items).toHaveLength(150);
    expect(result.data).toMatchObject({ hasMore: true, endCursor: "c2" });
    expect(result.text).toContain("More Work Items exist");
  });

  it("refuses more than 200 at once", async () => {
    const s = await withPages();
    const result = await s.call("list_work_items", { fullPath: "acme/app", limit: 250 });
    expect(result.isError).toBe(true);
  });

  it("continues a list from a cursor", async () => {
    const s = await withPages(listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, after: "c2" }, [{ reference: "acme/app#151" }]));
    const result = await s.call("list_work_items", { fullPath: "acme/app", after: "c2" });
    expect(result.data).toMatchObject({ items: [expect.objectContaining({ reference: "acme/app#151" })], hasMore: false, endCursor: null });
  });

  it("says when the project or group can't be found", async () => {
    const s = await withPages({ operationName: "ListWorkItems", variables: { fullPath: "nope", ...LIST_DEFAULTS }, response: { body: { data: { namespace: null } } } });
    const result = await s.call("list_work_items", { fullPath: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/nope.*not found, or your token can't see it/);
  });

  it("lists my open Work Items across the Instance", async () => {
    const s = await withPages(
      listPage(
        { first: 20, state: "opened", types: ["ISSUE", "TASK"], sort: "UPDATED_DESC", assigneeUsernames: ["alice"] },
        [{ reference: "acme/app#12", assignees: ["alice"] }, { reference: "other/tool#4", assignees: ["alice"], type: "Task" }],
        {},
        "ListMyWorkItems",
      ),
    );

    const result = await s.call("my_work_items");

    expect(result.isError).toBe(false);
    expect(result.data.items.map((i: { reference: string }) => i.reference)).toEqual(["acme/app#12", "other/tool#4"]);
  });
});
