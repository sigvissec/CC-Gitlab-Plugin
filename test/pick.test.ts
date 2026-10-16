import { afterEach, describe, expect, it } from "vitest";
import { start, type Session, type StartOptions } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn, type Interaction } from "./support/cassette.js";
import { LIST_DEFAULTS, fetchWorkItem, listPage } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function withGitLab(interactions: Interaction[], options: Partial<StartOptions> = {}) {
  session = await start({ ...options, cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe({ username: "alice" }), ...interactions] }) });
  return session;
}

const WAYFINDER = ["wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];
const claimedList = (entries: { reference: string; title: string }[]) =>
  listPage({ fullPath: "acme/app", ...LIST_DEFAULTS, assigneeUsernames: ["alice"], or: { labelNames: WAYFINDER } }, entries);
const pickArgs = { fullPath: "acme/app", anyLabels: WAYFINDER, assignedToMe: true };

describe("picking a Work Item", () => {
  it("offers the list as a pick-list dialog and answers with the picked Work Item in full", async () => {
    const s = await withGitLab(
      [
        claimedList([
          { reference: "acme/app#7", title: "Pick a cache" },
          { reference: "acme/app#12", title: "Login times out" },
        ]),
        fetchWorkItem({ iid: "12", title: "Login times out", description: "Steps to reproduce: sign in twice." }),
      ],
      { elicit: () => ({ action: "accept", content: { workItem: "acme/app#12" } }) },
    );

    const result = await s.call("pick_work_item", pickArgs);

    const [dialog] = s.elicitations;
    expect(dialog!.requestedSchema.properties.workItem.oneOf).toEqual([
      { const: "acme/app#7", title: "acme/app#7 Pick a cache" },
      { const: "acme/app#12", title: "acme/app#12 Login times out" },
    ]);
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^acme\/app#12: Login times out/);
    expect(result.text).toContain("Steps to reproduce: sign in twice.");
  });

  it.each([
    ["declines", { action: "decline" as const }],
    ["cancels", { action: "cancel" as const }],
  ])("opens nothing when the user %s the dialog", async (_, response) => {
    const s = await withGitLab([claimedList([{ reference: "acme/app#7", title: "Pick a cache" }])], { elicit: () => response });

    const result = await s.call("pick_work_item", pickArgs);

    expect(result.text).toBe("The user didn't pick a Work Item.");
    expect(s.glabCalls().some((c) => c.body?.operationName === "FetchWorkItem")).toBe(false);
  });

  it("hands Claude the list to ask the user from, where the client can't show a pick-list", async () => {
    const s = await withGitLab([claimedList([{ reference: "acme/app#7", title: "Pick a cache" }])]);

    const result = await s.call("pick_work_item", pickArgs);

    expect(result.text).toMatch(/can't show a pick-list, so ask the user which/);
    expect(result.text).toContain("acme/app#7 Pick a cache");
    expect(s.glabCalls().some((c) => c.body?.operationName === "FetchWorkItem")).toBe(false);
  });

  it("says there's nothing to pick from, without a dialog, when nothing matches", async () => {
    const s = await withGitLab([claimedList([])], { elicit: () => ({ action: "accept", content: { workItem: "acme/app#7" } }) });

    const result = await s.call("pick_work_item", pickArgs);

    expect(result.text).toMatch(/nothing to pick from/);
    expect(s.elicitations).toEqual([]);
  });
});
