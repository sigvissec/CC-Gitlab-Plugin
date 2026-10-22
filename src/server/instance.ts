// What the configured Instance is: GitLab version, edition, and who the token signs in as.
import { GitLabError, type Gateway } from "./gateway.js";
import { onceItWorks } from "./once.js";
import { gitlabSupported, gitlabTooOld, glabSupported, glabTooOld } from "./versions.js";

export interface InstanceInfo {
  version: string;
  enterprise: boolean;
  username: string;
  meetsMinimumVersion: boolean;
}

const PROBE = /* GraphQL */ `
  query InstanceProbe {
    metadata { version enterprise }
    currentUser { username }
  }
`;

export class Instance {
  constructor(private readonly gateway: Gateway) {}

  /** Probes the Instance once per session, or again after a probe that failed. */
  readonly probe = onceItWorks(async (): Promise<InstanceInfo> => {
    const data = await this.gateway.graphql("InstanceProbe", PROBE);
    if (!data?.metadata?.version) {
      throw new GitLabError("GitLab didn't report its version; the token may be missing or invalid.", "not-set-up");
    }
    if (!data.currentUser?.username) {
      throw new GitLabError("The token isn't signed in as any user; it may be expired or revoked.", "not-set-up");
    }
    return {
      version: data.metadata.version,
      enterprise: Boolean(data.metadata.enterprise),
      username: data.currentUser.username,
      meetsMinimumVersion: gitlabSupported(data.metadata.version),
    };
  });

  private readonly requireGlab = onceItWorks(async () => {
    const version = await this.gateway.glabVersion();
    if (!glabSupported(version)) throw new GitLabError(glabTooOld(version), "not-set-up");
  });

  /** Throws unless glab and the Instance are new enough; every tool but `status` calls this first. */
  async requireSupported(): Promise<InstanceInfo> {
    await this.requireGlab();
    const info = await this.probe();
    if (!info.meetsMinimumVersion) throw new GitLabError(gitlabTooOld(info.version), "not-set-up");
    return info;
  }
}
