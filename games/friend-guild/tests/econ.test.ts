// Economy model and fee-split checks. Run from the repo root: node games/friend-guild/tests/run-econ.mjs
import assert from "node:assert/strict";
import { DEFAULT_PARAMS, GEN_MIX, SCENARIOS, runEconomy, scenarioParams, simulateEconomy, summarize } from "../engine/econ";
import {
  splitFee, feeOf, baseFeeOf, record, emptyLedger, successChance, favoredFor, tierOf, tierFeeOf, tierLabel, powerMult, type Zone,
} from "../engine/guild";

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
const conserves = (r: ReturnType<typeof simulateEconomy>) =>
  r.conserved && Math.abs(r.totals.spent - (r.totals.toOwners + r.totals.burned + r.totals.season)) < 1e-6 * r.totals.spent;
test("growth and churn keep RF conserved, move the player count and resize the listed pool", () => {
  const grow = simulateEconomy({ players: 400, growthPct: 6, churnPct: 1 });
  const shrink = simulateEconomy({ players: 400, growthPct: 0, churnPct: 4 });
  for (const r of [grow, shrink]) assert.ok(conserves(r));
  assert.ok(grow.totals.playersEnd > 400 * 3, `grew to ${grow.totals.playersEnd}`);
  assert.ok(shrink.totals.playersEnd < 400 * 0.4, `shrank to ${shrink.totals.playersEnd}`);
  const listed = (r: typeof grow, i: number) => r.days[i].listed / r.days[i].players;
  assert.ok(Math.abs(listed(grow, 29) - 0.8) < 0.01 && Math.abs(listed(shrink, 29) - 0.8) < 0.05, "listed pool tracks 80% of players");
  assert.deepEqual(simulateEconomy({ players: 300, growthPct: 5, churnPct: 3, seed: 9 }).totals, simulateEconomy({ players: 300, growthPct: 5, churnPct: 3, seed: 9 }).totals);
});
test("new players start with no Shards and churned players take theirs out of circulation", () => {
  const r = simulateEconomy({ players: 300, growthPct: 0, churnPct: 5 });
  let supply = 0;
  for (const d of r.days) { supply += d.shardsMinted - d.shardsSunk - d.shardsLost; assert.ok(Math.abs(supply - d.shardsSupply) < 1e-6); }
  assert.ok(r.days.slice(1).every(d => d.shardsLost > 0));
  const hype = simulateEconomy({ players: 300, growthPct: 15, churnPct: 0 });
  assert.ok(hype.days[29].shardsPerPlayer < simulateEconomy({ players: 300, growthPct: 0, churnPct: 0 }).days[29].shardsPerPlayer, "fresh players dilute Shards per player");
});
test("every scenario preset runs, conserves RF and explains itself with its numbers", () => {
  for (const s of SCENARIOS) {
    const run = runEconomy(scenarioParams(s.id, 300), s.id);
    assert.ok(conserves(run.result), s.id);
    const line = summarize(run);
    assert.ok(line.startsWith(s.label) && /\d/.test(line) && !line.includes("NaN") && !line.includes("Infinity"), line);
  }
  const bear = runEconomy(scenarioParams("bear", 300), "bear").result, hype = runEconomy(scenarioParams("hype", 300), "hype").result;
  assert.ok(bear.totals.playersEnd < 300 && hype.totals.playersEnd > 300);
  assert.equal(summarize({ ...runEconomy({ ...DEFAULT_PARAMS, players: 100 }) }).split(":")[0], "Custom");
});
test("bot attack: self-hiring is net-negative for the attackers", () => {
  const { result } = runEconomy(scenarioParams("bots", 1000), "bots"), w = result.wash;
  assert.ok(w.bots === 50 && w.hires > 0);
  assert.ok(conserves(result));
  // Each self-hire returns only the owner share: the burn and season shares are lost on every fee.
  assert.ok(Math.abs(w.returned - w.spent * 0.7) < 1e-6 * w.spent);
  assert.ok(Math.abs(w.spent - w.returned - (w.burned + w.season)) < 1e-6 * w.spent);
  assert.ok(w.spent - w.returned > 0.29 * w.spent);
  // Pumping their own price also costs them real hires compared with an average Friend.
  assert.ok(w.organicPerBotFriendDay < w.organicPerOtherFriendDay, `${w.organicPerBotFriendDay} vs ${w.organicPerOtherFriendDay}`);
});
test("the hire cap limits wash volume", () => {
  const base = { ...scenarioParams("bots", 600) };
  const none = simulateEconomy({ ...base, hireCap: 0 }), three = simulateEconomy({ ...base, hireCap: 3 }), one = simulateEconomy({ ...base, hireCap: 1 });
  assert.ok(three.wash.hires <= three.wash.bots * 3 * 30 && one.wash.hires <= one.wash.bots * 30);
  assert.ok(one.wash.hires < three.wash.hires && three.wash.hires < none.wash.hires * 0.5, `${one.wash.hires} < ${three.wash.hires} < ${none.wash.hires}`);
  assert.ok(three.wash.capHits > 0 && none.wash.capHits === 0);
  const run = runEconomy(base, "bots");
  assert.equal(run.uncapped?.wash.hires, none.wash.hires);
});
test("whales run more expeditions and spend a larger share than their headcount", () => {
  const r = simulateEconomy(scenarioParams("whales", 1000)), t = r.totals;
  assert.ok(t.whaleDays > 0 && t.whaleSpent / t.spent > 2 * (t.whaleDays / t.playerDays));
  assert.ok(r.days[29].top10Share < 0.5);
});
test("generation sets the value: fees scale with tier, the split still conserves, Gen 1 earns 3× Gen 6 at equal demand", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(g => tierOf(g).mult), [3, 2, 1.5, 1.25, 1.1, 1, 1]);
  for (const unknown of [null, undefined, 0, -1, 1.5]) { assert.equal(tierOf(unknown).mult, 1); assert.equal(tierLabel(tierOf(unknown)), "GEN ? · ×1"); }
  assert.equal(tierLabel(tierOf(1)), "GEN 1 · LEGENDARY ×3");
  assert.equal(tierFeeOf(24, 1), baseFeeOf(24));
  for (const rating of [16, 24, 32]) for (const demand of [0, 1, 4]) {
    const gen1 = feeOf(tierFeeOf(rating, 3), demand), gen6 = feeOf(tierFeeOf(rating, 1), demand);
    for (const f of [gen1, gen6]) { const s = splitFee(f); assert.ok(Math.abs(s.owner + s.burn + s.season - f) < 1e-9); }
    const ratio = splitFee(gen1).owner / splitFee(gen6).owner;
    assert.ok(Math.abs(ratio - 3) < 0.1, `Gen 1 wallet ${splitFee(gen1).owner} vs Gen 6 ${splitFee(gen6).owner}`);
  }
  // Power grows by a quarter of the fee premium: worth hiring, not mandatory.
  assert.equal(powerMult(3), 1.5); assert.equal(powerMult(1), 1);
  const zone: Zone = { family: 0, tier: 3, favored: favoredFor(0), req: 76, foes: [] };
  const member = { stats: { power: 6, guard: 6, speed: 6, luck: 6 }, family: 1 as const };
  const plain = successChance(zone, [member, member, member], 1), rare = successChance(zone, [member, { ...member, mult: 3 }, member], 1);
  assert.ok(rare > plain && rare - plain < 0.2, `${plain} → ${rare}`);
});
test("the 30-day model with a generation mix conserves RF and pays Gen 1 wallets about 3× Gen 6", () => {
  assert.ok(Math.abs(GEN_MIX.reduce((a, b) => a + b, 0) - 1) < 1e-9 && GEN_MIX[6] > GEN_MIX[1]);
  for (const players of [300, 1000]) {
    const r = simulateEconomy({ players });
    assert.ok(conserves(r));
    const by = r.totals.perFriendDayByGen, ratio = by[1] / by[6];
    assert.ok(ratio > 2.5 && ratio < 4.5, `Gen 1 / Gen 6 = ${ratio}`);
    assert.ok(by[1] > by[2] && by[2] > by[3] && by[3] > by[6], by.join(", "));
  }
});
console.log(`# pass ${passed}`);
