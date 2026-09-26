import { build } from "esbuild";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
const out = "games/friend-guild/.artifacts";
await mkdir(out + "/visual", { recursive: true });
const result = await build({ entryPoints: ["games/friend-guild/tests/scene-shot.ts"], bundle: true, format: "iife", write: false, logLevel: "error" });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
page.on("pageerror", e => console.error("pageerror", e.message));
await page.setContent(`<html><body style="margin:0;background:#000"></body></html>`);
await page.addScriptTag({ content: result.outputFiles[0].text });
const shots = await page.evaluate(() => window.shots);
for (const shot of shots) { const [label, data] = shot.split("|"); await writeFile(`${out}/visual/${label}.png`, Buffer.from(data.split(",")[1], "base64")); console.log(label); }
await browser.close();
