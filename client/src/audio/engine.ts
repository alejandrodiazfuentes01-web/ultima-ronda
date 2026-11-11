/**
 * Sonido del juego, sintetizado en el navegador con la Web Audio API: no hay
 * archivos de audio. El contexto se crea al pulsar «Jugar», porque el navegador
 * no deja sonar nada antes del primer clic.
 */
import type { Game } from '../../../shared/sim/game';
import type { SimEvent, Vec3 } from '../../../shared/sim/types';
import { VoiceLimiter, nextVoiceTime, voiceKind, type VoiceKind } from './voices';

/** Volúmenes de mezcla (sonido, no balance). */
const MASTER = 0.6;
const MUSIC = 1;

/** Timbre de disparo por arma: frecuencia del chasquido, duración y golpe grave. */
const SHOT: Record<string, { freq: number; dur: number; gain: number; thump: number }> = {
  m1911: { freq: 1700, dur: 0.13, gain: 2.2, thump: 140 },
  smg5: { freq: 2500, dur: 0.07, gain: 1.5, thump: 170 },
  mk17: { freq: 1300, dur: 0.15, gain: 2.4, thump: 110 },
  m249: { freq: 1900, dur: 0.1, gain: 1.9, thump: 130 },
  svd: { freq: 1100, dur: 0.22, gain: 2.6, thump: 90 },
};

/** Notas en hercios. */
const NOTE = { G3: 196, C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, E5: 659.3, G5: 784, B5: 987.8, E6: 1318.5 };

/** Melodía corta de cada suero. */
const PERK_TUNE: Record<string, Array<[number, number]>> = {
  coraza: [
    [NOTE.G3, 0],
    [NOTE.C4, 0.14],
    [NOTE.G4, 0.28],
    [NOTE.C5, 0.42],
  ],
  segundoAliento: [
    [NOTE.E5, 0],
    [NOTE.G5, 0.1],
    [NOTE.B5, 0.2],
    [NOTE.E6, 0.3],
  ],
};
const DEFAULT_SHOT = { freq: 2000, dur: 0.1, gain: 1.8, thump: 150 };

/** Volumen de las sirenas de ronda. */
const SIREN = 0.26;

/** Margen para programar sonidos, en segundos. */
const SCHEDULE_AHEAD = 0.03;

