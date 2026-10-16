// A cassette is what the fake glab replays: recorded GitLab GraphQL responses, keyed by
// operation name and variables, plus which Instances glab is logged in to.
// Recorded cassettes (from a Test Instance) also carry a query hash, so a changed query
// fails until it's re-recorded.

export interface Interaction {
  operationName: string;
  variables?: Record<string, unknown>;
  queryHash?: string;
  response: { exitCode?: number; body: unknown; stderr?: string };
}

export interface Cassette {
  glabVersion?: string;
  auth?: Record<string, { loggedIn: boolean; tokenSource?: string; user?: string }>;
  interactions: Interaction[];
}

export function cassette(parts: Partial<Cassette> & { interactions?: Interaction[] }): Cassette {
  return { interactions: [], ...parts };
}

/** Responses for the probe every tool runs first: GitLab version, edition, and signed-in user. */
export function instanceProbe(
  options: { version?: string; enterprise?: boolean; username?: string } = {},
): Interaction {
  return {
    operationName: "InstanceProbe",
    response: {
      body: {
        data: {
          metadata: { version: options.version ?? "18.1.6-ee", enterprise: options.enterprise ?? true },
          currentUser: options.username === undefined ? { username: "alice" } : { username: options.username },
        },
      },
    },
  };
}

export const loggedIn = (host = "gitlab.example.com") => ({ [host]: { loggedIn: true } });
