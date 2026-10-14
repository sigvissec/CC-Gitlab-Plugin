// What the configured Instance is: GitLab version, edition, and who the token signs in as.
import { GitLabError, type Gateway } from "./gateway.js";
import { MINIMUM_GITLAB, MINIMUM_GLAB, atLeast } from "./versions.js";

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
  private info: Promise<InstanceInfo> | undefined;

  constructor(private readonly gateway: Gateway) {}

  /** Probes the Instance once per session. */
  probe(): Promise<InstanceInfo> {
    this.info ??= this.gateway.graphql("InstanceProbe", PROBE).then((data: any) => {
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
        meetsMinimumVersion: atLeast(data.metadata.version, MINIMUM_GITLAB),
      };
    });
    return this.info;
  }

  private glabChecked: Promise<void> | undefined;

  /** Throws unless glab and the Instance are new enough; every tool but `status` calls this first. */
  async requireSupported(): Promise<InstanceInfo> {
    this.glabChecked ??= this.gateway.glabVersion().then((version) => {
      if (!atLeast(version, MINIMUM_GLAB)) {
        throw new GitLabError(`glab ${version} is installed; the plugin needs glab ${MINIMUM_GLAB} or later.`, "not-set-up");
      }
    });
    await this.glabChecked;
    const info = await this.probe();
    if (!info.meetsMinimumVersion) {
      throw new GitLabError(
        `This Instance runs GitLab ${info.version}; the plugin needs GitLab ${MINIMUM_GITLAB} or later.`,
        "not-set-up",
      );
    }
    return info;
  }
}
