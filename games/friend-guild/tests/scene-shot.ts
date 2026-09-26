import { decodeGenerationSprites } from "../../../src/generation-sprites";
import { sampleFriendSprites } from "../../../examples/fishing/sample-sprites";
import { drawScene } from "../engine/scene";
import { runExpedition, makeMerc, favoredFor, type Zone } from "../engine/guild";
import { createRng } from "../engine/rng";
declare global { interface Window { shots: string[] } }
const a = sampleFriendSprites(7730n)!, b = sampleFriendSprites(3412n)!;
const fake = (id: number, fam: number) => decodeGenerationSprites(BigInt(id), fam, id, (id % 2 ? a : b).frames);
const zone: Zone = { family: 7, tier: 2, favored: favoredFor(7), req: 64, foes: [fake(101, 7), fake(102, 7)] };
const team = [fake(7730, 5), fake(11, 3), fake(12, 4)];
const result = runExpedition(createRng(5), zone, team.map(s => makeMerc(s)).map(m => ({ stats: m.stats, family: m.family })), 1, 1);
const c = document.createElement("canvas"); c.width = 960; c.height = 300; const ctx = c.getContext("2d")!;
window.shots = [];
for (const f of [0.2, 0.24, 0.9, 1]) { drawScene(ctx, result, team, result.duration * f, false); window.shots.push(`scene-${f}|` + c.toDataURL()); }
