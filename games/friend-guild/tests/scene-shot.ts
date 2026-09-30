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
const members = team.map(s => makeMerc(s)).map(m => ({ stats: m.stats, family: m.family }));
// One successful and one failed run (seeds found by search), each caught mid-fight, at the loot, at the knockout and at the end.
const find = (success: boolean) => { for (let seed = 1; ; seed++) { const r = runExpedition(createRng(seed), zone, members, 1, 1); if (r.success === success && r.encounters.some(e => !e.won) === !success) return r; } };
const c = document.createElement("canvas"); c.width = 960; c.height = 300; const ctx = c.getContext("2d")!;
window.shots = [];
for (const [name, result] of [["win", find(true)], ["loss", find(false)]] as const)
  for (const f of [0.12, 0.155, 0.19, 0.225, 0.8, 0.9, 0.93, 0.945, 0.96, 1]) {
    for (const reduced of f === 0.155 ? [false, true] : [false]) {
      drawScene(ctx, result, team, result.duration * f, reduced);
      window.shots.push(`scene-${name}-${f}${reduced ? "-reduced" : ""}|` + c.toDataURL());
    }
  }
