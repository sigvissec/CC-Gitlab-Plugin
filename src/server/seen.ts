// What Claude has been shown of each Work Item, so a Write can tell when GitLab changed under it.
import type { Thread, WorkItem } from "./reader.js";

export class Seen {
  /** When each Work Item was last updated, as of the version Claude was last shown. */
  private readonly versions = new Map<string, string>();
  /** How many Comments each Thread had in the version Claude was last shown. */
  private readonly commentCounts = new Map<string, number>();

  /** Records the version of a Work Item that Claude has now been shown. */
  remember(item: WorkItem): void {
    this.versions.set(item.id, item.updatedAt);
    for (const thread of item.threads) this.commentCounts.set(thread.id, thread.commentCount);
  }

  /** How many Comments a Thread had in the version Claude was last shown; its count now if never shown. */
  comments(thread: Thread): number {
    return this.commentCounts.get(thread.id) ?? thread.commentCount;
  }

  /**
   * Whether a Work Item changed since the version Claude was last shown. A changed one counts as
   * shown from here on, so callers must show its new state.
   */
  changed(item: WorkItem): boolean {
    const seen = this.versions.get(item.id);
    const changed = seen !== undefined && seen !== item.updatedAt;
    if (changed) this.remember(item);
    return changed;
  }
}
