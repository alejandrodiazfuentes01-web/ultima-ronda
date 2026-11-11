import { describe, expect, it } from 'vitest';
import { FixedStepper, SIM_DT } from './fixedStep';

/** Simula `seconds` de juego con un monitor de `hz` y cuenta los pasos de simulación. */
function stepsAt(hz: number, seconds: number): number {
  const stepper = new FixedStepper();
  let steps = 0;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) stepper.advance(1 / hz, () => steps++);
  return steps;
}

describe('paso fijo de 60 Hz', () => {
  it('da los mismos pasos por segundo con monitores de 30, 60, 144 y 240 Hz', () => {
    for (const hz of [30, 60, 144, 240]) {
      expect(Math.abs(stepsAt(hz, 10) - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('devuelve una fracción de interpolación entre 0 y 1', () => {
    const stepper = new FixedStepper();
    const alpha = stepper.advance(SIM_DT * 1.5, () => {});
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('no intenta recuperar más de un cuarto de segundo tras una pausa larga', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    stepper.advance(5, () => steps++);
    expect(steps).toBe(15);
  });

  it('ignora tiempos negativos o inválidos', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    stepper.advance(-1, () => steps++);
    stepper.advance(Number.NaN, () => steps++);
    expect(steps).toBe(0);
  });
});
