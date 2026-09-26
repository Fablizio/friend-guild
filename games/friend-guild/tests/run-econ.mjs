import { build } from "esbuild";
const out = "games/friend-guild/.artifacts/econ.test.mjs";
await build({ entryPoints: ["games/friend-guild/tests/econ.test.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
await import(`../../../${out}`);
