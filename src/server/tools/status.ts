import type { Config } from "../config.js";
import { GitLabError } from "../gateway.js";
import type { GitLab } from "../gitlab.js";
import { MINIMUM_GITLAB, gitlabTooOld, glabSupported, glabTooOld } from "../versions.js";
import type { Lists } from "../lists.js";
import type { Lookups } from "../lookups.js";
import type { Reader } from "../reader.js";
import { SUPPORTED_TYPES, parseReference } from "../references.js";
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

/** What the read-only probes run through: the same code the other tools use. */
interface ProbeDeps {
  lookups: Lookups;
  lists: Lists;
  reader: Reader;
}

/** Read-only checks that the plugin's queries work on this Instance, in one project. */
async function probes(config: Config, project: string, deps: ProbeDeps): Promise<Probe[]> {
  const results: Probe[] = [];
  results.push(
    await probe("Work Item Types", async () => {
      for (const type of SUPPORTED_TYPES) await deps.lookups.typeId(project, type);
      return `${SUPPORTED_TYPES.join(" and ")} available`;
    }),
  );
  let first: string | undefined;
  results.push(
    await probe("List query", async () => {
      const entry = (await deps.lists.within(project, { types: ["Issue"] }, 1)).items[0];
      first = entry?.reference;
      return entry ? `${entry.reference} ${entry.url}` : "no open Issues to list";
    }),
  );
  if (first) {
    const reference = first;
    results.push(
      await probe("Fetch with merge requests", async () => {
        const item = await deps.reader.fetch(parseReference(reference, config));
        const count = item.mergeRequests.all.length;
        return `${item.reference} ${item.url}: ${count} associated merge request${count === 1 ? "" : "s"}`;
      }),
    );
  }
  return results;
}

/** What the read-only probes found, or why they didn't run. */
function probeLines(project: string | undefined, checks: Probe[] | undefined): string[] {
  if (checks) return [`Read-only probes in ${project}:`, ...checks.map((c) => `  ${c.ok ? "ok" : "FAILED"} ${c.probe}: ${c.detail}`)];
  if (!project) return ["Read-only probes: not run. Name a project to run them in, for example /gitlab-work-items:status acme/app."];
  return [`Read-only probes in ${project}: not run, because this GitLab is older than the plugin supports.`];
}

export async function status({ config, gateway, instance }: GitLab, deps: ProbeDeps, project?: string) {
  const glabVersion = await gateway.glabVersion();
  const glabOk = glabSupported(glabVersion);
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
    glabOk ? `glab: ${glabVersion}` : `glab: ${glabVersion}, too old. ${glabTooOld(glabVersion)}`,
    info.meetsMinimumVersion ? `Minimum GitLab ${MINIMUM_GITLAB}: met` : `Minimum GitLab ${MINIMUM_GITLAB}: NOT met. ${gitlabTooOld(info.version)}`,
    ...probeLines(project, checks),
  ];
  return answer(lines.join("\n"), data);
}
