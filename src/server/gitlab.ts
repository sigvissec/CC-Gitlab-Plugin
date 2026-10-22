// The configured Instance and the way to reach it, which everything that talks to GitLab shares.
import type { Config } from "./config.js";
import { Gateway } from "./gateway.js";
import { Instance } from "./instance.js";

export interface GitLab {
  config: Config;
  gateway: Gateway;
  instance: Instance;
}

export function connect(config: Config): GitLab {
  const gateway = new Gateway(config);
  return { config, gateway, instance: new Instance(gateway) };
}
