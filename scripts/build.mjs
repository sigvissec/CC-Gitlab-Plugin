// Bundles the MCP server and the write-guard hook into single files inside the plugin,
// so installing the plugin downloads nothing.
import { build } from "esbuild";

const pluginDir = new URL("../plugins/gitlab-work-items/", import.meta.url).pathname;

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
};

await build({ ...shared, entryPoints: ["src/server/main.ts"], outfile: `${pluginDir}server/gitlab-work-items.mjs` });
await build({ ...shared, entryPoints: ["src/hook/write-guard.ts"], outfile: `${pluginDir}hooks/write-guard.mjs` });
