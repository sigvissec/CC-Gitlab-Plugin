import { afterEach, describe, expect, it } from "vitest";
import { start, type Session } from "./support/harness.js";
import { cassette, instanceProbe, loggedIn } from "./support/cassette.js";

let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const graphqlCalls = (s: Session) => s.glabCalls().filter((c) => c.args[0] === "api");

describe("token precedence", () => {
  it("uses the plugin's own token first, and passes glab nothing else", async () => {
    session = await start({
      token: "setting-token",
      env: { GITLAB_TOKEN: "users-other-token", OAUTH_TOKEN: "oauth", GITLAB_ACCESS_TOKEN: "access" },
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe()] }),
    });

    const result = await session.call("status");

    expect(result.data.tokenSource).toBe("plugin setting");
    const calls = graphqlCalls(session);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.env).toEqual({ GITLAB_TOKEN: "setting-token" });
  });

  it("passes glab no job token, OAuth switch, CI auto-login or TLS skip, whatever the user's environment has", async () => {
    session = await start({
      token: "setting-token",
      env: {
        JOB_TOKEN: "job",
        CI_JOB_TOKEN: "ci-job",
        GLAB_IS_OAUTH2: "true",
        GLAB_ENABLE_CI_AUTOLOGIN: "true",
        GITLAB_CI: "true",
        GLAB_SKIP_TLS_VERIFY: "true",
        SKIP_TLS_VERIFY: "true",
      },
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe()] }),
    });

    await session.call("status");

    for (const call of graphqlCalls(session)) expect(call.env).toEqual({ GITLAB_TOKEN: "setting-token" });
  });

  it("keeps glab quiet: no update checks, telemetry, or what's-new notes", async () => {
    session = await start({ cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe()] }) });

    await session.call("status");

    for (const call of session.glabCalls()) {
      expect(call.quiet).toEqual({ GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", GLAB_SHOW_WHATS_NEW: "false" });
    }
  });

  it("prefers glab's saved login over GITLAB_TOKEN, and hides GITLAB_TOKEN from glab", async () => {
    session = await start({
      env: { GITLAB_TOKEN: "token-for-another-instance" },
      cassette: cassette({ auth: loggedIn(), interactions: [instanceProbe()] }),
    });

    const result = await session.call("status");

    expect(result.data.tokenSource).toBe("glab login");
    for (const call of session.glabCalls()) expect(call.env).toEqual({});
  });

  it("falls back to GITLAB_TOKEN when there's no setting and no glab login", async () => {
    session = await start({
      env: { GITLAB_TOKEN: "users-token", OAUTH_TOKEN: "oauth" },
      cassette: cassette({ interactions: [instanceProbe()] }),
    });

    const result = await session.call("status");

    expect(result.data.tokenSource).toBe("GITLAB_TOKEN");
    for (const call of graphqlCalls(session)) expect(call.env).toEqual({ GITLAB_TOKEN: "users-token" });
  });

  it("explains both setup paths when there's no token at all, without asking for one in the chat", async () => {
    session = await start({ cassette: cassette({ interactions: [instanceProbe()] }) });

    const result = await session.call("status");

    expect(result.isError).toBe(true);
    expect(result.text).toContain("glab auth login --hostname gitlab.example.com");
    expect(result.text).toContain("plugin's settings");
    expect(result.text).not.toMatch(/paste/i);
  });

  it("explains signing in to a sub-path Instance in the order glab needs: subfolder first", async () => {
    session = await start({ baseUrl: "http://example.com:8080/gitlab", cassette: cassette({ interactions: [instanceProbe()] }) });

    const result = await session.call("status");

    expect(result.text).toContain(
      "`glab config set subfolder gitlab --host example.com`, then `glab auth login --hostname example.com --api-host example.com:8080 --api-protocol http`",
    );
  });

  // An empty variable counts as unset in glab, so a root Instance sends "/" to override any
  // subfolder left in the user's own glab config.
  it.each([
    ["a sub-path", "https://example.com/gitlab/", "example.com", { GITLAB_API_HOST: "example.com", GLAB_API_PROTOCOL: "https", GITLAB_SUBFOLDER: "gitlab" }],
    ["a port over http", "http://localhost:8929", "localhost", { GITLAB_API_HOST: "localhost:8929", GLAB_API_PROTOCOL: "http", GITLAB_SUBFOLDER: "/" }],
    ["the root of gitlab.com", "https://gitlab.com", "gitlab.com", { GITLAB_API_HOST: "gitlab.com", GLAB_API_PROTOCOL: "https", GITLAB_SUBFOLDER: "/" }],
  ])("points glab at exactly the configured Instance on %s", async (_, baseUrl, hostname, endpoint) => {
    session = await start({ baseUrl, cassette: cassette({ auth: loggedIn(hostname), interactions: [instanceProbe()] }) });

    const result = await session.call("status");

    expect(result.data).toMatchObject({ instance: baseUrl.replace(/\/$/, ""), tokenSource: "glab login" });
    const calls = session.glabCalls().filter((c) => c.args[0] !== "version");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.host).toBe(hostname);
      expect(call.endpoint).toEqual(endpoint);
    }
  });
});
