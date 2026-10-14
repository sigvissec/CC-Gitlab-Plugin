// What the configured Instance is: GitLab version, edition, and who the token signs in as.
import type { Gateway } from "./gateway.js";
import { GitLabError } from "./gateway.js";

export const MINIMUM_GITLAB = [18, 1] as const;
export const MINIMUM_GITLAB_TEXT = "18.1";

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

export function meetsMinimum(version: string): boolean {
  const [major = 0, minor = 0] = version.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  return major > MINIMUM_GITLAB[0] || (major === MINIMUM_GITLAB[0] && minor >= MINIMUM_GITLAB[1]);
}

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
        meetsMinimumVersion: meetsMinimum(data.metadata.version),
      };
    });
    return this.info;
  }

  /** Throws unless the Instance is new enough; every tool but `status` calls this first. */
  async requireSupported(): Promise<InstanceInfo> {
    const info = await this.probe();
    if (!info.meetsMinimumVersion) {
      throw new GitLabError(
        `This Instance runs GitLab ${info.version}; the plugin needs GitLab ${MINIMUM_GITLAB_TEXT} or later.`,
        "not-set-up",
      );
    }
    return info;
  }
}
