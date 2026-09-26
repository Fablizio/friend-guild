/**
 * Friend Guild rules. SIMULATED economy: no real RF moves in this prototype.
 *
 * RF only ever moves between players (mercenary fees) or out of circulation (burns). Expeditions never
 * create RF; they produce Shards, a soft currency that is never redeemable for RF.
 */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createRng, type Rng } from "./rng";
import type { FamilyId } from "./themes";

export const SPLIT = { owner: 70, burn: 20, season: 10 } as const;
export const PRICE_STEP = 0.05;          // +5% per hire still counted in the demand window
export const DEMAND_HALF_LIFE_S = 120;   // demo clock: demand halves every 2 real minutes
export const START_RF = 150;
export const MAX_GUILD_LEVEL = 5;
export const TEAM_SIZE = 2;              // hired mercenaries per expedition (plus your Friend)

export type StatKey = "power" | "guard" | "speed" | "luck";
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: readonly StatKey[] = ["power", "guard", "speed", "luck"];
export const STAT_LABEL: Readonly<Record<StatKey, string>> = { power: "Power", guard: "Guard", speed: "Speed", luck: "Luck" };

/** Each family's calling. Individual Friends vary around it by their seed. */
export const FAMILY_BASE: Readonly<Record<FamilyId, Stats>> = {
  0: { power: 5, guard: 8, speed: 4, luck: 4 },   // Skeleton: sturdy
  1: { power: 5, guard: 4, speed: 5, luck: 8 },   // Mask: lucky
  2: { power: 5, guard: 6, speed: 5, luck: 5 },   // Family: balanced, team bonus
  3: { power: 4, guard: 7, speed: 4, luck: 6 },   // Cellular: resilient
  4: { power: 9, guard: 3, speed: 5, luck: 4 },   // Asymmetry: hits hard
  5: { power: 4, guard: 4, speed: 9, luck: 5 },   // Hoverer: fast
  6: { power: 8, guard: 8, speed: 2, luck: 3 },   // Colossus: heavy
  7: { power: 7, guard: 3, speed: 4, luck: 7 },   // Sparkling: flashy
  8: { power: 5, guard: 3, speed: 7, luck: 6 },   // Hollow: elusive
};
export const FAMILY_TRAIT: Readonly<Record<FamilyId, string>> = {
  0: "Sturdy", 1: "Lucky", 2: "Team player", 3: "Resilient", 4: "Heavy hitter", 5: "Swift", 6: "Juggernaut", 7: "Flashy", 8: "Elusive",
};

const hash = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0); };

export function statsFor(sprites: GenerationSprites): Stats {
  const base = FAMILY_BASE[sprites.familyId as FamilyId];
  const h = hash(sprites.seed ^ Number(sprites.tokenId % 1_000_000n));
  const out = {} as Stats;
  STAT_KEYS.forEach((key, i) => { out[key] = Math.max(1, Math.min(12, base[key] + ((h >>> (i * 8)) % 5) - 2)); });
  return out;
}
export const ratingOf = (stats: Stats) => stats.power + stats.guard + stats.speed + stats.luck;
export const baseFeeOf = (rating: number) => Math.round((1 + rating * 0.22) * 10) / 10;
export const feeOf = (baseFee: number, demand: number) => Math.round(baseFee * (1 + PRICE_STEP) ** demand * 10) / 10;
export const round1 = (value: number) => Math.round(value * 10) / 10;

export type Merc = {
  sprites: GenerationSprites; id: bigint; family: FamilyId; stats: Stats; rating: number; baseFee: number;
  /** Hires still inside the demand window (decays continuously). */
  demand: number; hiresTotal: number; earned: number;
};
export function makeMerc(sprites: GenerationSprites): Merc {
  const stats = statsFor(sprites), rating = ratingOf(stats);
  return { sprites, id: sprites.tokenId, family: sprites.familyId as FamilyId, stats, rating, baseFee: baseFeeOf(rating), demand: 0, hiresTotal: 0, earned: 0 };
}
export const mercFee = (merc: Merc) => feeOf(merc.baseFee, merc.demand);

/** Where one fee goes. Always sums back to the fee: nothing is created. */
export function splitFee(fee: number) {
  const owner = round1(fee * SPLIT.owner / 100), burn = round1(fee * SPLIT.burn / 100);
  return { owner, burn, season: round1(fee - owner - burn) };
}

