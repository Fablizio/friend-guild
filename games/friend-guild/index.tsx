"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";
import { loadRoster, readGeneration, type Roster } from "./engine/roster";
import { createRng, randomSeed } from "./engine/rng";
import { Audio, type Sfx } from "./engine/audio";
import type { MusicTheme } from "./engine/music";
import { frameCanvas } from "./engine/sprites";
import { FAMILY_NAMES, THEMES, type FamilyId } from "./engine/themes";
import {
  CRAFT, DEMAND_HALF_LIFE_S, FAMILY_TRAIT, GEAR_NAMES, GEAR_SLOTS, MAX_GUILD_LEVEL, SIM_GUILDS, SPLIT, START_RF, STAT_KEYS, STAT_LABEL, TEAM_SIZE,
  emptyLedger, favoredFor, feeOf, makeMerc, mercFee, powerMult, ratingOf, record, round1, runExpedition, splitFee, statsFor, successChance, tierFeeOf,
  tierLabel, tierOf, upgradeCost, type ExpeditionResult, type Gear, type GenTier, type Ledger, type Merc, type Stats, type StatKey, type Zone,
} from "./engine/guild";
import { DEFAULT_PARAMS, SCENARIOS, runEconomy, scenarioParams, summarize, type EconParams, type EconRun, type ScenarioId } from "./engine/econ";
import { SCENE_H, SCENE_W, drawLineChart, drawScene, sceneCues } from "./engine/scene";

