/**
 * Qué voz suelta cada Vacío y cada cuánto, según dónde está respecto al jugador
 * (GDD, «Audio»: voces posicionales lejos, cerca, atacando y por la espalda).
 * Lógica pura, sin Web Audio, para poder probarla.
 */

export type VoiceKind = 'far' | 'near' | 'behind' | 'attack';

/** Distancias en metros. */
const NEAR_DISTANCE = 7;
const BEHIND_DISTANCE = 5;
/** Coseno del ángulo a partir del cual se considera que el enemigo está detrás. */
const BEHIND_DOT = -0.3;

/** Segundos entre voces de un mismo enemigo, mínimo y máximo, según el tipo. */
export const VOICE_INTERVAL: Record<Exclude<VoiceKind, 'attack'>, [number, number]> = {
  far: [3.5, 7],
  near: [1.8, 3.5],
  behind: [1.2, 2.2],
};

/** Máximo de voces que empiezan en un segundo: más se vuelve ruido. */
export const MAX_VOICES_PER_SECOND = 4;

/**
 * Tipo de voz para un enemigo en (dx, dz) relativo al jugador, que mira con giro `yaw`
 * (0 mira hacia -z).
 */
export function voiceKind(dx: number, dz: number, yaw: number): Exclude<VoiceKind, 'attack'> {
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return 'near';
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dot = (dx * fx + dz * fz) / d;
  if (d <= BEHIND_DISTANCE && dot < BEHIND_DOT) return 'behind';
  return d <= NEAR_DISTANCE ? 'near' : 'far';
}

/** Próximo momento (en segundos) en que el enemigo vuelve a sonar. `rand` da un número en [0, 1). */
export function nextVoiceTime(now: number, kind: Exclude<VoiceKind, 'attack'>, rand: () => number): number {
  const [min, max] = VOICE_INTERVAL[kind];
  return now + min + (max - min) * rand();
}

/** Limita cuántas voces empiezan por segundo. */
export class VoiceLimiter {
  private readonly starts: number[] = [];

  tryStart(now: number): boolean {
    while (this.starts.length && now - this.starts[0]! > 1) this.starts.shift();
    if (this.starts.length >= MAX_VOICES_PER_SECOND) return false;
    this.starts.push(now);
    return true;
  }
}
