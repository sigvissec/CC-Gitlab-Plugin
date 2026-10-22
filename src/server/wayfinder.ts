// Wayfinder tickets on GitLab: Work Items labelled wayfinder:<type>, each naming its Wayfinder map
// (a Work Item labelled wayfinder:map) on a "Part of #<map>" line at the top of its description.
// A wayfinder session claims a Wayfinder ticket by assigning it to the dev driving the map.
import type { GitLab } from "./gitlab.js";
import { widgetOf } from "./nodes.js";
import { notFound, workItemUrl } from "./references.js";

export const WAYFINDER_TICKET_LABELS = ["wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];
const WAYFINDER_MAP_LABEL = "wayfinder:map";
const SHOWN = 20;

export interface ClaimedWayfinderTicket {
  reference: string;
  title: string;
  /** The wayfinder type: research, prototype, grilling, or task. */
  type: string;
  url: string;
  /** The Wayfinder map it says it's part of; with its title when the map is in the same project. */
  map: { reference: string; url: string; title?: string } | null;
}

export interface ClaimedWayfinderTickets {
  tickets: ClaimedWayfinderTicket[];
  /** How many more claimed Wayfinder tickets there are beyond those shown. */
  more: number;
}

const CLAIMED = /* GraphQL */ `
query ClaimedWayfinderTickets($fullPath: ID!, $assignees: [String!], $ticketLabels: [String!], $mapLabels: [String!]) {
  namespace(fullPath: $fullPath) {
    tickets: workItems(state: opened, types: [ISSUE, TASK], assigneeUsernames: $assignees, or: { labelNames: $ticketLabels }, sort: UPDATED_DESC, first: ${SHOWN}) {
      count
      nodes {
        reference(full: true) title webUrl
        widgets(onlyTypes: [DESCRIPTION, LABELS]) {
          type
          ... on WorkItemWidgetDescription { description }
          ... on WorkItemWidgetLabels { labels { nodes { title } } }
        }
      }
    }
    maps: workItems(labelName: $mapLabels, first: 100) { nodes { reference(full: true) title webUrl } }
  }
}`;

/** The Wayfinder map a Wayfinder ticket's description names on its "Part of" line, as a project path and IID. */
function mapOf(description: string, fullPath: string): { fullPath: string; iid: string } | undefined {
  const match = /^\s*Part of\s+((?:[\w.-]+\/)*[\w.-]+)?#(\d+)\b/m.exec(description);
  return match ? { fullPath: match[1] ?? fullPath, iid: match[2]! } : undefined;
}

export class Wayfinder {
  constructor(private readonly gitlab: GitLab) {}

  /** The open Wayfinder tickets the signed-in user has claimed in a project, most recently updated first. */
  async claimedTickets(fullPath: string): Promise<ClaimedWayfinderTickets> {
    const { username } = await this.gitlab.instance.requireSupported();
    const data = await this.gitlab.gateway.graphql("ClaimedWayfinderTickets", CLAIMED, {
      fullPath,
      assignees: [username],
      ticketLabels: WAYFINDER_TICKET_LABELS,
      mapLabels: [WAYFINDER_MAP_LABEL],
    });
    const namespace = data?.namespace;
    if (!namespace?.tickets) throw notFound(fullPath, this.gitlab.config);
    const maps = new Map<string, { title: string; url: string }>((namespace.maps?.nodes ?? []).map((m: any) => [m.reference, { title: m.title, url: m.webUrl }]));
    const tickets: ClaimedWayfinderTicket[] = (namespace.tickets.nodes ?? []).map((node: any) => {
      const labels: string[] = (widgetOf(node, "LABELS")?.labels?.nodes ?? []).map((l: any) => l.title);
      const map = mapOf(widgetOf(node, "DESCRIPTION")?.description ?? "", fullPath);
      const reference = map && `${map.fullPath}#${map.iid}`;
      // A map in this project comes with GitLab's own title and URL; for one elsewhere, its URL is built.
      const known = reference ? maps.get(reference) : undefined;
      return {
        reference: node.reference,
        title: node.title,
        type: (labels.find((l) => WAYFINDER_TICKET_LABELS.includes(l)) ?? "wayfinder:task").slice("wayfinder:".length),
        url: node.webUrl,
        map: map && reference
          ? { reference, url: known?.url ?? workItemUrl(map, this.gitlab.config), ...(known?.title ? { title: known.title } : {}) }
          : null,
      };
    });
    return { tickets, more: Math.max(0, (namespace.tickets.count ?? tickets.length) - tickets.length) };
  }
}
