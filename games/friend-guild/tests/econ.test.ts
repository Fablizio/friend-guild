// Economy model and fee-split checks. Run from the repo root: node games/friend-guild/tests/run-econ.mjs
import assert from "node:assert/strict";
import { simulateEconomy } from "../engine/econ";
import { splitFee, feeOf, baseFeeOf, record, emptyLedger, successChance, favoredFor, type Zone } from "../engine/guild";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok ${passed} - ${name}`); };

test("every fee splits back exactly into owner + burn + season", () => {
  for (let f = 0.1; f < 50; f += 0.7) { const s = splitFee(Math.round(f * 10) / 10); assert.ok(Math.abs(s.owner + s.burn + s.season - Math.round(f * 10) / 10) < 1e-9); }
});
test("the session ledger conserves RF", () => {
  let l = emptyLedger(); l = record(l, 6.4, "hire"); l = record(l, 8, "burn"); l = record(l, 12.3, "hire");
  assert.ok(Math.abs(l.spent - (l.toOwners + l.burned + l.season)) < 1e-9);
});
test("fees rise 5% per recent hire and track rating", () => {
  assert.equal(feeOf(10, 0), 10); assert.equal(feeOf(10, 1), 10.5); assert.ok(baseFeeOf(30) > baseFeeOf(20));
});
test("zones favour two families and success stays within 5%–95%", () => {
  const zone: Zone = { family: 0, tier: 4, favored: favoredFor(0), req: 88, foes: [] };
  assert.deepEqual(favoredFor(0), [3, 5]);
  const weak = successChance(zone, [{ stats: { power: 1, guard: 1, speed: 1, luck: 1 }, family: 0 }], 1);
  const strong = successChance(zone, Array(3).fill({ stats: { power: 12, guard: 12, speed: 12, luck: 12 }, family: 3 }), 5);
  assert.equal(weak, 0.05); assert.equal(strong, 0.95);
});
test("the 30-day model conserves RF and never mints it", () => {
  for (const players of [100, 1000]) {
    const r = simulateEconomy({ players });
    assert.ok(r.conserved);
    assert.ok(Math.abs(r.totals.spent - (r.totals.toOwners + r.totals.burned + r.totals.season)) < 1e-6 * r.totals.spent);
  }
});
test("the model is deterministic for a seed", () => {
  assert.deepEqual(simulateEconomy({ players: 200, seed: 7 }).totals, simulateEconomy({ players: 200, seed: 7 }).totals);
});
test("a higher burn share burns more and pays owners less", () => {
  const low = simulateEconomy({ players: 300, burnPct: 10, ownerPct: 80, seasonPct: 10 });
  const high = simulateEconomy({ players: 300, burnPct: 30, ownerPct: 60, seasonPct: 10 });
  assert.ok(high.totals.burned > low.totals.burned); assert.ok(high.totals.toOwners < low.totals.toOwners);
});
test("demand pricing spreads earnings: top 10% of Friends earn well under half", () => {
  const r = simulateEconomy({ players: 1000 });
  assert.ok(r.days.at(-1)!.top10Share < 0.5);
});
test("shard supply stays bounded (the workshop sink keeps pace)", () => {
  const r = simulateEconomy({ players: 500 });
  const d10 = r.days[9].shardsSupply, d30 = r.days[29].shardsSupply;
  assert.ok(d30 < d10 * 1.25, `supply ${d10} → ${d30}`);
});
console.log(`# pass ${passed}`);
