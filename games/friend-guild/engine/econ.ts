/**
 * Agent-based model of the Friend Guild economy over N days. Deterministic for a given seed.
 * Used by the in-game Economy tab and by tests. All values are simulated.
 */
import { createRng } from "./rng";

export type EconParams = {
  players: number; days: number; expeditionsPerDay: number;
  ownerPct: number; burnPct: number; seasonPct: number;
  priceStep: number;          // fee multiplier per hire in the demand window (0.05 = +5%)
  demandDecay: number;        // share of demand that fades each day (0.5 = halves daily)
  craftShare: number;         // share of their Shards a player spends in the workshop each day
  craftRfPer30: number;       // RF burned per 30 Shards crafted (the workshop's RF component)
  seed: number;
};
export const DEFAULT_PARAMS: EconParams = {
  players: 1000, days: 30, expeditionsPerDay: 3, ownerPct: 70, burnPct: 20, seasonPct: 10,
  priceStep: 0.05, demandDecay: 0.5, craftShare: 0.5, craftRfPer30: 4, seed: 42,
};

export type EconDay = {
  day: number; spent: number; burned: number; toOwners: number; season: number;
  burnedTotal: number; ownersTotal: number; avgFee: number; top10Share: number; activeEarners: number;
  shardsMinted: number; shardsSunk: number; shardsSupply: number; seasonFund: number;
};
export type EconResult = { days: EconDay[]; conserved: boolean; totals: { spent: number; burned: number; toOwners: number; season: number; seasonPaid: number } };

export function simulateEconomy(input: Partial<EconParams> = {}): EconResult {
  const p = { ...DEFAULT_PARAMS, ...input };
  const rng = createRng(p.seed);
  const listed = Math.max(20, Math.round(p.players * 0.8));
  // Ratings follow the family/seed spread seen in game (roughly 16–32).
  const rating = Array.from({ length: listed }, () => Math.max(12, Math.min(36, Math.round(24 + (rng.next() + rng.next() + rng.next() - 1.5) * 8))));
  const baseFee = rating.map(r => 1 + r * 0.22);
  const demand = new Float64Array(listed), earned = new Float64Array(listed), wallet = new Float64Array(p.players);
  const fee = (i: number) => baseFee[i] * (1 + p.priceStep) ** demand[i];
  const days: EconDay[] = [];
  let burnedTotal = 0, ownersTotal = 0, seasonFund = 0, seasonPaid = 0, shardsSupply = 0, spentTotal = 0, seasonTotal = 0;
  for (let day = 1; day <= p.days; day++) {
    let spent = 0, burned = 0, toOwners = 0, season = 0, fees = 0, hires = 0, minted = 0, sunk = 0;
    for (let player = 0; player < p.players; player++) {
      const runs = Math.max(0, Math.round(p.expeditionsPerDay + (rng.next() - 0.5) * 2));
      for (let run = 0; run < runs; run++) {
        for (let slot = 0; slot < 2; slot++) {
          // A tavern board shows 8 Friends; players pick value for money, sometimes pure prestige.
          let best = -1, bestScore = -Infinity;
          for (let c = 0; c < 8; c++) {
            const i = rng.int(listed);
            const score = rng.chance(0.1) ? rating[i] : (rating[i] / fee(i)) * (0.8 + rng.next() * 0.4);
            if (score > bestScore) { bestScore = score; best = i; }
          }
          const f = fee(best);
          const owner = f * p.ownerPct / 100, burn = f * p.burnPct / 100, seasonPart = f - owner - burn;
          earned[best] += owner; demand[best] += 1;
          spent += f; toOwners += owner; burned += burn; season += seasonPart; fees += f; hires++;
        }
        const found = 20 + rng.int(20); // shards from the expedition
        minted += found; wallet[player] += found;
      }
      // Workshop: Shards are spent in batches of 30, each batch also burning RF. The soft-currency sink drives the burn.
      const batches = Math.floor(wallet[player] * p.craftShare / 30);
      if (batches > 0) {
        const rf = batches * p.craftRfPer30;
        wallet[player] -= batches * 30; sunk += batches * 30; spent += rf; burned += rf;
      }
    }
    for (let i = 0; i < listed; i++) demand[i] *= 1 - p.demandDecay;
    burnedTotal += burned; ownersTotal += toOwners; seasonFund += season; spentTotal += spent; seasonTotal += season;
    shardsSupply += minted - sunk;
    if (day % 7 === 0) { seasonPaid += seasonFund; seasonFund = 0; } // weekly season payout to top guilds
    const sorted = Array.from(earned).sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.round(listed * 0.1))).reduce((a, b) => a + b, 0);
    days.push({
      day, spent, burned, toOwners, season, burnedTotal, ownersTotal, avgFee: hires ? fees / hires : 0,
      top10Share: ownersTotal ? top / ownersTotal : 0, activeEarners: sorted.filter(v => v > 0).length / listed,
      shardsMinted: minted, shardsSunk: sunk, shardsSupply, seasonFund,
    });
  }
  const conserved = Math.abs(spentTotal - (ownersTotal + burnedTotal + seasonTotal)) < 1e-6 * Math.max(1, spentTotal);
  return { days, conserved, totals: { spent: spentTotal, burned: burnedTotal, toOwners: ownersTotal, season: seasonTotal, seasonPaid } };
}
