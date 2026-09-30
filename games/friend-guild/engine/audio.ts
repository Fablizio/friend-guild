/** Tiny synthesized sound effects and chiptune music (no samples), plus the SDK sound kit for rewards. */
import { createFriendSoundKit, type FriendSoundKit, type FriendSoundCue } from "@rarefriends/friendsdk/sounds";
import { Music, type MusicTheme } from "./music";

/** Fight sounds come from the expedition scene (`sceneCues`); the rest are UI and reward cues. */
export type Sfx = "shoot" | "hit" | "kill" | "hurt" | "ouch" | "swing" | "pickup" | "win" | "lose";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private kit: FriendSoundKit = createFriendSoundKit({ volume: 0.6 });
  private last = new Map<Sfx, number>();
  /** One shared second of white noise; slices of it serve every hit and drum (no per-sound buffers). */
  private noiseBuffer: AudioBuffer | null = null;
  private want: { theme: MusicTheme | null; active: boolean } = { theme: null, active: false };
  music: Music | null = null;
  muted = false;
  musicOn = true;

  /** Create or resume the context. Call from a user gesture: nothing sounds before one. */
  async unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
        const length = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.music = new Music(this.ctx, this.noiseBuffer);
        this.music.setEnabled(!this.muted && this.musicOn);
        this.theme(this.want.theme, this.want.active);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      await this.kit.unlock();
      return true;
    } catch { return false; }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.kit.setMuted(muted);
    if (this.master && this.ctx) this.master.gain.setValueAtTime(muted ? 0 : 0.35, this.ctx.currentTime);
    this.music?.setEnabled(!muted && this.musicOn);
  }

  setMusic(on: boolean) { this.musicOn = on; this.music?.setEnabled(!this.muted && on); }

  /** Resume a context the browser suspended (iOS interruptions, a hidden tab). Cheap when already running. */
  wake() {
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
  }

  /** Suspend the whole context while the tab is hidden, so phones spend no CPU on silent audio. */
  setHidden(hidden: boolean) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    if (hidden && ctx.state === "running") void ctx.suspend().catch(() => {});
    else if (!hidden) this.wake();
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(master);
    osc.onended = () => gain.disconnect();
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, volume: number, cutoff: number) {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noiseBuffer; filter.type = "lowpass"; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, t); gain.gain.linearRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.onended = () => gain.disconnect();
    source.start(t, Math.random() * 0.5, duration);
  }

  play(sfx: Sfx) {
    if (this.muted || !this.ctx || this.ctx.state !== "running" || document.hidden) return;
    const now = performance.now(), gap = sfx === "shoot" || sfx === "swing" ? 60 : sfx === "hit" ? 45 : 30;
    if (now - (this.last.get(sfx) ?? 0) < gap) return;
    this.last.set(sfx, now);
    switch (sfx) {
      case "shoot": this.tone("triangle", 720, 420, 0.08, 0.12); break;
      case "swing": this.noise(0.07, 0.1, 5200); break;
      case "hit": this.noise(0.06, 0.2, 2400); this.tone("square", 220, 140, 0.05, 0.04); break;
      case "ouch": this.tone("square", 180, 95, 0.1, 0.07); this.noise(0.05, 0.12, 1200); break;
      case "kill": this.noise(0.18, 0.26, 1400); this.tone("square", 330, 80, 0.2, 0.07); break;
      case "hurt": this.tone("sawtooth", 200, 70, 0.3, 0.14); this.noise(0.15, 0.16, 900); break;
      case "pickup": this.tone("sine", 660, 990, 0.08, 0.16); this.tone("sine", 990, 1320, 0.08, 0.13, 0.07); break;
      case "win": this.kit.play("reveal-legendary"); break;
      case "lose": this.tone("triangle", 330, 110, 0.9, 0.2); break;
    }
  }

  /** SDK sound-kit cue (select, purchase, action-start, reward, reveal-rare, ...). */
  cue(id: FriendSoundCue) { if (!this.muted && !document.hidden) this.kit.play(id); }

  /** Which theme should play, and whether the game is on screen and running (not paused, hidden or blurred). */
  theme(theme: MusicTheme | null, active: boolean) {
    this.want = { theme, active };
    const music = this.music;
    if (!music) return;
    if (theme !== null) music.play(theme, false);
    music.setActive(active && theme !== null);
  }

  /** Victory jingle or defeat sting; false when music is off (the caller can fall back to a kit cue). */
  jingle(kind: "win" | "lose") { return this.music?.jingle(kind) ?? false; }

  dispose() {
    this.music?.dispose(); this.music = null;
    this.kit.dispose();
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.master = null;
  }
}
