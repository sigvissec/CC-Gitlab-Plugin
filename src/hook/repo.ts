// Which project on the configured Instance a git repo belongs to: its origin remote's, if that's
// on the Instance, otherwise the one project the repo's other remotes on the Instance point to.
import { spawnSync } from "node:child_process";
import type { Config } from "../server/config.js";

/** The repo's remotes, by name, with their fetch URLs; none outside a git repo. */
function remotesOf(cwd: string): Map<string, string> {
  const result = spawnSync("git", ["-C", cwd, "remote", "-v"], { encoding: "utf8" });
  const remotes = new Map<string, string>();
  if (result.status !== 0) return remotes;
  for (const line of result.stdout.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match) remotes.set(match[1]!, match[2]!);
  }
  return remotes;
}

/** The project a remote URL points to on the Instance (HTTPS, ssh://, or scp-like git@host:path). */
export function projectOnInstance(remote: string, config: Config): string | undefined {
  const subPath = new URL(config.baseUrl).pathname.replace(/\/+$/, "");
  let host: string;
  let path: string;
  const scpLike = remote.includes("://") ? null : /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
  if (scpLike) {
    host = scpLike[1]!;
    path = `/${scpLike[2]!.replace(/^\/+/, "")}`;
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return undefined;
    }
    host = url.hostname;
    path = decodeURIComponent(url.pathname);
    // Over HTTP(S) a project on an Instance under a sub-path sits under that sub-path; over SSH it doesn't.
    if (/^https?:$/.test(url.protocol) && subPath && !path.startsWith(`${subPath}/`)) return undefined;
  }
  if (host.toLowerCase() !== config.glabHost.toLowerCase()) return undefined;
  if (subPath && path.startsWith(`${subPath}/`)) path = path.slice(subPath.length);
  const fullPath = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return fullPath.includes("/") ? fullPath : undefined;
}

export function repoProject(cwd: string, config: Config): string | undefined {
  const remotes = remotesOf(cwd);
  const origin = remotes.get("origin");
  const fromOrigin = origin ? projectOnInstance(origin, config) : undefined;
  if (fromOrigin) return fromOrigin;
  const projects = new Set([...remotes.values()].map((url) => projectOnInstance(url, config)).filter((p) => p !== undefined));
  return projects.size === 1 ? [...projects][0] : undefined;
}
