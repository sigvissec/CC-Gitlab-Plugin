// Plugin settings, passed to the server through its environment by the plugin's MCP config.

export interface Config {
  /** The configured Instance's base URL, without a trailing slash. */
  baseUrl: string;
  /** The Instance as glab names it: the bare hostname, for example `example.com`. */
  glabHost: string;
  /**
   * Where glab sends requests for this Instance. Passed to glab on every call, so the
   * configured base URL wins over anything in glab's own configuration. glab ignores an empty
   * variable, so an Instance at the root sends a subfolder of "/", which glab trims to none.
   */
  endpoint: { GITLAB_API_HOST: string; GLAB_API_PROTOCOL: string; GITLAB_SUBFOLDER: string };
  /** A token from the plugin's own settings; empty when not set. */
  settingToken: string;
  footer: boolean;
}

export function readConfig(): Config {
  const env = process.env;
  const raw = (env.GITLAB_WORK_ITEMS_URL || "https://gitlab.com").trim();
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: `${url.protocol}//${url.host}${path}`,
    glabHost: url.hostname,
    endpoint: {
      GITLAB_API_HOST: url.host,
      GLAB_API_PROTOCOL: url.protocol.replace(":", ""),
      GITLAB_SUBFOLDER: path.replace(/^\/+/, "") || "/",
    },
    settingToken: (env.GITLAB_WORK_ITEMS_TOKEN ?? "").trim(),
    footer: (env.GITLAB_WORK_ITEMS_FOOTER ?? "true").trim().toLowerCase() !== "false",
  };
}
