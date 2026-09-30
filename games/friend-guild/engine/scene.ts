/**
 * Expedition animation and small economy charts, drawn on canvas from code.
 *
 * Presentation only: every fight is a replay of the already-decided ExpeditionResult (who won each encounter and
 * its shards). Hit order, damage numbers and HP bars are derived deterministically from that result, so a frame
 * depends only on (result, team, t) and the animation always matches the outcome. Nothing here touches the economy.
 */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { drawFriend, type Pose } from "./sprites";
import type { ExpeditionResult } from "./guild";
import type { Sfx } from "./audio";
import { THEMES, type FamilyId } from "./themes";

export const SCENE_W = 960, SCENE_H = 300;

/** Encounter windows as fractions of the run: [start, end], with short walks between them. */
const WINDOWS = [[0.04, 0.25], [0.28, 0.49], [0.52, 0.73], [0.76, 0.97]] as const;
const LAST_END = WINDOWS[3][1];
/** Inside a window (fractions of it): the foe walks in, then attacks alternate, one BEAT each, hitting at HIT. */
const ENTER = 0.14, FIGHT = 0.16, BEAT = 0.1, HIT = 0.35;
/** Families that shoot (Mask, Asymmetry, Hoverer, Sparkling); the rest close in and strike. */
const RANGED: ReadonlySet<number> = new Set([1, 4, 5, 7]);
const FEET = 262, SCALE = 4, FOE_X = 640, FOE_IN = 900, TEAM_X = 330, TEAM_DX = 90, REACH = 86;
const LABEL_Y = 116, BAR_Y = 124, BANNER_Y = 76;
const homeX = (i: number) => TEAM_X - i * TEAM_DX;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - (1 - v) * (1 - v);
const ENCOUNTER_TEXT = ["ENCOUNTER 1/4", "ENCOUNTER 2/4", "ENCOUNTER 3/4", "ENCOUNTER 4/4"];

type Beat = {
  /** True: a team member attacks the foe. False: the foe attacks a team member. */
  team: boolean;
  /** The attacking member (team beats) or the member hit (foe beats). */
  member: number;
  ranged: boolean; text: string; big: boolean; kill: boolean;
  /** Target HP as a fraction, before and after the hit. */
  before: number; after: number;
  start: number;
};
type Fight = { beats: Beat[]; end: number; foeLabel: string; seed: number };

