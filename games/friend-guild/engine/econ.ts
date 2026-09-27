/**
 * Agent-based model of the Friend Guild economy over N days. Deterministic for a given seed.
 * Used by the in-game Economy tab and by tests. All values are simulated.
 *
 * Invariant: every RF spent ends up with a Friend owner, burned, or in the season fund. The model never mints RF.
 */
import { createRng } from "./rng";

export type EconParams = {
  players: number; days: number; expeditionsPerDay: number;
  ownerPct: number; burnPct: number; seasonPct: number;
  priceStep: number;          // fee multiplier per hire in the demand window (0.05 = +5%)
  demandDecay: number;        // share of demand that fades each day (0.5 = halves daily)
  craftShare: number;         // share of their Shards a player spends in the workshop each day
  craftRfPer30: number;       // RF burned per 30 Shards crafted (the workshop's RF component)
  growthPct: number;          // new players per day, % of active players (they start with no Shards)
  churnPct: number;           // players leaving per day, % of active players (their Shards leave circulation)
  whaleShare: number;         // share of players who are whales (0.05 = 5%)
  whaleMult: number;          // whales run this many times more expeditions
  botShare: number;           // share of starting players that are wash-hire bots hiring their own Friend
  botBudget: number;          // RF each bot spends per day on self-hires
  hireCap: number;            // max hires of the same Friend by one guild per day (0 = no cap)
  seed: number;
};
export const DEFAULT_PARAMS: EconParams = {
  players: 1000, days: 30, expeditionsPerDay: 3, ownerPct: 70, burnPct: 20, seasonPct: 10,
  priceStep: 0.05, demandDecay: 0.5, craftShare: 0.5, craftRfPer30: 4,
  growthPct: 2, churnPct: 2, whaleShare: 0, whaleMult: 4, botShare: 0, botBudget: 150, hireCap: 3, seed: 42,
};
/** Listed Friends per real player (the rest of the players don't list theirs). */
export const LISTED_RATIO = 0.8;

export type EconDay = {
  day: number; players: number; listed: number; hires: number;
  spent: number; burned: number; toOwners: number; season: number;
  burnedTotal: number; ownersTotal: number; avgFee: number; top10Share: number; activeEarners: number;
  /** Owner income from real hires (not self-hires) per listed Friend that day. */
  perFriend: number;
  shardsMinted: number; shardsSunk: number; shardsLost: number; shardsSupply: number; shardsPerPlayer: number; seasonFund: number;
};
export type WashStats = {
  bots: number; hires: number; spent: number; returned: number; burned: number; season: number;
  /** Owner income bots' Friends got from real players (their pumped price scares them off). */
  organic: number; capHits: number; organicPerBotFriendDay: number; organicPerOtherFriendDay: number;
};
export type EconResult = {
  days: EconDay[]; conserved: boolean;
  totals: {
    spent: number; burned: number; toOwners: number; season: number; seasonPaid: number; hires: number;
    playerDays: number; friendDays: number; perFriendPerDay: number; spendPerPlayerDay: number;
    whaleSpent: number; whaleHires: number; whaleDays: number; playersStart: number; playersEnd: number;
  };
  wash: WashStats;
};

