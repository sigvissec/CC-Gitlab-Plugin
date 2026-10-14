// The oldest glab and GitLab the plugin supports, and how a reported version compares.

/** The oldest glab the test suites pass with. */
export const MINIMUM_GLAB = "1.123.0";

/** The oldest GitLab with every part of the Work Items API the plugin uses. */
export const MINIMUM_GITLAB = "18.1";

/** Whether a version such as `18.1.6-ee` or `1.123.0` is at least `minimum`, part by part. */
export function atLeast(version: string, minimum: string): boolean {
  const have = version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (const [i, need] of minimum.split(".").map(Number).entries()) {
    const part = have[i] ?? 0;
    if (part !== need) return part > need;
  }
  return true;
}
