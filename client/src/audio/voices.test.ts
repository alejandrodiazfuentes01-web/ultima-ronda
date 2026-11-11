import { describe, expect, it } from 'vitest';
import { MAX_VOICES_PER_SECOND, VOICE_INTERVAL, VoiceLimiter, nextVoiceTime, voiceKind } from './voices';

describe('voces de los Vacíos', () => {
  // El jugador mira hacia -z (yaw 0).
  it('lejos, cerca y por la espalda según la posición', () => {
    expect(voiceKind(0, -12, 0)).toBe('far');
    expect(voiceKind(0, -4, 0)).toBe('near');
    expect(voiceKind(0, 3, 0)).toBe('behind');
    expect(voiceKind(0, 9, 0)).toBe('far'); // detrás pero lejos
    expect(voiceKind(3, 0, 0)).toBe('near'); // a un lado
  });

  it('girar al jugador cambia lo que está detrás', () => {
    expect(voiceKind(0, 3, Math.PI)).toBe('near'); // ahora mira hacia +z
    expect(voiceKind(0, -3, Math.PI)).toBe('behind');
  });

  it('el intervalo entre voces queda dentro de su tramo', () => {
    for (const kind of ['far', 'near', 'behind'] as const) {
      const [min, max] = VOICE_INTERVAL[kind];
      expect(nextVoiceTime(10, kind, () => 0)).toBeCloseTo(10 + min);
      expect(nextVoiceTime(10, kind, () => 0.999999)).toBeCloseTo(10 + max, 3);
    }
  });

  it('no deja empezar más de unas pocas voces por segundo', () => {
    const lim = new VoiceLimiter();
    let started = 0;
    for (let i = 0; i < 20; i++) if (lim.tryStart(5 + i * 0.01)) started++;
    expect(started).toBe(MAX_VOICES_PER_SECOND);
    expect(lim.tryStart(6.5)).toBe(true);
  });
});
