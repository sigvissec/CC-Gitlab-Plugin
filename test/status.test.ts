import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn } from "./support/cassette.js";
import { LIST_DEFAULTS, fetchWorkItem, listPage, lookupTypes } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("status", () => {
  it("reports the Instance, GitLab version and edition, signed-in user, and token source", async () => {
    session = await start({
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ version: "18.4.2-ee", username: "alice" })] }),
    });

    const result = await session.call("status");

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      instance: "https://gitlab.example.com",
      gitlabVersion: "18.4.2-ee",
      edition: "EE",
      user: "alice",
      tokenSource: "glab login",
      meetsMinimumVersion: true,
    });
  });

  it("refuses an Instance older than GitLab 18.1, naming the minimum", async () => {
    session = await start({
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ version: "18.0.3-ee" })] }),
    });

    const result = await session.call("status");

    expect(result.data).toMatchObject({ gitlabVersion: "18.0.3-ee", meetsMinimumVersion: false });
    expect(result.text).toContain("18.1");
  });

  it("reports glab's version and whether it meets the minimum", async () => {
    session = await start({
      cassette: cassette({ glabVersion: "1.123.0", auth: loggedIn(), interactions: [instanceProbe()] }),
    });

    const result = await session.call("status");

    expect(result.data).toMatchObject({ glabVersion: "1.123.0", glabMeetsMinimum: true });
  });

  it("flags a glab older than the minimum", async () => {
    session = await start({
      cassette: cassette({ glabVersion: "1.90.0", auth: loggedIn(), interactions: [instanceProbe()] }),
    });

    const result = await session.call("status");

    expect(result.data).toMatchObject({ glabVersion: "1.90.0", glabMeetsMinimum: false });
    expect(result.text).toMatch(/glab 1\.123\.0 or later/);
  });

  it("says glab is missing when it isn't installed", async () => {
    session = await start({ cassette: cassette({}), withoutGlab: true });

    const result = await session.call("status");

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/glab isn't installed/);
  });

  it("says it ran no read-only probes without a project, and how to run them", async () => {
    session = await start({ cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe()] }) });

    const result = await session.call("status");

    expect(result.text).toContain("Read-only probes: not run. Name a project to run them in, for example /gitlab-work-items:status acme/app.");
  });

  it("runs read-only probes against a project when given one", async () => {
    session = await start({
      cassette: cassette({
        auth: loggedIn(),
        interactions: [
          instanceProbe(),
          lookupTypes("acme/app"),
          listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, first: 1, types: ["ISSUE"] }, [{ reference: "acme/app#12" }]),
          fetchWorkItem({ closingMrs: [{ id: 1, reference: "acme/app!34", title: "Fix", state: "opened" }] }),
        ],
      }),
    });

    const result = await session.call("status", { project: "acme/app" });

    expect(result.isError).toBe(false);
    expect(result.data.probes).toEqual([
      { probe: "Work Item Types", ok: true, detail: "Issue and Task available" },
      { probe: "List query", ok: true, detail: "acme/app#12 https://gitlab.example.com/acme/app/-/work_items/12" },
      { probe: "Fetch with merge requests", ok: true, detail: "acme/app#12 https://gitlab.example.com/acme/app/-/work_items/12: 1 associated merge request" },
    ]);
  });

  it("reports a failing probe with GitLab's message, without failing status", async () => {
    session = await start({
      cassette: cassette({
        auth: loggedIn(),
        interactions: [
          instanceProbe(),
          lookupTypes("acme/app"),
          {
            operationName: "ListWorkItems",
            variables: { fullPath: "acme/app", ...LIST_DEFAULTS, first: 1, types: ["ISSUE"] },
            response: { exitCode: 1, body: { errors: [{ message: "Field 'workItems' doesn't exist on type 'Namespace'" }] } },
          },
        ],
      }),
    });

    const result = await session.call("status", { project: "acme/app" });

    expect(result.isError).toBe(false);
    expect(result.data.probes[1]).toEqual({ probe: "List query", ok: false, detail: "Field 'workItems' doesn't exist on type 'Namespace'" });
  });

  it.each([
    ["the token after the user signs glab in", cassette({ interactions: [instanceProbe()] }), /No GitLab token/],
    ["glab after the user upgrades it", cassette({ glabVersion: "1.40.0", auth: loggedIn(), interactions: [instanceProbe()] }), /glab 1\.40\.0 is installed/],
    [
      "the Instance after its token works again",
      cassette({ auth: loggedIn(), interactions: [{ operationName: "InstanceProbe", response: { body: { data: { metadata: null, currentUser: null } } } }] }),
      /didn't report its version/,
    ],
  ])("checks %s, on the next call", async (_, broken, problem) => {
    session = await start({ cassette: broken });
    const before = await session.call("fetch_work_item", { reference: "acme/app#12" });
    expect(before.isError).toBe(true);
    expect(before.text).toMatch(problem);

    session.setCassette(cassette({ auth: loggedIn(), interactions: [instanceProbe(), fetchWorkItem()] }));
    const after = await session.call("fetch_work_item", { reference: "acme/app#12" });

    expect(after.isError, after.text).toBe(false);
    expect(after.data).toMatchObject({ reference: "acme/app#12" });
  });
});
