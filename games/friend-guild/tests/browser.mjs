// Automated browser check for Friend Guild (test fixtures only: mock wallet, mock RPC, sample art).
// Run from the SDK root: node games/friend-guild/tests/browser.mjs [outdir]
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

const outdir = resolve(process.argv[2] ?? "games/friend-guild/.artifacts");
await mkdir(outdir, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "bor-test-"));
const build = await buildGame(resolve("games/friend-guild"), { outdir: join(temporary, "dist") });
const server = createGameServer(build.outdir);
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const failures = [];
try {
  for (const view of [{ name: "desktop", width: 960, height: 800, touch: false }, { name: "phone-landscape", width: 844, height: 390, touch: true }, { name: "phone-portrait", width: 390, height: 844, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, hasTouch: view.touch, isMobile: view.touch });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    const fixture = await installFixture(page, origin, { artworkCall });
    await page.goto(origin);
    await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    const game = page.frameLocator("iframe");
    const shot = name => page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-${name}.png`) });
    await game.getByRole("tab", { name: /^Guild/ }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(3500);
    await shot("guild");
    await game.getByRole("button", { name: "Help" }).click();
    await game.getByText(/A diagram there shows where every RF goes/).waitFor();
    await shot("help");
    await game.getByRole("button", { name: "Close How Friend Guild works" }).click();
    await game.getByRole("tab", { name: /^Tavern/ }).click();
    await game.getByRole("button", { name: /^Hire · / }).first().click();
    await game.getByRole("button", { name: /^Hire · / }).first().click();
    await shot("tavern");
    await game.getByRole("tab", { name: /^Expedition/ }).click();
    await game.getByRole("button", { name: "Launch expedition" }).click();
    await page.waitForTimeout(4200);
    await shot("expedition");
    await game.getByRole("button", { name: "Skip" }).click();
    await game.getByRole("button", { name: "Back to zones" }).waitFor();
    await shot("result");
    await game.getByRole("tab", { name: /^Workshop/ }).click();
    await shot("workshop");
    await game.getByRole("tab", { name: /^Economy/ }).click();
    await game.getByText("RF minted by the game").waitFor({ timeout: 15000 });
    assert.ok(await game.locator(".fg-flow").getByText("20% → burned").isVisible(), "RF flow diagram in the Economy tab");
    await shot("economy");
    await game.locator(".fg-summary").getByText(/^Baseline: 1,000 players/).waitFor({ timeout: 15000 });
    await game.getByRole("button", { name: "Bot attack" }).click();
    await game.locator(".fg-summary").getByText(/^Bot attack: \d+ bots made/).waitFor({ timeout: 20000 });
    assert.equal(await game.getByRole("button", { name: "Bot attack" }).getAttribute("aria-pressed"), "true");
    await game.locator(".fg-charts").scrollIntoViewIfNeeded();
    await shot("economy-charts");
    await game.locator(".fg-summary").scrollIntoViewIfNeeded();
    await shot("economy-bots");
    await game.getByRole("button", { name: "Hype" }).click();
    await game.locator(".fg-summary").getByText(/^Hype: players/).waitFor({ timeout: 20000 });
    assert.deepEqual([...new Set([...errors, ...fixture.errors])], [], `${view.name}: browser errors`);
    await context.close();
  }
  console.log("reads", reads);
} catch (e) { failures.push(e); console.error(e); }
finally { await browser.close(); server.closeAllConnections(); server.close(); await build.close(); await rm(temporary, { recursive: true, force: true }); }
if (failures.length) process.exit(1);
console.log("ok, screenshots in", outdir);
