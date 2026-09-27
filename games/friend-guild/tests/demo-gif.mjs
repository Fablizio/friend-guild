// Records the README demo GIF (test fixtures only: mock wallet, mock RPC, sample art).
// Run from the SDK root: CHROME_PATH=... node games/friend-guild/tests/demo-gif.mjs
// Needs ffmpeg on PATH. Output: games/friend-guild/media/demo.gif
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { buildGame, createGameServer } from "../../../scripts/dev-game.mjs";
import { installFixture } from "../../../scripts/browser-fixture.mjs";
import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST } from "../../../dist/generation-sprites.js";

const MULTICALL = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const source = await readFile(new URL("../../../examples/fishing/sample-sprites.ts", import.meta.url), "utf8");
const sample = id => [...source.split(`"${id}": decodeGenerationSprites`)[1].split("]),")[0].matchAll(/0x[0-9a-f]+n/g)].map(([w]) => BigInt(w.slice(0, -1)));
const FRAMES = [sample(7730), sample(3412)];

function registry(data) {
  const { functionName, args } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data });
  let result;
  if (functionName === "familyOf") result = args[0] === 7730n ? 5 : Number(args[0] % 9n);
  else if (functionName === "seedOf") result = Number(args[0] % 4294967296n);
  else if (functionName === "frames") result = FRAMES[args[1] % 2];
  else throw new Error(`Unexpected artwork read ${functionName}`);
  return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName, result });
}
const reads = { multicall: 0, registry: 0 };
function artworkCall(call) {
  const to = call.to.toLowerCase();
  if (to === GENERATION_SPRITE_MANIFEST.registry.toLowerCase()) { reads.registry++; return registry(call.data); }
  if (to === "0xca11bde05977b3631167028862be2a173976ca11") {
    reads.multicall++;
    const { args } = decodeFunctionData({ abi: MULTICALL, data: call.data });
    const out = args[0].map(c => {
      assert.equal(c.target.toLowerCase(), GENERATION_SPRITE_MANIFEST.registry.toLowerCase(), "Only the artwork registry is read");
      return { success: true, returnData: registry(c.callData) };
    });
    return encodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", result: out });
  }
  throw new Error(`Unexpected contract ${call.to}`);
}

const media = resolve("games/friend-guild/media");
await mkdir(media, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "fg-demo-"));
const build = await buildGame(resolve("games/friend-guild"), { outdir: join(temporary, "dist") });
const server = createGameServer(build.outdir);
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const W = 960, H = 700;
try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(temporary, "video"), size: { width: W, height: H } } });
  const created = Date.now();
  const page = await context.newPage();
  await installFixture(page, origin, { artworkCall });
  await page.goto(origin);
  await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  const game = page.frameLocator("iframe");
  await game.getByRole("tab", { name: /^Guild/ }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(3000); // artwork settles before the clip starts
  const box = await page.locator(".rf-game-frame").boundingBox();
  const start = (Date.now() - created) / 1000;
  await page.waitForTimeout(1200);
  await game.getByRole("tab", { name: /^Tavern/ }).click();
  await page.waitForTimeout(900);
  await game.getByRole("button", { name: /^Hire · / }).first().click();
  await page.waitForTimeout(700);
  await game.getByRole("button", { name: /^Hire · / }).first().click();
  await page.waitForTimeout(900);
  await game.getByRole("tab", { name: /^Expedition/ }).click();
  await page.waitForTimeout(900);
  await game.getByRole("button", { name: "Launch expedition" }).click();
  await page.waitForTimeout(3600);
  await game.getByRole("button", { name: "Skip" }).click();
  await page.waitForTimeout(1100);
  await game.getByRole("tab", { name: /^Economy/ }).click();
  await game.locator(".fg-summary").getByText(/^Baseline: /).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1300);
  await game.getByRole("button", { name: "Bot attack" }).click();
  await game.locator(".fg-summary").getByText(/^Bot attack: /).waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await game.locator(".fg-main").evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  await page.waitForTimeout(2300);
  const end = (Date.now() - created) / 1000;
  await context.close();
  const [file] = await readdir(join(temporary, "video"));
  const video = join(temporary, "video", file), gif = join(media, "demo.gif");
  const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)}`;
  const filters = `${crop},fps=11,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-v", "error", "-ss", start.toFixed(2), "-to", end.toFixed(2), "-i", video, "-filter_complex", filters, "-loop", "0", gif]);
  console.log(`demo.gif ${(end - start).toFixed(1)} s, ${((await stat(gif)).size / 1e6).toFixed(2)} MB`);
} finally { await browser.close(); server.closeAllConnections(); server.close(); await build.close(); await rm(temporary, { recursive: true, force: true }); }