/** Altura de la boca de un Vacío, para colocar su voz. */
const MOUTH_HEIGHT = 1.55;

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private musicPulse!: OscillatorNode;
  private noise!: AudioBuffer;
  private readonly nextVoice: number[] = [];
  private readonly limiter = new VoiceLimiter();
  private lastPointsSound = -1;

  /** Crea o reanuda el audio. Llamar desde un clic del jugador. */
  start(): void {
    try {
      if (!this.ctx) this.build(new AudioContext());
      void this.ctx!.resume();
    } catch {
      // Sin audio el juego sigue funcionando.
      this.ctx = null;
    }
  }

  /** Pausa todo el sonido (menú de pausa). */
  suspend(): void {
    void this.ctx?.suspend();
  }

  private build(ctx: Ctx): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    // Limitador final: por muchos disparos que coincidan, el sonido no satura.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.master.connect(comp).connect(limiter).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    // Ruido blanco reutilizable.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Música ambiental: un zumbido grave que se abre y late más rápido con cada ronda.
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 200;
    this.musicFilter.Q.value = 3;
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.6;
    this.musicPulse = ctx.createOscillator();
    this.musicPulse.frequency.value = 0.12;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.4;
    this.musicPulse.connect(pulseDepth).connect(pulseGain.gain);
    for (const [type, freq, detune, g] of [
      ['sawtooth', 55, -7, 0.35],
      ['sawtooth', 55, 6, 0.35],
      ['sine', 27.5, 0, 0.6],
      ['triangle', 82.4, 3, 0.15],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.musicFilter);
      o.start();
    }
    this.musicFilter.connect(pulseGain).connect(this.music).connect(this.master);
    this.musicPulse.start();
  }

  // ------------------------------------------------------------ bloques de síntesis

  /**
   * Momento en que empieza un sonido: un poco por delante del reloj de audio. Si se programa
   * justo en currentTime, el navegador ya ha preparado ese tramo y los sonidos cortos se pierden.
   */
  private get now(): number {
    return this.ctx!.currentTime + SCHEDULE_AHEAD;
  }

  /** Nodo de salida: posicional si se da una posición, si no, directo. */
  private out(pos?: Vec3, refDistance = 2): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.sfx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = 1.3;
    p.maxDistance = 50;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.sfx);
    setTimeout(() => p.disconnect(), 3000);
    return p;
  }

  private env(at: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  private noiseBurst(dest: AudioNode, at: number, o: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; attack?: number; dur: number; gain: number }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, at);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, at + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = this.env(at, o.attack ?? 0.003, o.dur, o.gain);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 1.5);
    src.stop(at + (o.attack ?? 0.003) + o.dur + 0.05);
  }

  private tone(dest: AudioNode, at: number, o: { type: OscillatorType; freq: number; freqEnd?: number; attack?: number; dur: number; gain: number }): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, at + (o.attack ?? 0.005) + o.dur);
    const g = this.env(at, o.attack ?? 0.005, o.dur, o.gain);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + (o.attack ?? 0.005) + o.dur + 0.05);
  }

  // ------------------------------------------------------------ sonidos

  private shot(weapon: string, upgraded: boolean): void {
    const t = this.now;
    if (weapon === 'arco') {
      this.zap(t, 0.5);
      return;
    }
    const s = SHOT[weapon] ?? DEFAULT_SHOT;
    // Arma mejorada en La Forja: un brillo agudo encima del disparo.
    if (upgraded) this.tone(this.sfx, t, { type: 'sawtooth', freq: 1800, freqEnd: 900, dur: 0.08, gain: 0.08 });
    this.noiseBurst(this.sfx, t, { type: 'bandpass', freq: s.freq, freqEnd: s.freq * 0.4, q: 0.7, dur: s.dur, gain: s.gain });
    this.noiseBurst(this.sfx, t, { type: 'lowpass', freq: 900, dur: s.dur * 1.6, gain: s.gain * 0.5 });
    this.tone(this.sfx, t, { type: 'sine', freq: s.thump, freqEnd: 45, dur: 0.12, gain: Math.min(0.8, s.gain * 0.35) });
  }

  /** Descarga eléctrica (Arco voltaico). */
  private zap(at: number, gain: number, dest?: AudioNode): void {
    const out = dest ?? this.sfx;
    this.noiseBurst(out, at, { type: 'highpass', freq: 2500, dur: 0.12, gain: gain * 0.8 });
    this.tone(out, at, { type: 'sawtooth', freq: 2400, freqEnd: 300, dur: 0.14, gain: gain * 0.4 });
    this.tone(out, at, { type: 'square', freq: 90, dur: 0.1, gain: gain * 0.3 });
  }

  private tune(at: number, notes: Array<[number, number]>, type: OscillatorType, gain: number, len = 0.16): void {
    for (const [f, dt] of notes) this.tone(this.sfx, at + dt, { type, freq: f, dur: len, gain });
  }

  private click(at: number, freq: number, gain: number): void {
    this.noiseBurst(this.sfx, at, { type: 'highpass', freq, dur: 0.035, gain });
    this.tone(this.sfx, at, { type: 'square', freq: freq * 0.5, dur: 0.02, gain: gain * 0.3 });
  }

  private reload(seconds: number): void {
    const t = this.now;
    this.click(t + 0.12, 2600, 0.1); // sale el cargador
    this.click(t + seconds * 0.7, 1500, 0.14); // entra el cargador
    this.noiseBurst(this.sfx, t + seconds * 0.88, { type: 'bandpass', freq: 3000, freqEnd: 1200, q: 2, dur: 0.09, gain: 0.12 }); // corredera
  }

  private siren(rising: boolean): void {
    const ctx = this.ctx!;
    const t = this.now;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(SIREN, t + 0.4);
    if (rising) {
      // Dos subidas y bajadas: empieza la ronda.
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.linearRampToValueAtTime(640, t + 1.0);
      osc.frequency.linearRampToValueAtTime(420, t + 1.6);
      osc.frequency.linearRampToValueAtTime(660, t + 2.5);
      osc.frequency.linearRampToValueAtTime(260, t + 3.6);
      g.gain.setValueAtTime(SIREN, t + 3.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.7);
    } else {
      // Una sola caída larga: termina la ronda.
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 2.8);
      g.gain.setValueAtTime(SIREN, t + 2.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
    }
    osc.connect(lp).connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + (rising ? 3.8 : 3.0));
  }

  /** Gruñido de un Vacío: dientes de sierra grave a través de dos formantes. */
  private voice(kind: VoiceKind, pos: Vec3): void {
    const ctx = this.ctx!;
    const t = this.now;
    const out = this.out(pos, kind === 'far' ? 3 : 2);
    const base = (kind === 'attack' ? 130 : 70) + Math.random() * 35;
    const dur = kind === 'attack' ? 0.35 : 0.6 + Math.random() * 0.5;
    const gain = kind === 'far' ? 0.8 : kind === 'attack' ? 0.9 : kind === 'behind' ? 0.8 : 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * (0.75 + Math.random() * 0.2), t + dur);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9 + Math.random() * 8;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = base * 0.08;
    wobble.connect(wobbleDepth).connect(osc.frequency);
    const env = this.env(t, kind === 'attack' ? 0.02 : 0.12, dur, gain);
    for (const [f, q] of [
      [550 + Math.random() * 150, 6],
      [1150 + Math.random() * 250, 8],
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'far' ? f * 0.7 : f;
      bp.Q.value = q;
      osc.connect(bp).connect(env);
    }
    env.connect(out);
    osc.start(t);
    wobble.start(t);
    osc.stop(t + dur + 0.2);
    wobble.stop(t + dur + 0.2);
    // Por la espalda, además, una respiración ronca muy cerca.
    if (kind === 'behind') this.noiseBurst(out, t, { type: 'bandpass', freq: 900, q: 2, attack: 0.15, dur: 0.5, gain: 0.35 });
  }

  /** Chapa metálica: parciales inarmónicos que se apagan. */
  private clang(pos: Vec3, gain: number): void {
    const t = this.now;
    const out = this.out(pos);
    for (const [f, d] of [
      [410, 0.6],
      [1090, 0.4],
      [2270, 0.25],
    ] as const) {
      this.tone(out, t, { type: 'sine', freq: f * (0.97 + Math.random() * 0.06), dur: d, gain: gain / 3 });
    }
    this.noiseBurst(out, t, { type: 'bandpass', freq: 2500, dur: 0.06, gain: gain * 0.6 });
  }

  // ------------------------------------------------------------ eventos de la partida

  onEvent(ev: SimEvent, game: Game): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.now;
    switch (ev.type) {
      case 'shot':
        this.shot(ev.weapon, ev.upgraded);
        break;
      case 'dryFire':
        this.click(t, 3000, 0.2);
        break;
      case 'reloadStart':
        this.reload(game.cfg.weapons[ev.weapon]?.reloadSeconds ?? 1.5);
        break;
      case 'hit':
        if (ev.killed) {
          // Baja: soplido de ceniza y un tono que sube.
          this.noiseBurst(this.sfx, t, { type: 'lowpass', freq: 1400, freqEnd: 300, attack: 0.01, dur: 0.35, gain: 0.7 });
          this.tone(this.sfx, t, { type: 'triangle', freq: 880, freqEnd: 1500, dur: 0.07, gain: 0.3 });
        } else {
          this.tone(this.sfx, t, { type: 'square', freq: 1500, dur: 0.025, gain: 0.22 });
        }
        break;
      case 'points':
        if (t - this.lastPointsSound > 0.06) {
          this.tone(this.sfx, t + 0.03, { type: 'triangle', freq: 2350, dur: 0.05, gain: 0.1 });
          this.lastPointsSound = t;
        }
        break;
      case 'melee':
        this.noiseBurst(this.sfx, t, { type: 'bandpass', freq: 1200, freqEnd: 400, q: 1.5, dur: 0.12, gain: 0.25 });
        if (ev.hit) this.tone(this.sfx, t + 0.05, { type: 'sine', freq: 120, freqEnd: 60, dur: 0.12, gain: 0.5 });
        break;
      case 'purchase':
        if (ev.what === 'perk') {
          this.tune(t, PERK_TUNE[ev.id] ?? PERK_TUNE.coraza!, ev.id === 'coraza' ? 'square' : 'sine', ev.id === 'coraza' ? 0.08 : 0.15);
          break;
        }
        if (ev.what === 'contenedor') {
          // Carraca mientras gira: clics que se van espaciando.
          const spin = game.cfg.contenedor.spinSeconds;
          for (let k = 0, at = 0; at < spin; k++, at += 0.05 + (at / spin) * 0.25) this.click(t + at, 2200 - k * 10, 0.12);
          break;
        }
        if (ev.what === 'forja') {
          for (let i = 0; i < 4; i++) this.tone(this.sfx, t + i * 1.1, { type: 'sine', freq: 95, freqEnd: 45, dur: 0.3, gain: 0.6 });
          this.tone(this.sfx, t, { type: 'sawtooth', freq: 55, attack: 0.4, dur: game.cfg.forja.seconds, gain: 0.07 });
          break;
        }
        [660, 880, 1320].forEach((f, i) => this.tone(this.sfx, t + i * 0.07, { type: 'triangle', freq: f, dur: 0.12, gain: 0.18 }));
        if (ev.what === 'door') {
          this.noiseBurst(this.sfx, t + 0.1, { type: 'lowpass', freq: 300, freqEnd: 1600, attack: 0.3, dur: 1.2, gain: 0.15 });
          this.tone(this.sfx, t + 1.4, { type: 'sine', freq: 90, freqEnd: 40, dur: 0.3, gain: 0.3 });
        }
        break;
      case 'denied':
        this.tone(this.sfx, t, { type: 'square', freq: 140, dur: 0.12, gain: 0.12 });
        this.tone(this.sfx, t + 0.16, { type: 'square', freq: 110, dur: 0.16, gain: 0.12 });
        break;
      case 'roundStart':
        this.siren(true);
        this.setMusic(ev.round, true, 3.5);
        break;
      case 'roundEnd':
        this.siren(false);
        // Silencio entre rondas: la música se apaga.
        this.setMusic(ev.round, false, 0);
        break;
      case 'playerHit': {
        this.tone(this.sfx, t, { type: 'sine', freq: 85, freqEnd: 45, dur: 0.25, gain: 0.7 });
        this.noiseBurst(this.sfx, t, { type: 'lowpass', freq: 700, dur: 0.15, gain: 0.35 });
        const e = game.enemies[ev.enemy];
        if (e) this.voice('attack', { x: e.pos.x, y: e.pos.y + MOUTH_HEIGHT, z: e.pos.z });
        break;
      }
      case 'plankTorn': {
        const w = game.cfg.map.windows[ev.window];
        if (w) this.clang({ x: w.inside[0], y: 1.5, z: w.inside[1] }, 0.6);
        break;
      }
      case 'plankRepaired': {
        const w = game.cfg.map.windows[ev.window];
        if (!w) break;
        const pos = { x: w.inside[0], y: 1.5, z: w.inside[1] };
        for (let i = 0; i < 3; i++) this.noiseBurst(this.out(pos), t + i * 0.06, { type: 'highpass', freq: 4000, dur: 0.02, gain: 0.25 });
        this.clang(pos, 0.3);
        break;
      }
      case 'enemySpawned':
        this.nextVoice[ev.enemy] = t + 0.3 + Math.random() * 1.2;
        break;
      case 'powerOn':
        this.tone(this.sfx, t, { type: 'sine', freq: 70, freqEnd: 35, dur: 0.4, gain: 0.6 });
        this.noiseBurst(this.sfx, t, { type: 'bandpass', freq: 1800, dur: 0.08, gain: 0.4 });
        this.tone(this.sfx, t + 0.2, { type: 'sawtooth', freq: 50, freqEnd: 120, attack: 0.6, dur: 1.4, gain: 0.12 });
        break;
      case 'downed':
        for (let i = 0; i < 3; i++) {
          this.tone(this.sfx, t + i * 0.8, { type: 'sine', freq: 60, freqEnd: 40, dur: 0.15, gain: 0.7 });
          this.tone(this.sfx, t + i * 0.8 + 0.22, { type: 'sine', freq: 55, freqEnd: 38, dur: 0.12, gain: 0.5 });
        }
        break;
      case 'revived':
        this.noiseBurst(this.sfx, t, { type: 'bandpass', freq: 400, freqEnd: 2400, q: 1.2, attack: 0.25, dur: 0.5, gain: 0.3 });
        this.tune(t + 0.2, PERK_TUNE.segundoAliento!, 'sine', 0.12, 0.12);
        break;
      case 'contenedorOffer':
        this.tune(t, [[NOTE.C5, 0], [NOTE.G5, 0.08]], 'triangle', 0.2, 0.2);
        break;
      case 'contenedorTaken':
      case 'forjaTaken':
        this.tune(t, [[NOTE.E5, 0], [NOTE.B5, 0.06], [NOTE.E6, 0.12]], 'triangle', 0.15, 0.15);
        break;
      case 'contenedorMoving':
        this.tone(this.sfx, t, { type: 'sawtooth', freq: 180, freqEnd: 60, attack: 0.1, dur: 1.6, gain: 0.15 });
        this.noiseBurst(this.sfx, t, { type: 'lowpass', freq: 400, attack: 0.4, dur: 1.4, gain: 0.25 });
        break;
      case 'forjaReady':
        for (const [f, d] of [[880, 1.2], [2210, 0.8], [3530, 0.5]] as const) this.tone(this.sfx, t, { type: 'sine', freq: f, dur: d, gain: 0.12 });
        break;
      case 'chain':
        this.zap(t, 0.35, this.out(ev.to));
        break;
      case 'ashWave':
        this.noiseBurst(this.out(ev.at), t, { type: 'lowpass', freq: 200, freqEnd: 1600, attack: 0.05, dur: 0.45, gain: 0.6 });
        break;
      case 'powerupDrop': {
        const pu = game.pickups[ev.slot];
        if (pu) {
          const out = this.out({ x: pu.x, y: 0.7, z: pu.z });
          [1568, 2093, 2637].forEach((f, i) => this.tone(out, t + i * 0.05, { type: 'sine', freq: f, dur: 0.25, gain: 0.25 }));
        }
        break;
      }
      case 'powerupPickup':
        this.powerupJingle(ev.kind, t);
        break;
      case 'effectEnd':
        this.tune(t, [[NOTE.G5, 0], [NOTE.C5, 0.12]], 'triangle', 0.15);
        break;
      case 'gameOver':
        this.setMusic(0, false, 0);
        this.tone(this.sfx, t, { type: 'sawtooth', freq: 220, freqEnd: 40, attack: 0.05, dur: 2.2, gain: 0.2 });
        break;
      default:
        break;
    }
  }

  /** Motivo propio de cada power-up al recogerlo. */
  private powerupJingle(kind: string, t: number): void {
    switch (kind) {
      case 'municionCompleta':
        this.tune(t, [[NOTE.C4, 0], [NOTE.E4, 0.07], [NOTE.G4, 0.14], [NOTE.C5, 0.21], [NOTE.E5, 0.28]], 'square', 0.08, 0.12);
        break;
      case 'bajaInstantanea':
        this.tone(this.sfx, t, { type: 'sawtooth', freq: 110, freqEnd: 55, dur: 0.8, gain: 0.25 });
        this.tune(t, [[NOTE.E4, 0], [NOTE.E4 * 1.06, 0.2]], 'square', 0.1, 0.3);
        break;
      case 'puntosDobles':
        this.tune(t, [[NOTE.G5, 0], [NOTE.G5, 0.12], [NOTE.C5 * 2, 0.24]], 'triangle', 0.2, 0.1);
        break;
      case 'ondaExpansiva':
        this.noiseBurst(this.sfx, t, { type: 'lowpass', freq: 1200, freqEnd: 80, attack: 0.01, dur: 1.8, gain: 1 });
        this.tone(this.sfx, t, { type: 'sine', freq: 60, freqEnd: 25, dur: 1.5, gain: 0.8 });
        break;
    }
  }

  /** Música: más abierta y con un latido más rápido cuanto más alta es la ronda. */
  private setMusic(round: number, on: boolean, delay: number): void {
    const t = this.now + delay;
    const g = this.music.gain;
    g.cancelScheduledValues(this.ctx!.currentTime);
    g.setValueAtTime(g.value, this.ctx!.currentTime);
    if (!on) {
      g.linearRampToValueAtTime(0, this.now + 1.5);
      return;
    }
    const level = Math.min(0.12, 0.04 + round * 0.006) * MUSIC;
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + 4);
    this.musicFilter.frequency.setTargetAtTime(Math.min(1500, 180 + round * 60), t, 2);
    this.musicPulse.frequency.setTargetAtTime(Math.min(2, 0.1 + round * 0.05), t, 2);
  }

  /** Coloca el oído en la cámara y hace hablar a los Vacíos. Llamar cada fotograma. */
  update(game: Game, ear: Vec3, yaw: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = ear.x;
      l.positionY.value = ear.y;
      l.positionZ.value = ear.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Navegadores sin los parámetros nuevos del oyente.
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(ear.x, ear.y, ear.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, 0, fz, 0, 1, 0);
    }

    const now = this.now;
    const p = game.player.pos;
    for (const e of game.enemies) {
      if (e.phase === 'inactive') continue;
      const next = this.nextVoice[e.index] ?? 0;
      if (now < next) continue;
      const kind = voiceKind(e.pos.x - p.x, e.pos.z - p.z, yaw);
      if (this.limiter.tryStart(now)) {
        this.voice(kind, { x: e.pos.x, y: e.pos.y + MOUTH_HEIGHT, z: e.pos.z });
        this.nextVoice[e.index] = nextVoiceTime(now, kind, Math.random);
      } else {
        this.nextVoice[e.index] = now + 0.2 + Math.random() * 0.4;
      }
    }
  }
}
