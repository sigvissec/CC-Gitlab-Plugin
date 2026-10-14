import type { Config } from "../config.js";
import { GitLabError, type Gateway } from "../gateway.js";
import type { Instance } from "../instance.js";
import { MINIMUM_GITLAB, MINIMUM_GLAB, atLeast } from "../versions.js";
import type { Lists } from "../lists.js";
import type { Lookups } from "../lookups.js";
import type { Reader } from "../reader.js";
import { parseReference } from "../references.js";
import { answer } from "../result.js";

export interface Probe {
  probe: string;
  ok: boolean;
  detail: string;
}

async function probe(name: string, run: () => Promise<string>): Promise<Probe> {
  try {
    return { probe: name, ok: true, detail: await run() };
  } catch (error) {
    if (error instanceof GitLabError) return { probe: name, ok: false, detail: error.message };
    throw error;
  }
}

/** Read-only checks that the plugin's queries work on this Instance, in one project. */
async function probes(config: Config, project: string, deps: { lookups: Lookups; lists: Lists; reader: Reader }): Promise<Probe[]> {
  const results: Probe[] = [];
  results.push(
    await probe("Work Item Types", async () => {
      await deps.lookups.typeId(project, "Issue");
      await deps.lookups.typeId(project, "Task");
      return "Issue and Task available";
    }),
  );
  let first: string | undefined;
  results.push(
    await probe("List query", async () => {
      const list = await deps.lists.within(project, { types: ["Issue"] }, 1);
      first = list.items[0]?.reference;
      return first ?? "no open Issues to list";
    }),
  );
  if (first) {
    const reference = first;
    results.push(
      await probe("Fetch with merge requests", async () => {
        const item = await deps.reader.fetch(parseReference(reference, config));
        const count = item.mergeRequests.all.length;
        return `${item.reference}: ${count} associated merge request${count === 1 ? "" : "s"}`;
      }),
    );
  }
  return results;
}

export async function status(
  config: Config,
  gateway: Gateway,
  instance: Instance,
  deps: { lookups: Lookups; lists: Lists; reader: Reader },
  project?: string,
) {
  const glabVersion = await gateway.glabVersion();
  const glabOk = atLeast(glabVersion, MINIMUM_GLAB);
  const tokenSource = await gateway.source();
  const info = await instance.probe();
  const checks = project && info.meetsMinimumVersion ? await probes(config, project, deps) : undefined;
  const data = {
    instance: config.baseUrl,
    gitlabVersion: info.version,
    edition: info.enterprise ? "EE" : "CE",
    user: info.username,
    tokenSource,
    glabVersion,
    glabMeetsMinimum: glabOk,
    meetsMinimumVersion: info.meetsMinimumVersion,
    ...(checks ? { probes: checks } : {}),
  };
  const lines = [
    `Instance: ${config.baseUrl}`,
    `GitLab: ${info.version} (${data.edition})`,
    `Signed in as: ${info.username}`,
    `Token from: ${tokenSource}`,
    glabOk ? `glab: ${glabVersion}` : `glab: ${glabVersion}, too old. The plugin needs glab ${MINIMUM_GLAB} or later.`,
    info.meetsMinimumVersion
      ? `Minimum GitLab ${MINIMUM_GITLAB}: met`
      : `Minimum GitLab ${MINIMUM_GITLAB}: NOT met. This Instance runs ${info.version}; the plugin needs GitLab ${MINIMUM_GITLAB} or later.`,
    ...(checks ? [`Read-only probes in ${project}:`, ...checks.map((c) => `  ${c.ok ? "ok" : "FAILED"} ${c.probe}: ${c.detail}`)] : []),
  ];
  return answer(lines.join("\n"), data);
}
