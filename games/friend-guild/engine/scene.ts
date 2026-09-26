/** Expedition animation and small economy charts, drawn on canvas from code. */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { drawFriend } from "./sprites";
import type { ExpeditionResult } from "./guild";
import { THEMES, type FamilyId } from "./themes";

export const SCENE_W = 960, SCENE_H = 300;

/** Encounter windows as fractions of the run: [start, end]. */
const WINDOWS = [[0.14, 0.26], [0.36, 0.48], [0.58, 0.7], [0.8, 0.94]] as const;

export function sceneState(result: ExpeditionResult, t: number) {
  const p = Math.min(1, t / result.duration);
  const index = WINDOWS.findIndex(([a, b]) => p >= a && p < b);
  const resolved = WINDOWS.filter(([, b]) => p >= b).length;
  return { p, index, resolved };
}

export function drawScene(
  ctx: CanvasRenderingContext2D, result: ExpeditionResult, team: readonly GenerationSprites[], t: number, reducedMotion: boolean,
) {
  const theme = THEMES[result.zone.family as FamilyId];
  const { p, index, resolved } = sceneState(result, t);
  const walking = index < 0 && p < 1;
  // Distance travelled pauses during encounters.
  let travelled = 0;
  { let last = 0; for (const [a, b] of WINDOWS) { travelled += Math.max(0, Math.min(p, a) - last); last = b; if (p < b) break; } if (p > 0.94) travelled += p - 0.94; }
  const scroll = reducedMotion ? 0 : travelled * 2600;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = theme.wall; ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.fillStyle = theme.wallDetail;
  for (let i = 0; i < 16; i++) { const x = ((i * 97 - scroll * 0.5) % 1100 + 1100) % 1100 - 70; ctx.fillRect(x, 40 + (i % 3) * 22, 60, 10); }
  ctx.fillStyle = theme.floor; ctx.fillRect(0, 170, SCENE_W, 130);
  ctx.fillStyle = theme.floorDetail;
  for (let i = 0; i < 14; i++) { const x = ((i * 83 - scroll) % 1160 + 1160) % 1160 - 80; ctx.fillRect(x, 200 + (i % 4) * 22, 46, 8); }
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 170, SCENE_W, 6);
  const frame = reducedMotion ? 0 : Math.floor(t * 9) % 8;
  // Team: your Friend leads (white halo), mercenaries follow (green halo).
  team.forEach((sprites, i) => {
    const x = 330 - i * 90, y = 262;
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    drawFriend(ctx, sprites, x, y, { facing: "right", side: "right", walking, frame }, 4, "#000000", i === 0 ? "#ffffff" : "#ccff00");
  });
  // Encounter foe.
  const current = index >= 0 ? index : -1;
  if (current >= 0) {
    const encounter = result.encounters[current], [a, b] = WINDOWS[current];
    const local = (p - a) / (b - a);
    const enter = Math.min(1, local / 0.25);
    const x = 900 - enter * 280, y = 262;
    const decided = local > 0.65;
    const alpha = decided && encounter.won ? Math.max(0, 1 - (local - 0.65) / 0.35) : 1;
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    drawFriend(ctx, encounter.foe, x, y, { facing: "left", side: "left", walking: enter < 1, frame }, 4, "#000000", theme.accent, alpha);
    if (local > 0.3 && local < 0.65 && !reducedMotion && Math.floor(t * 12) % 2 === 0) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(430, 196, 6, 6); ctx.fillRect(470, 214, 8, 8); ctx.fillRect(450, 180, 5, 5);
    }
    ctx.font = "bold 22px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillStyle = "#000"; ctx.fillText(`Friend #${encounter.foe.tokenId}`, x + 1, 131);
    ctx.fillStyle = "#fff"; ctx.fillText(`Friend #${encounter.foe.tokenId}`, x, 130);
    if (decided) {
      ctx.font = "bold 26px ui-monospace, monospace";
      ctx.fillStyle = encounter.won ? "#ccff00" : "#ff5a6a";
      ctx.fillText(encounter.won ? `WON · +${encounter.shards} shards` : "DEFEATED", 480, 96);
    }
  }
  // Progress bar with four encounter pips.
  ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(40, 16, SCENE_W - 80, 12);
  ctx.fillStyle = theme.accent; ctx.fillRect(40, 16, (SCENE_W - 80) * p, 12);
  WINDOWS.forEach(([a], i) => {
    const x = 40 + (SCENE_W - 80) * a;
    ctx.fillStyle = i < resolved ? (result.encounters[i].won ? "#ccff00" : "#ff5a6a") : "#ffffff";
    ctx.fillRect(x - 5, 12, 10, 20);
  });
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
