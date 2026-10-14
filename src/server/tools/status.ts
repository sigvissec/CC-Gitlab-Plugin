import type { Config } from "../config.js";
import { MINIMUM_GLAB, glabMeetsMinimum, type Gateway } from "../gateway.js";
import { MINIMUM_GITLAB_TEXT, type Instance } from "../instance.js";
import { answer } from "../result.js";

export async function status(config: Config, gateway: Gateway, instance: Instance) {
  const glabVersion = await gateway.glabVersion();
  const glabOk = glabMeetsMinimum(glabVersion);
  const tokenSource = await gateway.source();
  const info = await instance.probe();
  const data = {
    instance: config.baseUrl,
    gitlabVersion: info.version,
    edition: info.enterprise ? "EE" : "CE",
    user: info.username,
    tokenSource,
    glabVersion,
    glabMeetsMinimum: glabOk,
    meetsMinimumVersion: info.meetsMinimumVersion,
  };
  const lines = [
    `Instance: ${config.baseUrl}`,
    `GitLab: ${info.version} (${data.edition})`,
    `Signed in as: ${info.username}`,
    `Token from: ${tokenSource}`,
    glabOk ? `glab: ${glabVersion}` : `glab: ${glabVersion}, too old. The plugin needs glab ${MINIMUM_GLAB} or later.`,
    info.meetsMinimumVersion
      ? `Minimum GitLab ${MINIMUM_GITLAB_TEXT}: met`
      : `Minimum GitLab ${MINIMUM_GITLAB_TEXT}: NOT met. This Instance runs ${info.version}; the plugin needs GitLab ${MINIMUM_GITLAB_TEXT} or later.`,
  ];
  return answer(lines.join("\n"), data);
}
