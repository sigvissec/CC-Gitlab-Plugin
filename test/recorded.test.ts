// Replays responses recorded from real GitLab. A changed query fails here until re-recorded.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { start, type Session } from "./support/harness.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const recording = (name: string) => JSON.parse(readFileSync(new URL(`./recordings/${name}.json`, import.meta.url), "utf8"));

describe("recorded from gitlab.com", () => {
  it("builds the digest of a real public Issue", async () => {
    session = await start({ baseUrl: "https://gitlab.com", cassette: recording("gitlab-com-cli-7") });

    const result = await session.call("fetch_work_item", { reference: "https://gitlab.com/gitlab-org/cli/-/issues/7" });

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      reference: "gitlab-org/cli#7",
      url: "https://gitlab.com/gitlab-org/cli/-/work_items/7",
      title: "Ability to list merge requests",
      type: "Issue",
      state: "closed",
      labels: ["enhancement"],
      parent: null,
      threads: { total: 0, unresolved: 0 },
    });
    // A closed draft merge request counts as closed, and closing ones come first among equals.
    expect(result.data.mergeRequests.shown).toEqual([
      expect.objectContaining({ reference: "gitlab-org/cli!3269", state: "merged", relation: "mentions" }),
      expect.objectContaining({ reference: "gitlab-org/cli!1854", state: "closed", relation: "closes" }),
      expect.objectContaining({ reference: "gitlab-org/cli!3183", state: "closed", relation: "mentions" }),
    ]);
  });
});
