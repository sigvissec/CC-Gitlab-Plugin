import type { Config } from "../config.js";
import type { ListEntry, Lists } from "../lists.js";
import type { Reader } from "../reader.js";
import { answer } from "../result.js";
import { fetchWorkItem } from "./fetch.js";
import { listAnswer, resolveFilters, type ToolFilters } from "./list.js";

/** Asks the user to pick one of the entries: its Reference, undefined if they pick none, or "unsupported". */
export type Pick = (entries: ListEntry[]) => Promise<string | undefined | "unsupported">;

/** Lists Work Items, lets the user pick one, and answers with the picked one in full. */
export async function pickWorkItem(
  config: Config,
  reader: Reader,
  lists: Lists,
  pick: Pick,
  { fullPath, limit, ...filters }: ToolFilters & { fullPath: string; limit?: number },
) {
  const result = await lists.within(fullPath, await resolveFilters(config, reader, filters), limit);
  if (result.items.length === 0) return answer(`No Work Items in ${fullPath} match, so there's nothing to pick from.`, { picked: null });
  const picked = await pick(result.items);
  if (picked === "unsupported") {
    return listAnswer(`This client can't show a pick-list, so ask the user which of these Work Items in ${fullPath} to open, then Fetch it`, result);
  }
  if (!picked || !result.items.some((item) => item.reference === picked)) {
    return answer("The user didn't pick a Work Item.", { picked: null });
  }
  return fetchWorkItem(config, reader, picked);
}
