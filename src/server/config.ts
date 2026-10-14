// Plugin settings, passed to the server through its environment by the plugin's MCP config.

export interface Config {
  /** The configured Instance's base URL, without a trailing slash. */
  baseUrl: string;
  /** The Instance as glab names it: host plus any sub-path, for example `example.com/gitlab`. */
  glabHost: string;
  /** A token from the plugin's own settings; empty when not set. */
  settingToken: string;
  footer: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = (env.GITLAB_WORK_ITEMS_URL || "https://gitlab.com").trim();
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: `${url.protocol}//${url.host}${path}`,
    glabHost: `${url.host}${path}`,
    settingToken: (env.GITLAB_WORK_ITEMS_TOKEN ?? "").trim(),
    footer: (env.GITLAB_WORK_ITEMS_FOOTER ?? "true").trim().toLowerCase() !== "false",
  };
}