/** Integer hash to [0, 1): stable per encounter, no RNG state. */
function unit(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Split `total` whole points into `n` hits, the last one heavier (the finisher). */
function splitHits(total: number, n: number, seed: number) {
  const weights: number[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) { const w = (0.7 + unit(seed, k) * 0.6) * (k === n - 1 ? 1.6 : 1); weights.push(w); sum += w; }
  const out: number[] = [];
  let acc = 0, given = 0;
  for (let k = 0; k < n; k++) { acc += weights[k]; const upto = Math.round(total * acc / sum); out.push(Math.max(1, upto - given)); given = Math.max(given + 1, upto); }
  return out;
}

function buildFights(result: ExpeditionResult, team: readonly GenerationSprites[]): Fight[] {
  const n = Math.max(1, team.length), tier = result.zone.tier;
  return result.encounters.map((encounter, i) => {
    const seed = Number(encounter.foe.tokenId % 1000003n) * 31 + i * 7919 + result.shards;
    const foeMax = 24 + tier * 12 + Math.floor(unit(seed, 99) * 10), teamMax = 30 + tier * 10 + n * 14;
    // A won encounter ends on the team's finisher, a lost one on the foe's.
    const order = encounter.won ? "TFTFT" : "TFTFTF";
    const teamHits = splitHits(encounter.won ? foeMax : Math.round(foeMax * (0.35 + 0.4 * unit(seed, 98))), 3, seed);
    const foeHits = splitHits(encounter.won ? Math.round(teamMax * (0.2 + 0.45 * unit(seed, 97))) : teamMax, encounter.won ? 2 : 3, seed + 1);
    const foeRanged = RANGED.has(encounter.foe.familyId);
    let foeHp = foeMax, teamHp = teamMax, ti = 0, fi = 0;
    const beats: Beat[] = [];
    for (let b = 0; b < order.length; b++) {
      const isTeam = order[b] === "T", k = isTeam ? ti++ : fi++, member = k % n;
      const dmg = isTeam ? teamHits[k] : foeHits[k], max = isTeam ? foeMax : teamMax;
      const before = (isTeam ? foeHp : teamHp) / max;
      if (isTeam) foeHp = Math.max(0, foeHp - dmg); else teamHp = Math.max(0, teamHp - dmg);
      const kill = b === order.length - 1;
      const after = kill ? 0 : Math.max(0.04, (isTeam ? foeHp : teamHp) / max);
      const big = kill || dmg >= max * 0.3;
      beats.push({
        team: isTeam, member, ranged: isTeam ? RANGED.has(team[member]?.familyId ?? 0) : foeRanged,
        text: big ? `${dmg}!` : `${dmg}`, big, kill, before, after, start: FIGHT + b * BEAT,
      });
    }
    return { beats, end: FIGHT + order.length * BEAT, foeLabel: `Friend #${encounter.foe.tokenId}`, seed };
  });
}

/** The plan for the run on screen (one entry: a run's frames all share it). */
let cache: { result: ExpeditionResult; team: readonly GenerationSprites[]; fights: Fight[] } | null = null;
function plan(result: ExpeditionResult, team: readonly GenerationSprites[]) {
  if (!cache || cache.result !== result || cache.team !== team) cache = { result, team, fights: buildFights(result, team) };
  return cache.fights;
}

export function sceneState(result: ExpeditionResult, t: number) {
  const p = Math.min(1, t / result.duration);
  let index = -1, resolved = 0;
  for (let i = 0; i < WINDOWS.length; i++) { if (p >= WINDOWS[i][0] && p < WINDOWS[i][1]) index = i; if (p >= WINDOWS[i][1]) resolved++; }
  return { p, index, resolved };
}

/** Fight sounds whose moment falls in (from, to] seconds of a run: deterministic, like the drawing. */
export function sceneCues(result: ExpeditionResult, team: readonly GenerationSprites[], from: number, to: number, emit: (sfx: Sfx) => void) {
  if (to <= from) return;
  const fights = plan(result, team), d = result.duration;
  for (let i = 0; i < WINDOWS.length; i++) {
    const a = WINDOWS[i][0] * d, span = (WINDOWS[i][1] - WINDOWS[i][0]) * d;
    if (a > to) break;
    if (a + span < from) continue;
    const fight = fights[i];
    for (const beat of fight.beats) {
      const start = a + beat.start * span, hit = a + (beat.start + HIT * BEAT) * span;
      if (start > from && start <= to) emit(beat.ranged ? "shoot" : "swing");
      if (hit > from && hit <= to) emit(beat.kill ? (beat.team ? "kill" : "hurt") : beat.team ? "hit" : "ouch");
    }
    const open = a + (fight.end + 0.12) * span;
    if (result.encounters[i].won && open > from && open <= to) emit("pickup");
  }
}

// Per-frame scratch (no allocations while animating).
const MAX_TEAM = 8;
const offX = new Float64Array(MAX_TEAM), flash = new Uint8Array(MAX_TEAM);
const pose: Pose = { facing: "right", side: "right", walking: false, frame: 0 };

function shadow(ctx: CanvasRenderingContext2D, x: number, alpha: number) {
  ctx.fillStyle = alpha < 1 ? `rgba(0,0,0,${(0.25 * alpha).toFixed(2)})` : "rgba(0,0,0,.25)";
  ctx.beginPath(); ctx.ellipse(x, FEET, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
}

/** A Friend, optionally with a white silhouette drawn over it (hit flash; canonical pixels untouched). */
function friend(ctx: CanvasRenderingContext2D, sprites: GenerationSprites, x: number, halo: string, alpha: number, white: boolean, angle: number) {
  if (angle !== 0) {
    ctx.save(); ctx.translate(Math.round(x), FEET); ctx.rotate(angle);
    drawFriend(ctx, sprites, 0, 0, pose, SCALE, "#000000", halo, alpha);
    if (white) drawFriend(ctx, sprites, 0, 0, pose, SCALE, "#ffffff", "#ffffff", alpha);
    ctx.restore();
    return;
  }
  drawFriend(ctx, sprites, x, FEET, pose, SCALE, "#000000", halo, alpha);
  if (white) drawFriend(ctx, sprites, x, FEET, pose, SCALE, "#ffffff", "#ffffff", alpha);
}

function bar(ctx: CanvasRenderingContext2D, cx: number, width: number, value: number, ghost: number, color: string) {
  const x = Math.round(cx - width / 2);
  ctx.fillStyle = "#000"; ctx.fillRect(x - 3, BAR_Y - 3, width + 6, 16);
  ctx.fillStyle = "#3a1418"; ctx.fillRect(x, BAR_Y, width, 10);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, BAR_Y, Math.round(width * ghost), 10);
  ctx.fillStyle = color; ctx.fillRect(x, BAR_Y, Math.round(width * value), 10);
  ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x, BAR_Y, Math.round(width * value), 3);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = "#000"; ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/** A small pixel chest at (x, feet y): closed, or open with a glow. */
function chest(ctx: CanvasRenderingContext2D, x: number, y: number, open: boolean) {
  ctx.fillStyle = "#000"; ctx.fillRect(x - 24, y - (open ? 44 : 34), 48, open ? 44 : 34);
  ctx.fillStyle = "#8a5a2b"; ctx.fillRect(x - 20, y - 22, 40, 20);
  ctx.fillStyle = "#5e3b1a"; ctx.fillRect(x - 20, y - 6, 40, 4);
  ctx.fillStyle = "#ffcc33"; ctx.fillRect(x - 3, y - 22, 6, 20);
  if (open) {
    ctx.fillStyle = "#fff3a0"; ctx.fillRect(x - 18, y - 26, 36, 4);
    ctx.fillStyle = "#a86d34"; ctx.fillRect(x - 22, y - 40, 44, 10);
    ctx.fillStyle = "#ffcc33"; ctx.fillRect(x - 3, y - 40, 6, 10);
  } else {
    ctx.fillStyle = "#a86d34"; ctx.fillRect(x - 22, y - 30, 44, 10);
    ctx.fillStyle = "#ffcc33"; ctx.fillRect(x - 3, y - 30, 6, 10); ctx.fillRect(x - 4, y - 22, 8, 6);
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D, result: ExpeditionResult, team: readonly GenerationSprites[], t: number, reducedMotion: boolean,
) {
  const theme = THEMES[result.zone.family as FamilyId];
  const fights = plan(result, team);
  const { p, index, resolved } = sceneState(result, t);
  const n = Math.min(MAX_TEAM, team.length);
  const fight = index >= 0 ? fights[index] : null;
  const encounter = index >= 0 ? result.encounters[index] : null;
  const u = index >= 0 ? (p - WINDOWS[index][0]) / (WINDOWS[index][1] - WINDOWS[index][0]) : 0;
  const lastLost = resolved === 4 && !result.encounters[3].won;
  const walking = index < 0 && p < 1 && !lastLost;

  // Fight state for this frame: who moves, who flashes, HP, shake.
  for (let i = 0; i < n; i++) { offX[i] = 0; flash[i] = 0; }
  let foeOff = 0, foeFlash = false, shakeX = 0, shakeY = 0;
  let foeHp = 1, foeGhost = 1, teamHp = 1, teamGhost = 1;
  if (fight) for (const beat of fight.beats) {
    const v = (u - beat.start) / BEAT;
    if (v < 0) break;
    if (v >= HIT) {
      const ghost = v - HIT < 0.1 ? beat.before : beat.before + (beat.after - beat.before) * clamp01((v - HIT - 0.1) / 0.3);
      if (beat.team) { foeHp = beat.after; foeGhost = ghost; } else { teamHp = beat.after; teamGhost = ghost; }
    }
    if (v > 1) continue;
    const m = beat.member;
    if (!reducedMotion) {
      if (beat.ranged) {
        const recoil = v > 0.04 && v < 0.2 ? 6 : 0;
        if (beat.team) offX[m] -= recoil; else foeOff += recoil;
      } else {
        const reach = v < HIT ? easeOut(v / HIT) : v < 0.5 ? 1 : v < 0.85 ? 1 - easeOut((v - 0.5) / 0.35) : 0;
        if (beat.team) offX[m] += (FOE_X - REACH - homeX(m)) * reach; else foeOff += (homeX(m) + REACH - FOE_X) * reach;
      }
      if (v >= HIT && v < HIT + 0.35) {
        const knock = (beat.big ? 20 : 11) * (1 - (v - HIT) / 0.35);
        if (beat.team) foeOff += knock; else offX[m] -= knock;
      }
      if (beat.big && v >= HIT && v < HIT + 0.22) {
        const amp = (beat.kill ? 8 : 5) * (1 - (v - HIT) / 0.22);
        shakeX = Math.round(Math.sin(t * 97) * amp); shakeY = Math.round(Math.cos(t * 71) * amp * 0.5);
      }
    }
    if (v >= HIT && v < HIT + 0.12) { if (beat.team) foeFlash = true; else flash[m] = 1; }
  }

  // Team knocked out (and, between encounters, getting back up).
  let fall = 0, teamAlpha = 1;
  if (fight && encounter && !encounter.won) fall = u - fight.end;
  else if (index < 0 && resolved > 0 && !result.encounters[resolved - 1].won) {
    if (resolved === 4) fall = 1;
    else teamAlpha = 0.3 + 0.7 * clamp01((p - WINDOWS[resolved - 1][1]) / (WINDOWS[resolved][0] - WINDOWS[resolved - 1][1]));
  }

  // Distance travelled pauses during encounters.
  let travelled = 0;
  { let last = 0; for (let i = 0; i < WINDOWS.length; i++) { travelled += Math.max(0, Math.min(p, WINDOWS[i][0]) - last); last = WINDOWS[i][1]; if (p < last) break; } if (p > LAST_END && !lastLost) travelled += p - LAST_END; }
  const scroll = reducedMotion ? 0 : travelled * 2600;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.setTransform(1, 0, 0, 1, shakeX, shakeY);
  ctx.fillStyle = theme.wall; ctx.fillRect(-12, -12, SCENE_W + 24, 182);
  ctx.fillStyle = theme.wallDetail;
  for (let i = 0; i < 16; i++) { const x = ((i * 97 - scroll * 0.5) % 1100 + 1100) % 1100 - 70; ctx.fillRect(x, 40 + (i % 3) * 22, 60, 10); }
  ctx.fillStyle = theme.floor; ctx.fillRect(-12, 170, SCENE_W + 24, 142);
  ctx.fillStyle = theme.floorDetail;
  for (let i = 0; i < 14; i++) { const x = ((i * 83 - scroll) % 1160 + 1160) % 1160 - 80; ctx.fillRect(x, 200 + (i % 4) * 22, 46, 8); }
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(-12, 170, SCENE_W + 24, 6);
  const frame = reducedMotion ? 0 : Math.floor(t * 9) % 8;

  // Team: your Friend leads (white halo), mercenaries follow (green halo).
  pose.facing = "right"; pose.side = "right"; pose.walking = walking; pose.frame = frame;
  for (let i = 0; i < n; i++) {
    const s = clamp01((fall - i * 0.03) / 0.12);
    const alpha = teamAlpha * (1 - 0.7 * s), angle = reducedMotion ? 0 : -s * Math.PI / 2;
    const x = homeX(i) + offX[i];
    shadow(ctx, x, alpha);
    friend(ctx, team[i], x, i === 0 ? "#ffffff" : "#ccff00", alpha, flash[i] === 1, angle);
  }

  if (fight && encounter) {
    const foeX = (u < ENTER ? FOE_IN - (FOE_IN - FOE_X) * easeOut(u / ENTER) : FOE_X);
    const gone = encounter.won ? clamp01((u - fight.end) / 0.12) : 0;
    const foeAlpha = 1 - gone;
    if (foeAlpha > 0) {
      pose.facing = "left"; pose.side = "left"; pose.walking = u < ENTER;
      shadow(ctx, foeX + foeOff, foeAlpha);
      friend(ctx, encounter.foe, foeX + foeOff, theme.accent, foeAlpha, foeFlash, 0);
    }

    // Projectiles and impact sparks.
    for (const beat of fight.beats) {
      const v = (u - beat.start) / BEAT;
      if (v < 0) break;
      if (v > HIT + 0.16) continue;
      const m = beat.member;
      if (beat.ranged && v >= 0.08 && v < HIT) {
        const s = (v - 0.08) / (HIT - 0.08);
        const from = beat.team ? homeX(m) + offX[m] + 26 : foeX + foeOff - 26, to = beat.team ? foeX - 12 : homeX(m) + 12;
        const px = from + (to - from) * s, py = FEET - 40 - Math.sin(s * Math.PI) * 24, dir = beat.team ? -1 : 1;
        ctx.fillStyle = beat.team ? THEMES[(team[m]?.familyId ?? 0) as FamilyId].accent : theme.accent;
        ctx.fillRect(px + dir * 22 - 3, py - 3, 6, 6); ctx.fillRect(px + dir * 12 - 4, py - 4, 8, 8);
        ctx.fillStyle = "#000"; ctx.fillRect(px - 7, py - 7, 14, 14);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(px - 5, py - 5, 10, 10);
      }
      if (v >= HIT && v < HIT + 0.16) {
        const s = (v - HIT) / 0.16, cx = beat.team ? foeX + foeOff - 10 : homeX(m) + offX[m] + 10, cy = FEET - 40, r = 10 + 26 * s, size = beat.big ? 8 : 6;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(cx - r - size / 2, cy - size / 2, size, size); ctx.fillRect(cx + r - size / 2, cy - size / 2, size, size);
        ctx.fillRect(cx - size / 2, cy - r - size / 2, size, size); ctx.fillRect(cx - size / 2, cy + r - size / 2, size, size);
      }
    }

    // Foe defeated: a pixel burst, then loot.
    if (encounter.won && u >= fight.end) {
      const s = (u - fight.end) / 0.16;
      if (!reducedMotion && s < 1) {
        const e = easeOut(s);
        for (let k = 0; k < 18; k++) {
          const angle = (k / 18) * Math.PI * 2 + unit(fight.seed, k) * 0.35, dist = (60 + 90 * unit(fight.seed, k + 40)) * e;
          const size = Math.round(8 * (1 - s) + 2);
          ctx.fillStyle = k % 3 === 0 ? theme.accent : k % 3 === 1 ? "#ffffff" : theme.wallDetail;
          ctx.fillRect(Math.round(FOE_X + Math.cos(angle) * dist - size / 2), Math.round(FEET - 36 + Math.sin(angle) * dist + 50 * s * s - size / 2), size, size);
        }
      }
      const c = u - (fight.end + 0.04);
      if (c >= 0) {
        const hop = reducedMotion ? 0 : Math.round(-Math.sin(clamp01(c / 0.1) * Math.PI) * 26);
        const open = u >= fight.end + 0.12;
        chest(ctx, FOE_X, FEET + hop, open);
        if (open) {
          const count = clamp01((u - fight.end - 0.12) / 0.14);
          if (!reducedMotion) {
            ctx.fillStyle = "#fff3a0";
            for (let k = 0; k < 5; k++) { const y = FEET - 50 - ((t * 60 + k * 17) % 40); ctx.fillRect(FOE_X - 16 + k * 8, Math.round(y), 4, 4); }
          }
          ctx.font = "bold 24px ui-monospace, monospace"; ctx.textAlign = "center";
          const shown = Math.round(encounter.shards * count);
          label(ctx, `+${shown} ${shown === 1 ? "shard" : "shards"}`, FOE_X, Math.round(FEET - 62 - (reducedMotion ? 0 : 10 * count)), "#ccff00");
        }
      }
    }

    // HUD: names, HP bars, damage numbers, verdict.
    ctx.textAlign = "center"; ctx.font = "bold 18px ui-monospace, monospace";
    if (foeAlpha > 0) {
      ctx.globalAlpha = foeAlpha;
      label(ctx, fight.foeLabel, foeX, LABEL_Y, "#ffffff");
      bar(ctx, foeX, 140, foeHp, foeGhost, "#ff5a6a");
      ctx.globalAlpha = 1;
    }
    const teamCx = (homeX(0) + homeX(n - 1)) / 2;
    label(ctx, "YOUR TEAM", teamCx, LABEL_Y, "#ffffff");
    bar(ctx, teamCx, Math.max(140, n * TEAM_DX + 20), teamHp, teamGhost, "#ccff00");
    for (const beat of fight.beats) {
      const v = (u - beat.start) / BEAT;
      if (v < 0) break;
      if (v < HIT || v > HIT + 0.95) continue;
      const s = (v - HIT) / 0.95;
      ctx.globalAlpha = 1 - clamp01((s - 0.55) / 0.45);
      ctx.font = beat.big ? "bold 30px ui-monospace, monospace" : "bold 22px ui-monospace, monospace";
      label(ctx, beat.text, beat.team ? foeX : homeX(beat.member), Math.round(FEET - 76 - (reducedMotion ? 0 : 22 * easeOut(s))), beat.team ? (beat.big ? "#ffe14d" : "#ffffff") : "#ff5a6a");
    }
    ctx.globalAlpha = 1;
    const decided = u >= fight.end;
    ctx.font = decided ? "bold 26px ui-monospace, monospace" : "bold 18px ui-monospace, monospace";
    label(ctx, decided ? (encounter.won ? "VICTORY" : "DEFEATED") : ENCOUNTER_TEXT[index], SCENE_W / 2, BANNER_Y, decided ? (encounter.won ? "#ccff00" : "#ff5a6a") : "#ffffff");
  }

  // Progress bar with four encounter pips (steady: not shaken).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(40, 16, SCENE_W - 80, 12);
  ctx.fillStyle = theme.accent; ctx.fillRect(40, 16, (SCENE_W - 80) * p, 12);
  for (let i = 0; i < WINDOWS.length; i++) {
    const x = 40 + (SCENE_W - 80) * WINDOWS[i][0];
    ctx.fillStyle = i < resolved ? (result.encounters[i].won ? "#ccff00" : "#ff5a6a") : "#ffffff";
    ctx.fillRect(x - 5, 12, 10, 20);
  }
  if (p >= 1) {
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    ctx.font = "bold 40px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillStyle = result.success ? "#ccff00" : "#ff5a6a";
    ctx.fillText(result.success ? "EXPEDITION SUCCESS" : "EXPEDITION FAILED", SCENE_W / 2, 150);
  }
}

/** One-series line chart: thin 2px line, recessive grid, hover crosshair handled by the caller. */
export function drawLineChart(
  ctx: CanvasRenderingContext2D, w: number, h: number, values: readonly number[], color: string, hover: number | null, format: (v: number) => string,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 56, r: 12, t: 10, b: 22 };
  const max = Math.max(1, ...values) * 1.08, n = values.length;
  const x = (i: number) => pad.l + (w - pad.l - pad.r) * (n <= 1 ? 0 : i / (n - 1));
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.lineWidth = 1; ctx.fillStyle = "#8a8a8a"; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "right";
  for (let k = 0; k <= 3; k++) {
    const v = (max / 1.08) * k / 3, yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(format(v), pad.l - 6, yy + 4);
  }
  ctx.textAlign = "center";
  [1, Math.ceil(n / 2), n].forEach(d => ctx.fillText(`d${d}`, x(d - 1), h - 6));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
  if (hover !== null && hover >= 0 && hover < n) {
    const hx = x(hover), hy = y(values[hover]);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, h - pad.b); ctx.stroke();
    ctx.fillStyle = "#0b0b0c"; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
  }
  return { hoverIndex: (px: number) => Math.max(0, Math.min(n - 1, Math.round((px - pad.l) / (w - pad.l - pad.r) * (n - 1)))) };
}
