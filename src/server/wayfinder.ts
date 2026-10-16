// Wayfinder's tickets on GitLab: issues labelled wayfinder:<type>, each naming its map, an issue
// labelled wayfinder:map, with "Part of #<map>" at the top of its description. A wayfinder
// session claims a ticket by assigning it to the dev driving the map.
import type { Config } from "./config.js";
import type { Gateway } from "./gateway.js";
import type { Instance } from "./instance.js";
import { widgetOf } from "./nodes.js";
import { notFound } from "./references.js";

export const TICKET_LABELS = ["wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];
const MAP_LABEL = "wayfinder:map";
const SHOWN = 20;

export interface ClaimedTicket {
  reference: string;
  title: string;
  /** The wayfinder type: research, prototype, grilling, or task. */
  type: string;
  url: string;
  /** The map the ticket says it's part of; its title when the map is in the same project. */
  map: { reference: string; title?: string } | null;
}

export interface ClaimedTickets {
  tickets: ClaimedTicket[];
  /** How many more claimed tickets there are beyond those shown. */
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
    maps: workItems(labelName: $mapLabels, first: 100) { nodes { reference(full: true) title } }
  }
}`;

/** The map a ticket's description names in its "Part of" line, as a full Reference. */
function mapReference(description: string, fullPath: string): string | undefined {
  const match = /^\s*Part of\s+((?:[\w.-]+\/)*[\w.-]+)?#(\d+)\b/m.exec(description);
  return match ? `${match[1] ?? fullPath}#${match[2]}` : undefined;
}

export class Wayfinder {
  constructor(
    private readonly config: Config,
    private readonly gateway: Gateway,
    private readonly instance: Instance,
  ) {}

  /** The open wayfinder tickets the signed-in user has claimed in a project, most recently updated first. */
  async claimedTickets(fullPath: string): Promise<ClaimedTickets> {
    const { username } = await this.instance.requireSupported();
    const data = await this.gateway.graphql("ClaimedWayfinderTickets", CLAIMED, {
      fullPath,
      assignees: [username],
      ticketLabels: TICKET_LABELS,
      mapLabels: [MAP_LABEL],
    });
    const namespace = data?.namespace;
    if (!namespace?.tickets) throw notFound(fullPath, this.config);
    const mapTitles = new Map<string, string>((namespace.maps?.nodes ?? []).map((m: any) => [m.reference, m.title]));
    const tickets: ClaimedTicket[] = (namespace.tickets.nodes ?? []).map((node: any) => {
      const labels: string[] = (widgetOf(node, "LABELS")?.labels?.nodes ?? []).map((l: any) => l.title);
      const map = mapReference(widgetOf(node, "DESCRIPTION")?.description ?? "", fullPath);
      return {
        reference: node.reference,
        title: node.title,
        type: (labels.find((l) => TICKET_LABELS.includes(l)) ?? "wayfinder:task").slice("wayfinder:".length),
        url: node.webUrl,
        map: map ? { reference: map, ...(mapTitles.has(map) ? { title: mapTitles.get(map) } : {}) } : null,
      };
    });
    return { tickets, more: Math.max(0, (namespace.tickets.count ?? tickets.length) - tickets.length) };
  }
}
