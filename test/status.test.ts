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
      { probe: "List query", ok: true, detail: "acme/app#12" },
      { probe: "Fetch with merge requests", ok: true, detail: "acme/app#12: 1 associated merge request" },
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
});
