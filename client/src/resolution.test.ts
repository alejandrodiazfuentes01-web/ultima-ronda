import { describe, expect, it } from 'vitest';
import { DynamicResolution } from './resolution';

function play(res: DynamicResolution, fps: number, seconds: number): void {
  for (let i = 0; i < fps * seconds; i++) res.frame(1 / fps);
}

describe('resolución dinámica', () => {
  it('a 60 fotogramas no toca nada', () => {
    const applied: number[] = [];
    const res = new DynamicResolution(() => 2, (r) => applied.push(r));
    play(res, 60, 10);
    expect(applied).toEqual([]);
    expect(res.fraction).toBe(1);
  });

  it('si caen los fotogramas baja la resolución, con un tope', () => {
    const applied: number[] = [];
    const res = new DynamicResolution(() => 2, (r) => applied.push(r));
    play(res, 35, 20);
    expect(applied.length).toBeGreaterThan(1);
    expect(applied[0]).toBeLessThan(2);
    expect(res.fraction).toBeGreaterThanOrEqual(0.55);
    expect(Math.min(...applied)).toBeCloseTo(2 * 0.55, 5);
  });

  it('cuando vuelve a ir bien, sube poco a poco hasta la completa', () => {
    const applied: number[] = [];
    const res = new DynamicResolution(() => 1, (r) => applied.push(r));
    play(res, 35, 3);
    const low = res.fraction;
    expect(low).toBeLessThan(1);
    play(res, 60, 2);
    expect(res.fraction).toBe(low);
    play(res, 60, 60);
    expect(res.fraction).toBe(1);
    expect(applied[applied.length - 1]).toBe(1);
  });
});
