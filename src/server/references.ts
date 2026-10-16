// Turns a Reference into the project path and IID it points at, or refuses it.
// Only full References are accepted: Claude resolves short ones (`#12`) against a Context first.
import type { Config } from "./config.js";
import { GitLabError } from "./gateway.js";

export interface WorkItemRef {
  fullPath: string;
  iid: string;
  /** Set when the Reference was a link to a specific Comment. */
  noteId?: string;
}

export const SUPPORTED_TYPES = ["Issue", "Task"] as const;

export function refused(message: string): GitLabError {
  return new GitLabError(message, "refused");
}

/** Something GitLab didn't return. It may not exist or the token may not see it; GitLab doesn't say which. */
export function notFound(what: string, config: Config): GitLabError {
  return new GitLabError(`${what} on ${config.baseUrl}: not found, or your token can't see it.`, "not-found");
}

const EPIC = "Epics aren't supported: the plugin works with Issues and Tasks only.";
const mergeRequest = (reference: string) =>
  `${reference} is a merge request. The plugin shows the merge requests linked to a Work Item, but doesn't work on merge requests themselves.`;

export function fullReference(ref: WorkItemRef): string {
  return `${ref.fullPath}#${ref.iid}`;
}

export function parseReference(input: string, config: Config): WorkItemRef {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return parseUrl(text, config);

  if (/^#\d+$/.test(text)) {
    throw refused(
      `"${text}" is a short Reference. Resolve it against a Context and pass the full reference, for example group/project${text}.`,
    );
  }
  if (/^[\w.\-/]*&\d+$/.test(text)) throw refused(EPIC);
  if (/^[\w.\-/]+!\d+$/.test(text)) throw refused(mergeRequest(text));
  const full = /^([\w.\-]+(?:\/[\w.\-]+)+)#(\d+)$/.exec(text);
  if (full?.[1] && full[2]) return { fullPath: full[1], iid: full[2] };
  throw refused(`"${text}" isn't a Work Item Reference. Use a Work Item URL or a full reference such as group/project#12.`);
}

function parseUrl(text: string, config: Config): WorkItemRef {
  const url = new URL(text);
  const base = new URL(config.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = url.pathname.replace(/\/+$/, "");
  if (url.host !== base.host || (basePath && !(path === basePath || path.startsWith(`${basePath}/`)))) {
    throw refused(
      `${text} points at ${url.origin}, but the plugin is configured for ${config.baseUrl}. It only ever contacts the configured Instance.`,
    );
  }
  const rest = path.slice(basePath.length).replace(/^\/+/, "");
  if (/^groups\/.+\/-\/(epics|work_items)\/\d+$/.test(rest) || /\/-\/epics\/\d+$/.test(rest)) throw refused(EPIC);
  const mr = /^(.+?)\/-\/merge_requests\/(\d+)$/.exec(rest);
  if (mr) throw refused(mergeRequest(`${mr[1]}!${mr[2]}`));
  const item = /^(.+?)\/-\/(?:work_items|issues)\/(\d+)$/.exec(rest);
  if (!item?.[1] || !item[2]) {
    throw refused(`${text} isn't a Work Item URL. Use a link to an Issue or Task, or a full reference such as group/project#12.`);
  }
  const note = /^#note_(\d+)$/.exec(url.hash);
  return { fullPath: item[1], iid: item[2], ...(note?.[1] ? { noteId: note[1] } : {}) };
}
