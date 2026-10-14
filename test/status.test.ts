import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn } from "./support/cassette.js";

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
});
