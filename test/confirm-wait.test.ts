// The confirmation dialog waits for the user, however long they read the preview.
// In a file of its own, because it takes over a minute and the other files run alongside it.
import { afterEach, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn } from "./support/cassette.js";
import { fetchWorkItem, lookupLabel, mutation } from "./support/fixtures.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const ID = "gid://gitlab/WorkItem/1012";
const PAST_A_MINUTE_MS = 61_000;

it("applies when the user takes more than a minute to answer the dialog", async () => {
  const before = fetchWorkItem({ labels: ["bug"] });
  session = await start({
    cassette: cassette({
      auth: loggedIn(),
      interactions: [
        instanceProbe(),
        before, lookupLabel("acme/app", "blocked", 7),
        before, mutation("UpdateWorkItem", { id: ID, labelsWidget: { addLabelIds: ["gid://gitlab/ProjectLabel/7"], removeLabelIds: [] } }, { workItem: { id: ID } }),
        fetchWorkItem({ labels: ["bug", "blocked"], updatedAt: "2026-10-02T08:00:00Z" }),
      ],
    }),
    elicit: () => new Promise((answer) => setTimeout(() => answer({ action: "accept", content: { confirm: true } }), PAST_A_MINUTE_MS)),
  });
  const prepared = await session.call("prepare_writes", { writes: [{ kind: "edit", reference: "acme/app#12", addLabels: ["blocked"] }] });

  const applied = await session.call("apply_writes", { planId: prepared.data.planId });

  expect(applied.isError, applied.text).toBe(false);
  expect(applied.data.results[0]).toMatchObject({ outcome: "done" });
}, 90_000);
