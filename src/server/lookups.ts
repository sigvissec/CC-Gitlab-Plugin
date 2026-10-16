// Turns the names people use (label titles, usernames, milestone titles, type names) into
// the global IDs GitLab's mutations need.
import type { Gateway } from "./gateway.js";
import { refused } from "./references.js";

const LABEL = /* GraphQL */ `
query LookupLabel($fullPath: ID!, $title: String!) {
  project(fullPath: $fullPath) { labels(title: $title, includeAncestorGroups: true) { nodes { id title } } }
}`;

const USERS = /* GraphQL */ `
query LookupUsers($usernames: [String!]) {
  users(usernames: $usernames) { nodes { id username } }
}`;

const MILESTONE = /* GraphQL */ `
query LookupMilestone($fullPath: ID!, $title: String!) {
  project(fullPath: $fullPath) { milestones(title: $title, includeAncestors: true) { nodes { id title } } }
}`;

const TYPES = /* GraphQL */ `
query LookupWorkItemTypes($fullPath: ID!) {
  namespace(fullPath: $fullPath) { workItemTypes { nodes { id name widgetDefinitions { type } } } }
}`;

interface TypeInfo {
  id: string;
  /** The widgets this type has in this namespace, which depends on the tier. */
  widgets: Set<string>;
}

export class Lookups {
  private readonly types = new Map<string, Promise<Map<string, TypeInfo>>>();

  constructor(private readonly gateway: Gateway) {}

  async labelId(fullPath: string, title: string): Promise<string> {
    const data = await this.gateway.graphql("LookupLabel", LABEL, { fullPath, title });
    const match = (data?.project?.labels?.nodes ?? []).find((l: any) => l.title === title);
    if (!match) throw refused(`There's no label "${title}" in ${fullPath} or its groups.`);
    return match.id;
  }

  async userIds(usernames: string[]): Promise<string[]> {
    if (usernames.length === 0) return [];
    const data = await this.gateway.graphql("LookupUsers", USERS, { usernames });
    const byName = new Map<string, string>((data?.users?.nodes ?? []).map((u: any) => [u.username, u.id]));
    const missing = usernames.filter((u) => !byName.has(u));
    if (missing.length) throw refused(`No GitLab user ${missing.map((u) => `"${u}"`).join(", ")} on this Instance.`);
    return usernames.map((u) => byName.get(u)!);
  }

  async milestoneId(fullPath: string, title: string): Promise<string> {
    const data = await this.gateway.graphql("LookupMilestone", MILESTONE, { fullPath, title });
    const match = (data?.project?.milestones?.nodes ?? []).find((m: any) => m.title === title);
    if (!match) throw refused(`There's no milestone "${title}" in ${fullPath} or its groups.`);
    return match.id;
  }

  private async type(fullPath: string, name: string): Promise<TypeInfo> {
    let types = this.types.get(fullPath);
    if (!types) {
      types = this.gateway.graphql("LookupWorkItemTypes", TYPES, { fullPath }).then(
        (data: any) =>
          new Map<string, TypeInfo>(
            (data?.namespace?.workItemTypes?.nodes ?? []).map((t: any) => [
              t.name,
              { id: t.id, widgets: new Set<string>((t.widgetDefinitions ?? []).map((w: any) => w.type)) },
            ]),
          ),
      );
      this.types.set(fullPath, types);
    }
    const type = (await types).get(name);
    if (!type) throw refused(`${fullPath} doesn't offer the ${name} Work Item Type.`);
    return type;
  }

  /** A Work Item Type's ID in a namespace, matched by name and cached; never hard-coded. */
  async typeId(fullPath: string, name: string): Promise<string> {
    return (await this.type(fullPath, name)).id;
  }

  /** Whether a Work Item Type has a widget (such as WEIGHT) on this namespace's tier. */
  async typeOffers(fullPath: string, name: string, widget: string): Promise<boolean> {
    return (await this.type(fullPath, name)).widgets.has(widget);
  }
}