type Tab = "guild" | "tavern" | "expedition" | "workshop" | "economy";
type Feed = { key: number; text: string; you?: boolean };
type Run = { result: ExpeditionResult; team: GenerationSprites[]; start: number; done: boolean };
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "guild", label: "Guild" }, { id: "tavern", label: "Tavern" }, { id: "expedition", label: "Expedition" },
  { id: "workshop", label: "Workshop" }, { id: "economy", label: "Economy" },
];
const rf = (v: number) => `${round1(v).toLocaleString("en-US")} RF`;
const compact = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`;

function Portrait({ sprites, scale = 3, halo = "#ffffff", label }: { sprites: GenerationSprites; scale?: number; halo?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frameCanvas(sprites.clips.idle[sprites.familyId === 6 ? "right" : "down"][0], scale, "#000000", halo), 0, 0);
  }, [sprites, scale, halo]);
  return <canvas ref={ref} width={18 * scale} height={18 * scale} className="fg-portrait" role="img" aria-label={label} />;
}

/** "GEN 1 · LEGENDARY ×3": the Friend's generation tier, which sets its fee (and, more gently, its power). */
function TierBadge({ tier }: { tier: GenTier }) {
  const power = Math.round((powerMult(tier.mult) - 1) * 100);
  return <span className={`fg-tier g${tier.gen === null ? "x" : Math.min(6, tier.gen)}`}
    title={tier.gen === null ? "Generation unknown: priced ×1" : `Generation ${tier.gen}: fee ×${tier.mult}${power ? `, expedition power +${power}%` : ""}`}>{tierLabel(tier)}</span>;
}

function StatBars({ stats, bonus }: { stats: Stats; bonus?: Partial<Stats> }) {
  return <div className="fg-stats">{STAT_KEYS.map(key => <div key={key} className="fg-stat">
    <span>{STAT_LABEL[key].slice(0, 3)}</span>
    <i><b style={{ width: `${Math.min(100, (stats[key] / 14) * 100)}%` }} />{bonus?.[key] ? <b className="bonus" style={{ width: `${Math.min(100, (bonus[key]! / 14) * 100)}%` }} /> : null}</i>
    <em>{stats[key] + (bonus?.[key] ?? 0)}</em>
  </div>)}</div>;
}

/** Where RF goes: hire fees split three ways, workshop RF is burned, expeditions only make Shards. Text carries every label. */
function FlowDiagram({ owner, burn, season }: { owner: number; burn: number; season: number }) {
  return <figure className="fg-flow" aria-label="RF flows">
    <figcaption>Where RF goes <span className="fg-sim">SIMULATED</span></figcaption>
    <div className="fg-flow-row">
      <span className="fg-node">Player</span><i aria-hidden="true">→</i>
      <span className="fg-node">Hire fee (RF)</span><i aria-hidden="true">→</i>
      <ul className="fg-flow-split" aria-label="The fee splits into">
        <li className="fg-node owner">{owner}% → hired Friend's wallet</li>
        <li className="fg-node burn">{burn}% → burned 🔥</li>
        <li className="fg-node season">{season}% → season fund <i aria-hidden="true">→</i> weekly payout to top guilds</li>
      </ul>
    </div>
    <div className="fg-flow-row">
      <span className="fg-node">Expeditions</span><i aria-hidden="true">→</i>
      <span className="fg-node shard">◆ Shards (never RF)</span><i aria-hidden="true">→</i>
      <span className="fg-node">Workshop: ◆ + RF</span><i aria-hidden="true">→</i>
      <span className="fg-node burn">100% of that RF burned 🔥</span>
    </div>
  </figure>;
}

function Chart({ title, values, color, format }: { title: string; values: readonly number[]; color: string; format: (v: number) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const indexer = useRef<((px: number) => number) | null>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    indexer.current = drawLineChart(ctx, canvas.width, canvas.height, values, color, hover, format).hoverIndex;
  }, [values, color, hover, format]);
  const tip = hover !== null && values[hover] !== undefined ? `Day ${hover + 1}: ${format(values[hover])}` : `Day ${values.length}: ${format(values.at(-1) ?? 0)}`;
  return <figure className="fg-chart">
    <figcaption><b>{title}</b><span>{tip}</span></figcaption>
    <canvas ref={ref} width={440} height={150} role="img" aria-label={`${title}, ${values.length} days, final ${format(values.at(-1) ?? 0)}`}
      onPointerMove={event => { const r = event.currentTarget.getBoundingClientRect(); setHover(indexer.current?.((event.clientX - r.left) * 440 / r.width) ?? null); }}
      onPointerLeave={() => setHover(null)} />
  </figure>;
}

export default function FriendGuild({ friendId, client, paused }: GameComponentProps) {
  const audio = useRef<Audio | null>(null);
  const rngRef = useRef(createRng(randomSeed()));
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [status, setStatus] = useState("Verifying your Friend and opening the guild hall…");
  const [revision, setRevision] = useState(0);
  const [player, setPlayer] = useState<GenerationSprites | null>(null);
  const [myGen, setMyGen] = useState<number | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [tab, setTab] = useState<Tab>("guild");
  const [menu, setMenu] = useState<"settings" | "help" | null>(null);
  const [muted, setMuted] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  /** Music plays only while the game is visible and focused (and the runtime has not paused it). */
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [focused, setFocused] = useState(() => typeof document === "undefined" || document.hasFocus());
  const [reducedMotion, setReducedMotion] = useState(false);
  // Guild state (simulated, per session).
  const [balance, setBalance] = useState(START_RF);
  const [shards, setShards] = useState(0);
  const [fame, setFame] = useState(0);
  const [level, setLevel] = useState(1);
  const [gear, setGear] = useState<Gear[]>([]);
  const [equipped, setEquipped] = useState<number[]>([]);
  const [nextGear, setNextGear] = useState(1);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger());
  const [world, setWorld] = useState<Ledger>(emptyLedger());
  const [mercs, setMercs] = useState<Merc[]>([]);
  const [board, setBoard] = useState<number[]>([]);
  const [hired, setHired] = useState<number[]>([]);
  const [listed, setListed] = useState(true);
  const [me, setMe] = useState({ demand: 0, hires: 0, earned: 0 });
  const [feed, setFeed] = useState<Feed[]>([]);
  const [rivals, setRivals] = useState<{ name: string; fame: number }[]>([]);
  const [zoneIndex, setZoneIndex] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [econParams, setEconParams] = useState<EconParams>(DEFAULT_PARAMS);
  const [scenario, setScenario] = useState<ScenarioId | "custom">("baseline");
  const [econRun, setEconRun] = useState<EconRun | null>(null);
  const econ = econRun?.result ?? null;
  const [econBusy, setEconBusy] = useState(false);
  const live = useRef({ paused, menu, listed, me, mercs, reducedMotion, myMult: 1 });
  live.current = { paused, menu, listed, me, mercs, reducedMotion, myMult: tierOf(myGen).mult };

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches); update(); motion.addEventListener("change", update);
    audio.current = new Audio();
    return () => { motion.removeEventListener("change", update); audio.current?.dispose(); audio.current = null; };
  }, []);
  useEffect(() => { audio.current?.setMuted(muted); }, [muted]);
  useEffect(() => { audio.current?.setMusic(musicOn); }, [musicOn]);
  useEffect(() => {
    const visibility = () => { setHidden(document.hidden); audio.current?.setHidden(document.hidden); };
    const focus = () => setFocused(true), blur = () => setFocused(false);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", focus); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); };
  }, []);
  /** Audio starts on the first user gesture (browsers keep it silent until then). */
  const unlockAudio = useCallback(() => { setFocused(true); const a = audio.current; if (a) { a.wake(); void a.unlock(); } }, []);
  const sound = useCallback((cue: Parameters<Audio["cue"]>[0]) => { void audio.current?.unlock().then(() => audio.current?.cue(cue)); }, []);

  // Session, your Friend's artwork and a cast of real Friends for the tavern and the zones.
  useEffect(() => {
    let cancelled = false;
    setPhase("loading"); setStatus("Verifying your Friend and opening the guild hall…");
    (async () => {
      const [snapshot, sprites] = await Promise.all([client.read(), createFriendReader().read(friendId)]);
      if (snapshot.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      if (cancelled) return;
      setPlayer(sprites);
      setStatus("Filling the tavern with real Friends from Robinhood Chain…");
      // The leader's generation is best effort (null = ×1) and read alongside the cast, never blocking it.
      const [cast, generation] = await Promise.all([loadRoster(createRng(randomSeed()), friendId, null, 4), readGeneration(friendId)]);
      if (cancelled) return;
      setMyGen(generation);
      const pool = cast.floors.flatMap(floor => [...floor.regulars, floor.boss]).map(sprites => makeMerc(sprites, cast.generations.get(sprites.tokenId) ?? null));
      const rng = rngRef.current;
      setRoster(cast); setMercs(pool);
      setBoard(rng.shuffle(pool.map((_, i) => i)).slice(0, 8));
      setRivals(SIM_GUILDS.slice(0, 6).map(name => ({ name, fame: 20 + rng.int(160) })));
      setPhase("ready");
    })().catch(cause => {
      if (cancelled) return;
      setPhase("error");
      setStatus(cause instanceof Error && cause.message.length < 140 ? cause.message : "The tavern could not load its Friends. Check your connection and retry.");
    });
    return () => { cancelled = true; };
  }, [friendId, client, revision]);

  const myStats = useMemo(() => player ? statsFor(player) : null, [player]);
  const bonus = useMemo(() => {
    const out: Partial<Stats> = {};
    for (const item of gear.filter(g => equipped.includes(g.id))) out[item.stat] = (out[item.stat] ?? 0) + item.bonus;
    return out;
  }, [gear, equipped]);
  const myTotal = useMemo(() => myStats ? Object.fromEntries(STAT_KEYS.map(k => [k, myStats[k] + (bonus[k] ?? 0)])) as Stats : null, [myStats, bonus]);
  const myRating = myTotal ? ratingOf(myTotal) : 0;
  const myTier = tierOf(myGen);
  const myFee = feeOf(tierFeeOf(myRating, myTier.mult), me.demand);
  const family = (player?.familyId ?? 0) as FamilyId;

  const zones: Zone[] = useMemo(() => roster ? roster.floors.map((floor, i) => ({
    family: floor.family, tier: i + 1, favored: favoredFor(floor.family), req: 40 + (i + 1) * 12, foes: [...floor.regulars, floor.boss],
  })) : [], [roster]);
  const zone = zones[zoneIndex] ?? null;
  const team = useMemo(() => [
    ...(myTotal ? [{ stats: myTotal, family, mult: myTier.mult }] : []),
    ...hired.map(i => mercs[i]).filter(Boolean).map(m => ({ stats: m.stats, family: m.family, mult: m.tier.mult })),
  ], [myTotal, family, myTier.mult, hired, mercs]);
  const chance = zone ? successChance(zone, team, level) : 0;

  const pushFeed = useCallback((text: string, you = false) => setFeed(items => [{ key: performance.now() + Math.random(), text, you }, ...items].slice(0, 7)), []);

  // The rest of the world: simulated guilds hire mercenaries (including yours, if listed) and demand decays.
  useEffect(() => {
    if (phase !== "ready") return;
    const rng = createRng(randomSeed());
    const id = setInterval(() => {
      const state = live.current;
      if (state.paused || document.hidden) return;
      const decay = Math.pow(0.5, 1.5 / DEMAND_HALF_LIFE_S);
      setMercs(list => list.map(m => ({ ...m, demand: m.demand * decay })));
      setMe(m => ({ ...m, demand: m.demand * decay }));
      if (rng.chance(0.55) && state.mercs.length) {
        const index = rng.int(state.mercs.length), merc = state.mercs[index], fee = mercFee(merc), part = splitFee(fee), guild = rng.pick(SIM_GUILDS);
        setMercs(list => list.map((m, i) => i === index ? { ...m, demand: m.demand + 1, hiresTotal: m.hiresTotal + 1, earned: round1(m.earned + part.owner) } : m));
        setWorld(w => record(w, fee, "hire"));
        pushFeed(`${guild} hired Friend #${merc.id} for ${rf(fee)} · ${rf(part.owner)} to its wallet · ${rf(part.burn)} burned`);
      }
      if (state.listed) {
        // Simulated guilds weigh value for money against the tier's price: an overpriced Friend gets hired less,
        // while a rarer Friend is hired as often as a common one at its tier's fair price, and each hire pays ×mult.
        const stats = myTotalRef.current, rating = stats ? ratingOf(stats) : 20;
        const fee = feeOf(tierFeeOf(rating, state.myMult), state.me.demand);
        // About one hire every 30 s at a fair price in the demo clock; overpricing cuts it sharply.
        const value = (rating * state.myMult / fee) / 3.6;
        const p = Math.max(0.005, Math.min(0.12, 0.05 * value ** 3));
        if (rng.chance(p)) {
          const part = splitFee(fee), guild = rng.pick(SIM_GUILDS);
          setMe(m => ({ demand: m.demand + 1, hires: m.hires + 1, earned: round1(m.earned + part.owner) }));
          setWorld(w => record(w, fee, "hire"));
          pushFeed(`${guild} hired YOUR Friend #${friendId} for ${rf(fee)} · +${rf(part.owner)} to your Friend's wallet`, true);
          sound("reward");
        }
      }
      setRivals(list => list.map(r => ({ ...r, fame: r.fame + (rng.chance(0.25) ? 10 * (1 + rng.int(4)) : 0) })));
    }, 1500);
    return () => clearInterval(id);
  }, [phase, friendId, pushFeed, sound]);
  const myTotalRef = useRef<Stats | null>(null); myTotalRef.current = myTotal;

  const hire = (index: number) => {
    if (paused || run) return;
    if (hired.includes(index)) { return; }
    const merc = mercs[index], fee = mercFee(merc);
    if (hired.length >= TEAM_SIZE || balance < fee) return;
    const part = splitFee(fee);
    setBalance(b => round1(b - fee)); setHired(h => [...h, index]);
    setLedger(l => record(l, fee, "hire")); setWorld(w => record(w, fee, "hire"));
    setMercs(list => list.map((m, i) => i === index ? { ...m, demand: m.demand + 1, hiresTotal: m.hiresTotal + 1, earned: round1(m.earned + part.owner) } : m));
    pushFeed(`You hired Friend #${merc.id} for ${rf(fee)} · ${rf(part.owner)} to its wallet · ${rf(part.burn)} burned`, true);
    sound("purchase");
  };
  const refreshBoard = () => {
    if (paused) return;
    const rng = rngRef.current, keep = hired;
    const rest = rng.shuffle(mercs.map((_, i) => i).filter(i => !keep.includes(i))).slice(0, 8 - keep.length);
    setBoard([...keep, ...rest]); sound("select");
  };
  const launch = () => {
    if (!zone || !player || paused || run) return;
    const result = runExpedition(rngRef.current, zone, team, level, nextGear);
    setRun({ result, team: [player, ...hired.map(i => mercs[i].sprites)], start: performance.now(), done: false });
    sound("action-start");
  };
  const finishRun = useCallback(() => {
    setRun(current => {
      if (!current || current.done) return current;
      const { result } = current;
      setShards(s => s + result.shards); setFame(f => f + result.fame);
      if (result.gear) { setGear(list => [...list, result.gear!]); setNextGear(n => n + 1); }
      setHired([]);
      pushFeed(`Expedition to ${THEMES[result.zone.family].floorName}: ${result.success ? "success" : "failed"} · +${result.shards} shards${result.fame ? ` · +${result.fame} fame` : ""}${result.gear ? ` · found ${result.gear.name} +${result.gear.bonus}` : ""}`, true);
      // Victory jingle or defeat sting when music is on; the kit cue otherwise (and for found gear).
      const jingled = audio.current?.jingle(result.success ? "win" : "lose") ?? false;
      if (result.gear) audio.current?.cue("reveal-rare"); else if (!jingled) audio.current?.cue(result.success ? "reward" : "select");
      return { ...current, done: true };
    });
  }, [pushFeed]);

  // Expedition animation.
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const pausedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!run || run.done) return;
    let frame = 0, heard = 0;
    const emit = (sfx: Sfx) => audio.current?.play(sfx);
    const loop = (now: number) => {
      const state = live.current, canvas = sceneRef.current, ctx = canvas?.getContext("2d");
      if (state.paused || state.menu || document.hidden) { if (pausedAt.current === null) pausedAt.current = now; frame = requestAnimationFrame(loop); return; }
      if (pausedAt.current !== null) { run.start += now - pausedAt.current; pausedAt.current = null; }
      const t = (now - run.start) / 1000;
      if (ctx) drawScene(ctx, run.result, run.team, t, state.reducedMotion);
      sceneCues(run.result, run.team, heard, t, emit); heard = Math.max(heard, t);
      if (t >= run.result.duration) { finishRun(); return; }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [run, finishRun]);
  useEffect(() => {
    if (run?.done) { const ctx = sceneRef.current?.getContext("2d"); if (ctx) drawScene(ctx, run.result, run.team, run.result.duration, reducedMotion); }
  }, [run, reducedMotion]);

  const upgrade = () => {
    const cost = upgradeCost(level);
    if (paused || level >= MAX_GUILD_LEVEL || shards < cost.shards || balance < cost.rf) return;
    setShards(s => s - cost.shards); setBalance(b => round1(b - cost.rf)); setLevel(l => l + 1);
    setLedger(l => record(l, cost.rf, "burn")); setWorld(w => record(w, cost.rf, "burn"));
    pushFeed(`Guild upgraded to level ${level + 1} · ${rf(cost.rf)} burned`, true); sound("reveal-rare");
  };
  const craft = (stat: StatKey) => {
    if (paused || shards < CRAFT.shards || balance < CRAFT.rf) return;
    const item: Gear = { id: nextGear, stat, bonus: 2, name: GEAR_NAMES[stat] };
    setShards(s => s - CRAFT.shards); setBalance(b => round1(b - CRAFT.rf)); setNextGear(n => n + 1);
    setGear(list => [...list, item]);
    if (equipped.length < GEAR_SLOTS) setEquipped(e => [...e, item.id]);
    setLedger(l => record(l, CRAFT.rf, "burn")); setWorld(w => record(w, CRAFT.rf, "burn"));
    pushFeed(`Crafted ${item.name} +2 · ${rf(CRAFT.rf)} burned`, true); sound("purchase");
  };
  const toggleEquip = (id: number) => {
    if (paused) return;
    setEquipped(e => e.includes(id) ? e.filter(x => x !== id) : e.length < GEAR_SLOTS ? [...e, id] : e);
  };
  const runEcon = (params = econParams, id = scenario) => {
    if (econBusy) return;
    setEconBusy(true);
    setTimeout(() => { setEconRun(runEconomy(params, id)); setEconBusy(false); }, 30);
  };
  const pickScenario = (id: ScenarioId) => {
    if (paused || econBusy) return;
    const params = scenarioParams(id, econParams.players);
    setEconParams(params); setScenario(id); runEcon(params, id); sound("select");
  };
  /** A manual parameter change turns the preset into a custom run. */
  const setParam = (patch: Partial<EconParams>) => { setEconParams(p => ({ ...p, ...patch })); setScenario("custom"); };
  useEffect(() => { if (tab === "economy" && !econ && !econBusy) runEcon(); });

  // Soundtrack: the tavern theme on the guild screens, the zone family's theme during an expedition, silence on the result.
  const musicTheme: MusicTheme | null = phase !== "ready" ? null : run ? (run.done ? null : run.result.zone.family) : "tavern";
  useEffect(() => { audio.current?.theme(musicTheme, !paused && !hidden && focused); }, [musicTheme, paused, hidden, focused]);

  const board3 = [{ name: `Your guild`, fame, you: true }, ...rivals.map(r => ({ ...r, you: false }))].sort((a, b) => b.fame - a.fame);

  if (phase !== "ready" || !player || !myTotal || !roster) {
    return <section className="fg-game"><div className="fg-screen" role={phase === "error" ? "alert" : "status"}>
      <h1 className="fg-logo">FRIEND <em>GUILD</em></h1><p>{status}</p>
      {phase === "loading" && <div className="fg-spinner" aria-hidden="true" />}
      {phase === "error" && <button type="button" className="fg-primary" disabled={paused} onClick={() => setRevision(v => v + 1)}>Retry</button>}
    </div></section>;
  }

  return <section className="fg-game" aria-label="Friend Guild" onPointerDownCapture={unlockAudio} onKeyDownCapture={unlockAudio}>
    <header className="fg-top">
      <h1 className="fg-logo small">FRIEND <em>GUILD</em></h1>
      <div className="fg-tabs" role="tablist" aria-label="Guild sections">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} disabled={paused}
          onClick={() => { setTab(t.id); sound("select"); }}>{t.label}{t.id === "tavern" && hired.length ? ` ${hired.length}/${TEAM_SIZE}` : ""}</button>)}
      </div>
      <div className="fg-wallet" aria-label="Simulated balances">
        <span className="fg-sim">SIM</span><b>{rf(balance)}</b><span>◆ {shards}</span><span>★ {fame}</span>
        <button type="button" className="fg-icon" aria-label="Help" disabled={paused} onClick={() => setMenu("help")}>?</button>
        <button type="button" className="fg-icon" aria-label="Settings" disabled={paused} onClick={() => setMenu("settings")}>⚙</button>
      </div>
    </header>

    <main className="fg-main" inert={paused || menu !== null || undefined}>
      {tab === "guild" && <div className="fg-grid2">
        <div className="fg-card fg-me">
          <div className="fg-row">
            <Portrait sprites={player} scale={5} label={`Your Friend number ${String(friendId)}`} />
            <div>
              <h2>Friend #{String(friendId)}</h2>
              <p><TierBadge tier={myTier} /></p>
              <p>{player.familyName} · {FAMILY_TRAIT[family]} · Guild master · level {level}</p>
              <p>Rating <b>{myRating}</b> · hire fee <b>{rf(myFee)}</b>{myTier.mult > 1 ? ` (×${myTier.mult} for Gen ${myTier.gen})` : ""}</p>
            </div>
          </div>
          <StatBars stats={myStats!} bonus={bonus} />
          <label className="fg-toggle"><input type="checkbox" checked={listed} disabled={paused} onChange={e => setListed(e.target.checked)} /> Listed in the tavern: other guilds can hire your Friend</label>
          <div className="fg-earn">
            <div><small>Your Friend's wallet earned</small><b>{rf(me.earned)}</b></div>
            <div><small>Times hired</small><b>{me.hires}</b></div>
            <div><small>Demand</small><b>{me.demand < 0.5 ? "calm" : `+${Math.round(((1.05 ** me.demand) - 1) * 100)}%`}</b></div>
          </div>
          <p className="fg-small">{SPLIT.owner}% of every fee paid for your Friend goes to its own wallet. Generation sets the value: rarer Friends charge more per hire (Gen 1 ×3 … Gen 6 ×1). Simulated guilds hire more when your rating is worth the fee.</p>
        </div>
        <div className="fg-col">
          <div className="fg-card">
            <h3>Live tavern feed <span className="fg-sim">SIMULATED</span></h3>
            <ul className="fg-feed">{feed.length ? feed.map(item => <li key={item.key} className={item.you ? "you" : ""}>{item.text}</li>) : <li>Waiting for the first hires…</li>}</ul>
          </div>
          <div className="fg-card">
            <h3>Season fame <span className="fg-sim">SIMULATED</span></h3>
            <ol className="fg-season">{board3.slice(0, 5).map((row, i) => <li key={row.name} className={row.you ? "you" : ""}><span>{i + 1}. {row.name}</span><b>★ {row.fame}</b></li>)}</ol>
            <p className="fg-small">Season fund so far {rf(world.season)} · paid weekly 50/30/20 to the top guilds.</p>
          </div>
        </div>
      </div>}

      {tab === "tavern" && <>
        <div className="fg-bar">
          <p>Hire up to {TEAM_SIZE} Friends for your next expedition. Every fee: <b>{SPLIT.owner}% → the Friend's wallet</b> · <b className="burn">{SPLIT.burn}% burned</b> · {SPLIT.season}% season fund. Prices rise +5% per recent hire. Generation sets the value: Gen 1 costs ×3 for +50% expedition power.</p>
          <button type="button" disabled={paused} onClick={refreshBoard}>Refresh board</button>
        </div>
        <div className="fg-mercs">
          {board.map(index => { const m = mercs[index]; if (!m) return null; const fee = mercFee(m), taken = hired.includes(index);
            const favored = zone?.favored.includes(m.family);
            return <div key={String(m.id)} className={`fg-card fg-merc${taken ? " taken" : ""}`} style={{ borderColor: THEMES[m.family].accent }}>
              <div className="fg-row">
                <Portrait sprites={m.sprites} scale={3} halo={THEMES[m.family].accent} label={`Friend number ${m.id}`} />
                <div><strong>#{String(m.id)}</strong><TierBadge tier={m.tier} /><span>{FAMILY_NAMES[m.family]} · {FAMILY_TRAIT[m.family]}</span>{favored && <span className="fg-fav">★ favoured in {THEMES[zone!.family].floorName}</span>}</div>
              </div>
              <StatBars stats={m.stats} />
              <div className="fg-price"><b>{rf(fee)}</b>{m.demand >= 0.5 && <span className="up">▲ {Math.round(((1.05 ** m.demand) - 1) * 100)}%</span>}<small>earned {rf(m.earned)}</small></div>
              <button type="button" className={taken ? "" : "fg-primary"} disabled={paused || taken || hired.length >= TEAM_SIZE || balance < fee || !!run}
                onClick={() => hire(index)}>{taken ? "Hired ✓" : `Hire · ${rf(fee)}`}</button>
            </div>; })}
        </div>
      </>}

      {tab === "expedition" && <div className="fg-exp">
        {!run && <>
          <div className="fg-zones">{zones.map((z, i) => <button key={i} type="button" className={`fg-zone${i === zoneIndex ? " on" : ""}`} style={{ borderColor: THEMES[z.family].accent }}
            disabled={paused} aria-pressed={i === zoneIndex} onClick={() => setZoneIndex(i)}>
            <small>Tier {z.tier}</small><b>{THEMES[z.family].floorName}</b><span>{FAMILY_NAMES[z.family]} lands</span>
            <span>Favours {z.favored.map(f => FAMILY_NAMES[f]).join(" & ")}</span>
            <span className="fg-chance">{Math.round(successChance(z, team, level) * 100)}% success</span>
          </button>)}</div>
          <div className="fg-card fg-team">
            <h3>Your team</h3>
            <div className="fg-row">
              <Portrait sprites={player} scale={3} label="Your Friend" />
              {Array.from({ length: TEAM_SIZE }, (_, slot) => { const m = mercs[hired[slot]];
                return m ? <Portrait key={slot} sprites={m.sprites} scale={3} halo="#ccff00" label={`Hired Friend ${m.id}`} />
                  : <button key={slot} type="button" className="fg-empty" disabled={paused} onClick={() => setTab("tavern")}>+ hire</button>; })}
              <div className="fg-launch">
                <p>{zone && <>Success chance <b>{Math.round(chance * 100)}%</b> · reward about {zone.tier * 12}–{zone.tier * 20} shards, {zone.tier * 10} fame</>}</p>
                <button type="button" className="fg-primary" disabled={paused || !zone} onClick={launch}>Launch expedition</button>
              </div>
            </div>
            <p className="fg-small">Expeditions never pay RF: they bring Shards, fame and sometimes gear. Demo speed: {zone ? 12 + zone.tier * 3 : 15}s per run.</p>
          </div>
        </>}
        {run && <div className="fg-card fg-run">
          <canvas ref={sceneRef} width={SCENE_W} height={SCENE_H} className="fg-scene" role="img"
            aria-label={`Expedition to ${THEMES[run.result.zone.family].floorName}. ${run.done ? (run.result.success ? "Success" : "Failed") : "In progress"}`} />
          {run.done ? <div className="fg-result" role="status">
            <p><b className={run.result.success ? "ok" : "bad"}>{run.result.success ? "Success" : "Failed"}</b> · +{run.result.shards} shards{run.result.fame ? ` · +${run.result.fame} fame` : ""}{run.result.gear ? ` · found ${run.result.gear.name} +${run.result.gear.bonus}` : ""}</p>
            <div className="fg-actions">
              <button type="button" className="fg-primary" disabled={paused} onClick={() => { setRun(null); }}>Back to zones</button>
              <button type="button" disabled={paused} onClick={() => { setRun(null); setTab("workshop"); }}>Workshop</button>
            </div>
          </div> : <div className="fg-actions"><button type="button" disabled={paused} onClick={finishRun}>Skip</button></div>}
        </div>}
      </div>}

      {tab === "workshop" && <div className="fg-grid2">
        <div className="fg-card">
          <h3>Guild hall · level {level}/{MAX_GUILD_LEVEL}</h3>
          <p>Each level adds +3% success on every expedition.</p>
          {level < MAX_GUILD_LEVEL ? <button type="button" className="fg-primary" disabled={paused || shards < upgradeCost(level).shards || balance < upgradeCost(level).rf} onClick={upgrade}>
            Upgrade · ◆ {upgradeCost(level).shards} + {rf(upgradeCost(level).rf)} (burned)</button> : <p><b>Max level</b></p>}
          <h3>Craft gear</h3>
          <p className="fg-small">◆ {CRAFT.shards} + {rf(CRAFT.rf)}, and the RF is burned. Gear raises your Friend's stats, and with them its hire fee.</p>
          <div className="fg-crafts">{STAT_KEYS.map(stat => <button key={stat} type="button" disabled={paused || shards < CRAFT.shards || balance < CRAFT.rf} onClick={() => craft(stat)}>
            {GEAR_NAMES[stat]}<small>+2 {STAT_LABEL[stat]}</small></button>)}</div>
        </div>
        <div className="fg-card">
          <h3>Gear · {equipped.length}/{GEAR_SLOTS} equipped</h3>
          {gear.length ? <ul className="fg-gear">{gear.map(item => <li key={item.id}>
            <span>{item.name} <small>+{item.bonus} {STAT_LABEL[item.stat]}</small></span>
            <button type="button" disabled={paused || (!equipped.includes(item.id) && equipped.length >= GEAR_SLOTS)} onClick={() => toggleEquip(item.id)}>{equipped.includes(item.id) ? "Unequip" : "Equip"}</button>
          </li>)}</ul> : <p className="fg-small">No gear yet. Craft some, or find it on tier 2+ expeditions.</p>}
          <h3>Your RF this session <span className="fg-sim">SIMULATED</span></h3>
          <table className="fg-table"><tbody>
            <tr><td>Spent</td><td>{rf(ledger.spent)}</td></tr>
            <tr><td>→ to Friends' wallets</td><td>{rf(ledger.toOwners)}</td></tr>
            <tr><td>→ burned</td><td>{rf(ledger.burned)}</td></tr>
            <tr><td>→ season fund</td><td>{rf(ledger.season)}</td></tr>
            <tr><td>Earned by your Friend</td><td>{rf(me.earned)}</td></tr>
          </tbody></table>
        </div>
      </div>}

      {tab === "economy" && <div className="fg-econ">
        <div className="fg-card fg-params">
          <h3>Economy simulator <span className="fg-sim">SIMULATED</span></h3>
          <p className="fg-small">An agent-based model: players run expeditions, hire from 8-Friend boards by value for money, craft with Shards (burning RF), and fees rise with demand then fade.</p>
          <div className="fg-scenarios" role="group" aria-label="Scenario presets">
            <span>Scenarios</span>
            {SCENARIOS.map(sc => <button key={sc.id} type="button" aria-pressed={scenario === sc.id} className={scenario === sc.id ? "on" : ""} title={sc.about}
              disabled={paused || econBusy} onClick={() => pickScenario(sc.id)}>{sc.label}</button>)}
          </div>
          <p className="fg-small">{scenario === "custom" ? "Custom parameters." : `${SCENARIOS.find(sc => sc.id === scenario)!.label}: ${SCENARIOS.find(sc => sc.id === scenario)!.about}.`}</p>
          <div className="fg-controls">
            <label>Players <select value={econParams.players} disabled={paused} onChange={e => setEconParams(p => ({ ...p, players: Number(e.target.value) }))}>{[100, 1000, 5000].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Join %/day <select value={econParams.growthPct} disabled={paused} onChange={e => setParam({ growthPct: Number(e.target.value) })}>{[0, 0.5, 1, 2, 5, 7].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Leave %/day <select value={econParams.churnPct} disabled={paused} onChange={e => setParam({ churnPct: Number(e.target.value) })}>{[0, 1, 2, 3.5, 5].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Expeditions/day <select value={econParams.expeditionsPerDay} disabled={paused} onChange={e => setParam({ expeditionsPerDay: Number(e.target.value) })}>{[1, 2, 3, 4, 6].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Whales <select value={econParams.whaleShare} disabled={paused} onChange={e => setParam({ whaleShare: Number(e.target.value) })}>{[0, 0.02, 0.05, 0.1].map(v => <option key={v} value={v}>{v * 100}% (×{econParams.whaleMult})</option>)}</select></label>
            <label>Bots <select value={econParams.botShare} disabled={paused} onChange={e => setParam({ botShare: Number(e.target.value) })}>{[0, 0.02, 0.05, 0.1].map(v => <option key={v} value={v}>{v * 100}%</option>)}</select></label>
            <label>Hire cap <select value={econParams.hireCap} disabled={paused} onChange={e => setParam({ hireCap: Number(e.target.value) })}>{[0, 1, 3, 5].map(v => <option key={v} value={v}>{v ? `${v}/Friend/day` : "none"}</option>)}</select></label>
            <label>Burn % <select value={econParams.burnPct} disabled={paused} onChange={e => { const burn = Number(e.target.value); setParam({ burnPct: burn, ownerPct: Math.min(econParams.ownerPct, 100 - burn - econParams.seasonPct) }); }}>{[10, 15, 20, 25, 30, 40].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>To owner % <select value={econParams.ownerPct} disabled={paused} onChange={e => { const owner = Number(e.target.value); setParam({ ownerPct: owner, seasonPct: Math.max(0, 100 - owner - econParams.burnPct) }); }}>{[50, 60, 70, 80].filter(v => v + econParams.burnPct <= 100).map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Price step <select value={econParams.priceStep} disabled={paused} onChange={e => setParam({ priceStep: Number(e.target.value) })}>{[0, 0.025, 0.05, 0.1].map(v => <option key={v} value={v}>+{v * 100}%</option>)}</select></label>
            <button type="button" className="fg-primary" disabled={paused || econBusy} onClick={() => runEcon()}>{econBusy ? "Simulating…" : "Run 30 days"}</button>
          </div>
          <p className="fg-small">Split: {econParams.ownerPct}% owner · {econParams.burnPct}% burn · {100 - econParams.ownerPct - econParams.burnPct}% season.{econParams.botShare > 0 ? ` Bots spend ${econParams.botBudget} RF a day each hiring their own Friend.` : ""}</p>
        </div>
        <FlowDiagram owner={econParams.ownerPct} burn={econParams.burnPct} season={100 - econParams.ownerPct - econParams.burnPct} />
        {econ && <>
          <div className="fg-tiles">
            <div><small>RF spent</small><b>{Math.round(econ.totals.spent).toLocaleString("en-US")}</b></div>
            <div><small>RF burned 🔥</small><b className="burn">{Math.round(econ.totals.burned).toLocaleString("en-US")}</b></div>
            <div><small>RF to Friend owners</small><b>{Math.round(econ.totals.toOwners).toLocaleString("en-US")}</b></div>
            <div><small>Avg listed Friend earns</small><b>{round1(econ.totals.perFriendPerDay)} RF/day</b><small>players spend {round1(econ.totals.spendPerPlayerDay)} RF/day</small></div>
            <div><small>Active players</small><b>{econ.totals.playersStart.toLocaleString("en-US")} → {econ.totals.playersEnd.toLocaleString("en-US")}</b></div>
            <div><small>Gen 1 vs Gen 6 Friend earns</small><b>{round1(econ.totals.perFriendDayByGen[1] ?? 0)} vs {round1(econ.totals.perFriendDayByGen[6] ?? 0)}</b><small>RF/day (generation sets the value)</small></div>
            <div><small>Top 10% of Friends' share</small><b>{Math.round((econ.days.at(-1)?.top10Share ?? 0) * 100)}%</b></div>
            <div><small>RF minted by the game</small><b>0 {econ.conserved ? "✓" : "✗"}</b></div>
          </div>
          <div className="fg-charts">
            <Chart title="Active players" values={econ.days.map(d => d.players)} color="#eeeeea" format={compact} />
            <Chart title="RF burned per day" values={econ.days.map(d => d.burned)} color="#ff8a4c" format={compact} />
            <Chart title="RF earned per listed Friend per day" values={econ.days.map(d => d.perFriend)} color="#ccff00" format={v => v < 100 ? v.toFixed(1) : compact(v)} />
            <Chart title="RF to owners, cumulative" values={econ.days.map(d => d.ownersTotal)} color="#ccff00" format={compact} />
            <Chart title="Average hire fee (RF)" values={econ.days.map(d => d.avgFee)} color="#6fd0ff" format={v => v.toFixed(1)} />
            <Chart title="Shards held per active player" values={econ.days.map(d => d.shardsPerPlayer)} color="#c9a7ff" format={compact} />
          </div>
          {econRun && <p className="fg-summary" role="status" aria-live="polite">{summarize(econRun)}</p>}
          <p className="fg-small">Conservation check: every RF spent ends up with a Friend owner, burned, or in the season fund ({econ.conserved ? "holds" : "FAILS"}). Shards are never redeemable for RF.</p>
        </>}
      </div>}
    </main>

    {menu === "settings" && <GameMenu title="Settings" onClose={() => setMenu(null)}>
      <label><input type="checkbox" checked={muted} disabled={paused} onChange={e => setMuted(e.target.checked)} /> Mute sound</label>
      <label><input type="checkbox" checked={musicOn && !muted} disabled={paused || muted} onChange={e => setMusicOn(e.target.checked)} /> Music (chiptune)</label>
      <label><input type="checkbox" checked={reducedMotion} disabled={paused} onChange={e => setReducedMotion(e.target.checked)} /> Reduce motion (no scrolling, lunges or shake)</label>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => setMenu(null)}>Back</button>
    </GameMenu>}
    {menu === "help" && <GameMenu title="How Friend Guild works" onClose={() => setMenu(null)}>
      <ul className="fg-list">
        <li><b>Your Friend runs a guild.</b> Hire up to {TEAM_SIZE} real Friends in the Tavern, then send them on an Expedition with yours.</li>
        <li><b>Every hire pays the hired Friend.</b> {SPLIT.owner}% of the fee goes to that Friend's own wallet, {SPLIT.burn}% is burned, and {SPLIT.season}% goes to the weekly season fund.</li>
        <li><b>List your Friend</b> and other guilds hire it too. Its fee follows its stats and rises with demand.</li>
        <li><b>Generation sets the value.</b> A Friend's fee is multiplied by its tier: Gen 1 Legendary ×3, Gen 2 Epic ×2, Gen 3 Rare ×1.5, Gen 4 Uncommon ×1.25, Gen 5 Common ×1.1, Gen 6+ ×1. Expedition power grows by a quarter of that (Gen 1: +50%).</li>
        <li><b>Expeditions never create RF.</b> They bring Shards, fame and gear. Shards plus RF buy upgrades and gear in the Workshop, and that RF is burned.</li>
        <li><b>Economy tab:</b> simulate 30 days of the whole economy, try scenario presets (bear market, hype, whales, bot attack) and other parameters. A diagram there shows where every RF goes.</li>
      </ul>
      <p className="fg-small">Prototype: all RF, balances, hires, other guilds and earnings are SIMULATED. No RF moves and no transaction is requested.</p>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => setMenu(null)}>Got it</button>
    </GameMenu>}
  </section>;
}