export type Gear = { id: number; stat: StatKey; bonus: number; name: string };
export const GEAR_NAMES: Readonly<Record<StatKey, string>> = { power: "Iron Blade", guard: "Bone Plate", speed: "Hover Boots", luck: "Lucky Charm" };
export const CRAFT = { shards: 30, rf: 4 } as const;
export const upgradeCost = (level: number) => ({ shards: 40 * level, rf: 8 * level });
export const GEAR_SLOTS = 3;

export type Zone = { family: FamilyId; tier: number; favored: readonly FamilyId[]; req: number; foes: readonly GenerationSprites[] };
/** A zone favours two families that counter its natives, so no single family is best everywhere. */
export const favoredFor = (family: FamilyId): FamilyId[] => [((family + 3) % 9) as FamilyId, ((family + 5) % 9) as FamilyId];

export function teamPower(members: readonly Stats[]) {
  return members.reduce((sum, s) => sum + s.power * 1.2 + s.guard + s.speed * 0.8 + s.luck * 0.6, 0);
}
export function successChance(zone: Zone, members: readonly { stats: Stats; family: FamilyId }[], guildLevel: number) {
  const power = teamPower(members.map(m => m.stats));
  const affinity = members.filter(m => zone.favored.includes(m.family)).length;
  const kin = members.filter(m => m.family === 2).length ? 0.03 * (members.length - 1) : 0; // Family: team player
  const chance = 0.5 + (power - zone.req) * 0.018 + (guildLevel - 1) * 0.03 + affinity * 0.07 + kin;
  return Math.max(0.05, Math.min(0.95, chance));
}

export type Encounter = { foe: GenerationSprites; won: boolean; shards: number };
export type ExpeditionResult = {
  zone: Zone; success: boolean; chance: number; shards: number; fame: number; gear: Gear | null; encounters: Encounter[]; duration: number;
};

/** Browser randomness is presentation only here: expeditions never pay RF. */
export function runExpedition(rng: Rng, zone: Zone, members: readonly { stats: Stats; family: FamilyId }[], guildLevel: number, gearId: number): ExpeditionResult {
  const chance = successChance(zone, members, guildLevel);
  const success = rng.chance(chance);
  const luck = members.reduce((sum, m) => sum + m.stats.luck, 0);
  const shards = success ? 12 * zone.tier + rng.int(8 * zone.tier + 1) + Math.round(luck / 3) : 4 * zone.tier + rng.int(4);
  const fame = success ? 10 * zone.tier : 0;
  const gear = success && rng.chance(0.08 * zone.tier) ? (() => {
    const stat = rng.pick(STAT_KEYS); return { id: gearId, stat, bonus: 1 + rng.int(2) + (zone.tier >= 3 ? 1 : 0), name: GEAR_NAMES[stat] };
  })() : null;
  // Four encounters that tell the story of the result: a failed run loses the last one.
  const encounters: Encounter[] = [];
  let left = shards;
  for (let i = 0; i < 4; i++) {
    const last = i === 3, won = last ? success : success || rng.chance(0.6);
    const share = last ? left : Math.round(shards * (0.15 + rng.next() * 0.1));
    left -= share;
    encounters.push({ foe: rng.pick(zone.foes), won, shards: Math.max(0, share) });
  }
  return { zone, success, chance, shards, fame, gear, encounters, duration: 12 + zone.tier * 3 };
}

export type Ledger = { spent: number; toOwners: number; burned: number; season: number };
export const emptyLedger = (): Ledger => ({ spent: 0, toOwners: 0, burned: 0, season: 0 });
export function record(ledger: Ledger, fee: number, kind: "hire" | "burn") {
  if (kind === "burn") return { ...ledger, spent: round1(ledger.spent + fee), burned: round1(ledger.burned + fee) };
  const part = splitFee(fee);
  return { spent: round1(ledger.spent + fee), toOwners: round1(ledger.toOwners + part.owner), burned: round1(ledger.burned + part.burn), season: round1(ledger.season + part.season) };
}

export const SIM_GUILDS = ["Owlkeep", "Ninefold", "Lanternfall", "Brassbone", "Driftmoor", "Sable Pact", "Greenwire", "Hollowgate", "Kiln & Co", "Starch Bay"];
export function simRng(seed: number) { return createRng(seed); }