export function simulateEconomy(input: Partial<EconParams> = {}): EconResult {
  const p = { ...DEFAULT_PARAMS, ...input };
  const rng = createRng(p.seed);
  const nBots = Math.round(p.players * p.botShare);
  // Friends: ratings follow the family/seed spread seen in game (roughly 16–32). Bots' own Friends are 0..nBots-1.
  const rating: number[] = [], baseFee: number[] = [], demand: number[] = [], earned: number[] = [];
  const newFriend = () => {
    const r = Math.max(12, Math.min(36, Math.round(24 + (rng.next() + rng.next() + rng.next() - 1.5) * 8)));
    rating.push(r); baseFee.push(1 + r * 0.22); demand.push(0); earned.push(0);
    return rating.length - 1;
  };
  for (let b = 0; b < nBots; b++) newFriend();
  const listed: number[] = [];           // listed Friends of real holders (bots' Friends are always listed too)
  const syncListed = (players: number) => {
    const target = Math.max(20, Math.round(players * LISTED_RATIO));
    while (listed.length < target) listed.push(newFriend());
    while (listed.length > target) { const j = rng.int(listed.length); listed[j] = listed[listed.length - 1]; listed.pop(); }
  };
  // Real players (bots are separate and do not join or churn).
  const wallet: number[] = [], whale: boolean[] = [], active: number[] = [];
  const join = () => { active.push(wallet.length); wallet.push(0); whale.push(p.whaleShare > 0 && rng.chance(p.whaleShare)); };
  for (let i = 0; i < p.players - nBots; i++) join();
  syncListed(active.length);
  const pool = () => nBots + listed.length;
  const at = (k: number) => (k < nBots ? k : listed[k - nBots]);
  const fee = (i: number) => baseFee[i] * (1 + p.priceStep) ** demand[i];

  const days: EconDay[] = [];
  let burnedTotal = 0, ownersTotal = 0, seasonFund = 0, seasonPaid = 0, shardsSupply = 0, spentTotal = 0, seasonTotal = 0, hiresTotal = 0;
  let joinCarry = 0, churnCarry = 0, playerDays = 0, friendDays = 0, whaleSpent = 0, whaleHires = 0, whaleDays = 0;
  const playersStart = active.length;
  const wash: WashStats = { bots: nBots, hires: 0, spent: 0, returned: 0, burned: 0, season: 0, organic: 0, capHits: 0, organicPerBotFriendDay: 0, organicPerOtherFriendDay: 0 };
  const today: number[] = [];            // Friends hired by the current guild today (for the hire cap)
  const capped = (i: number) => {
    if (p.hireCap <= 0 || today.length < p.hireCap) return false;
    let n = 0; for (const x of today) if (x === i && ++n >= p.hireCap) return true;
    return false;
  };

  for (let day = 1; day <= p.days; day++) {
    let spent = 0, burned = 0, toOwners = 0, season = 0, fees = 0, hires = 0, minted = 0, sunk = 0, lost = 0, organicOwners = 0;
    if (day > 1) {
      // Growth and churn, both computed on yesterday's player count. Fractions carry over so small rates still act.
      const base = active.length;
      joinCarry += base * p.growthPct / 100; churnCarry += base * p.churnPct / 100;
      const joins = Math.floor(joinCarry), leaves = Math.min(active.length, Math.floor(churnCarry));
      joinCarry -= joins; churnCarry -= leaves;
      for (let k = 0; k < leaves; k++) {
        const j = rng.int(active.length), id = active[j];
        lost += wallet[id]; wallet[id] = 0; active[j] = active[active.length - 1]; active.pop();
      }
      for (let k = 0; k < joins; k++) join();
      syncListed(active.length);
    }
    const pay = (i: number, f: number) => {
      const owner = f * p.ownerPct / 100, burn = f * p.burnPct / 100, seasonPart = f - owner - burn;
      demand[i] += 1; spent += f; toOwners += owner; burned += burn; season += seasonPart; fees += f; hires++;
      return { owner, burn, seasonPart };
    };
    for (const player of active) {
      today.length = 0;
      const isWhale = whale[player];
      if (isWhale) whaleDays++;
      const runs = Math.max(0, Math.round(p.expeditionsPerDay * (isWhale ? p.whaleMult : 1) + (rng.next() - 0.5) * 2));
      for (let run = 0; run < runs; run++) {
        for (let slot = 0; slot < 2; slot++) {
          // A tavern board shows 8 Friends; players pick value for money, sometimes pure prestige.
          let best = -1, bestScore = -Infinity;
          for (let c = 0; c < 8; c++) {
            const i = at(rng.int(pool()));
            const score = rng.chance(0.1) ? rating[i] : (rating[i] / fee(i)) * (0.8 + rng.next() * 0.4);
            if (score > bestScore && !capped(i)) { bestScore = score; best = i; }
          }
          if (best < 0) continue;
          const f = fee(best), { owner } = pay(best, f);
          earned[best] += owner; organicOwners += owner; today.push(best);
          if (best < nBots) wash.organic += owner;
          if (isWhale) { whaleSpent += f; whaleHires++; }
        }
        const found = 20 + rng.int(20); // shards from the expedition
        minted += found; wallet[player] += found;
      }
      // Workshop: Shards are spent in batches of 30, each batch also burning RF. The soft-currency sink drives the burn.
      const batches = Math.floor(wallet[player] * p.craftShare / 30);
      if (batches > 0) {
        const rf = batches * p.craftRfPer30;
        wallet[player] -= batches * 30; sunk += batches * 30; spent += rf; burned += rf;
        if (isWhale) whaleSpent += rf;
      }
    }
    // Bots hire their own Friend until their daily budget or the hire cap stops them. 70% comes back to them.
    for (let b = 0; b < nBots; b++) {
      let budget = p.botBudget, n = 0;
      for (;;) {
        const f = fee(b);
        if (f > budget) break;
        if (p.hireCap > 0 && n >= p.hireCap) { wash.capHits++; break; }
        const part = pay(b, f);
        budget -= f; n++;
        wash.hires++; wash.spent += f; wash.returned += part.owner; wash.burned += part.burn; wash.season += part.seasonPart;
      }
    }
    for (let i = 0; i < demand.length; i++) demand[i] *= 1 - p.demandDecay;
    burnedTotal += burned; ownersTotal += toOwners; seasonFund += season; spentTotal += spent; seasonTotal += season; hiresTotal += hires;
    shardsSupply += minted - sunk - lost;
    if (day % 7 === 0) { seasonPaid += seasonFund; seasonFund = 0; } // weekly season payout to top guilds
    const listedNow = pool();
    playerDays += active.length; friendDays += listedNow;
    const sorted = earned.slice().sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.1))).reduce((a, b) => a + b, 0);
    const organicTotal = sorted.reduce((a, b) => a + b, 0);
    days.push({
      day, players: active.length, listed: listedNow, hires, spent, burned, toOwners, season, burnedTotal, ownersTotal,
      avgFee: hires ? fees / hires : 0, top10Share: organicTotal ? top / organicTotal : 0,
      activeEarners: sorted.filter(v => v > 0).length / Math.max(1, sorted.length), perFriend: organicOwners / Math.max(1, listedNow),
      shardsMinted: minted, shardsSunk: sunk, shardsLost: lost, shardsSupply, shardsPerPlayer: active.length ? shardsSupply / active.length : 0, seasonFund,
    });
  }
  const conserved = Math.abs(spentTotal - (ownersTotal + burnedTotal + seasonTotal)) < 1e-6 * Math.max(1, spentTotal);
  const organicOwners = ownersTotal - wash.returned;
  if (nBots) {
    wash.organicPerBotFriendDay = wash.organic / (nBots * p.days);
    wash.organicPerOtherFriendDay = (organicOwners - wash.organic) / Math.max(1, friendDays - nBots * p.days);
  }
  return {
    days, conserved, wash,
    totals: {
      spent: spentTotal, burned: burnedTotal, toOwners: ownersTotal, season: seasonTotal, seasonPaid, hires: hiresTotal,
      playerDays, friendDays, perFriendPerDay: organicOwners / Math.max(1, friendDays),
      spendPerPlayerDay: (spentTotal - wash.spent) / Math.max(1, playerDays),
      whaleSpent, whaleHires, whaleDays, playersStart, playersEnd: active.length,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario presets for the Economy tab. Each sets parameters on top of the defaults (the player count is kept).

export type ScenarioId = "baseline" | "bear" | "hype" | "whales" | "bots";
export type Scenario = { id: ScenarioId; label: string; about: string; params: Partial<EconParams> };
export const SCENARIOS: readonly Scenario[] = [
  { id: "baseline", label: "Baseline", about: "2% of players join and 2% leave every day", params: {} },
  { id: "bear", label: "Bear market", about: "net −3% players a day (0.5% join, 3.5% leave), 2 expeditions a day", params: { growthPct: 0.5, churnPct: 3.5, expeditionsPerDay: 2 } },
  { id: "hype", label: "Hype", about: "net +5% players a day (7% join, 2% leave)", params: { growthPct: 7, churnPct: 2 } },
  { id: "whales", label: "Whales", about: "5% of players run 4× more expeditions", params: { whaleShare: 0.05, whaleMult: 4 } },
  { id: "bots", label: "Bot attack", about: "5% of guilds are bots spending 150 RF a day hiring their own Friend, hire cap 3 per Friend per day", params: { botShare: 0.05, botBudget: 150, hireCap: 3 } },
];
export const scenarioParams = (id: ScenarioId, players = DEFAULT_PARAMS.players): EconParams =>
  ({ ...DEFAULT_PARAMS, players, ...SCENARIOS.find(s => s.id === id)!.params });

export type EconRun = { id: ScenarioId | "custom"; params: EconParams; result: EconResult; uncapped?: EconResult };
/** Runs the model; with bots and a hire cap it also runs the same world without the cap, to show what the cap prevents. */
export function runEconomy(params: EconParams, id: ScenarioId | "custom" = "custom"): EconRun {
  const result = simulateEconomy(params);
  const uncapped = params.botShare > 0 && params.hireCap > 0 ? simulateEconomy({ ...params, hireCap: 0 }) : undefined;
  return { id, params, result, uncapped };
}

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 100)}%`;

function washLine(run: EconRun) {
  const w = run.result.wash, lost = w.spent - w.returned;
  let line = `${n0(w.bots)} bots made ${n0(w.hires)} self-hires, spent ${n0(w.spent)} RF and lost ${pct(w.spent ? lost / w.spent : 0)} of it (${n0(w.burned)} RF burned, ${n0(w.season)} RF to the season)`;
  if (w.organicPerOtherFriendDay > 0) {
    const gap = 1 - w.organicPerBotFriendDay / w.organicPerOtherFriendDay;
    line += gap > 0 ? `; their pumped price cut real hires of their Friends by ${pct(gap)} vs an average Friend` : "";
  }
  if (run.uncapped) {
    const u = run.uncapped.wash;
    line += `. Without the cap of ${run.params.hireCap} per Friend per day: ${n0(u.hires)} self-hires costing ${n0(u.spent)} RF (the cap cuts wash volume ${pct(u.hires ? 1 - w.hires / u.hires : 0)})`;
  }
  return line;
}

/** One-line reading of a run, computed from its results. */
export function summarize(run: EconRun): string {
  const { result: r } = run, t = r.totals, d1 = r.days[0], dn = r.days[r.days.length - 1], d7 = r.days[Math.min(6, r.days.length - 1)];
  const perFriend = `${n1(t.perFriendPerDay)} RF/day per listed Friend`;
  switch (run.id) {
    case "baseline":
      return `Baseline: ${n0(t.playersStart)} players, ${n1(run.params.growthPct)}% joining and ${n1(run.params.churnPct)}% leaving daily; ${n0(t.burned)} RF burned (${pct(t.burned / t.spent)} of all RF spent); an average listed Friend earned ${perFriend.replace(" per listed Friend", "")}.`;
    case "bear": {
      const peak = r.days.reduce((a, d) => (d.burned > a.burned ? d : a), d1);
      return `Bear market: players ${n0(t.playersStart)} → ${n0(t.playersEnd)}; daily burn peaked at ${n0(peak.burned)} RF on day ${peak.day}, then fell to ${n0(dn.burned)} by day ${dn.day} (−${pct(1 - dn.burned / peak.burned)}); the listed pool shrinks with players, so a listed Friend still earns ${n1(d7.perFriend)} → ${n1(dn.perFriend)} RF/day (day ${d7.day} → ${dn.day}).`;
    }
    case "hype":
      return `Hype: players ${n0(t.playersStart)} → ${n0(t.playersEnd)}; daily burn ${n0(d7.burned)} RF on day ${d7.day} → ${n0(dn.burned)} on day ${dn.day}; new players arrive with no Shards, yet a listed Friend still earns ${perFriend.replace(" per listed Friend", "")}.`;
    case "whales":
      return `Whales: ${pct(t.whaleDays / t.playerDays)} of players spent ${pct(t.whaleSpent / t.spent)} of all RF; the top 10% of Friends took ${pct(dn.top10Share)} of owner earnings; ${perFriend}.`;
    case "bots":
      return `Bot attack: ${washLine(run)}.`;
    default:
      return `Custom: players ${n0(t.playersStart)} → ${n0(t.playersEnd)}; ${n0(t.spent)} RF spent, ${n0(t.burned)} burned; ${perFriend}${r.wash.bots ? `. ${washLine(run)}` : ""}.`;
  }
}
