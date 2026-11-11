import { describe, expect, it } from 'vitest';
import { Tutorial, type TutorialView } from './tutorial';

const view = (v: Partial<TutorialView> = {}): TutorialView => ({
  enemiesAround: false,
  brokenWindowNear: false,
  canAffordWallWeapon: false,
  canAffordDoor: false,
  ...v,
});

describe('tutorial', () => {
  it('cada aviso aparece cuando toca y se va al hacerlo', () => {
    const t = new Tutorial({ persist: false });
    expect(t.current(view())).toBeNull();
    expect(t.current(view({ enemiesAround: true }))).toBe('shoot');
    t.onEvent({ type: 'hit', enemy: 0, part: 'torso', killed: false });
    expect(t.current(view({ enemiesAround: true }))).toBeNull();

    expect(t.current(view({ brokenWindowNear: true }))).toBe('repair');
    t.onEvent({ type: 'plankRepaired', window: 0 });
    expect(t.current(view({ brokenWindowNear: true }))).toBeNull();

    expect(t.current(view({ canAffordWallWeapon: true, canAffordDoor: true }))).toBe('buyWeapon');
    t.onEvent({ type: 'purchase', what: 'weapon', id: 'smg5' });
    expect(t.current(view({ canAffordDoor: true }))).toBe('openDoor');
    t.onEvent({ type: 'purchase', what: 'door', id: 'puerta-1' });
    expect(t.current(view({ enemiesAround: true, brokenWindowNear: true, canAffordDoor: true }))).toBeNull();
  });

  it('solo un aviso a la vez, por orden', () => {
    const t = new Tutorial({ persist: false });
    expect(t.current(view({ enemiesAround: true, brokenWindowNear: true, canAffordWallWeapon: true }))).toBe('shoot');
  });

  it('si ya lo hizo antes, el aviso no aparece', () => {
    const t = new Tutorial({ persist: false });
    t.onEvent({ type: 'purchase', what: 'door', id: 'puerta-1' });
    t.onEvent({ type: 'purchase', what: 'weapon', id: 'smg5' });
    expect(t.current(view({ canAffordWallWeapon: true, canAffordDoor: true }))).toBeNull();
  });

  it('la puerta se sugiere después del arma, no antes', () => {
    const t = new Tutorial({ persist: false });
    expect(t.current(view({ canAffordDoor: true }))).toBeNull();
  });

  it('recuerda lo superado entre partidas', () => {
    const t = new Tutorial({ done: ['shoot', 'repair', 'buyWeapon', 'openDoor'], persist: false });
    expect(t.current(view({ enemiesAround: true, brokenWindowNear: true, canAffordWallWeapon: true, canAffordDoor: true }))).toBeNull();
  });

  it('sin localStorage (incógnito) funciona igual', () => {
    // En Node no hay localStorage: leer y guardar fallan y el tutorial sigue.
    const t = new Tutorial();
    expect(t.current(view({ enemiesAround: true }))).toBe('shoot');
    t.onEvent({ type: 'hit', enemy: 0, part: 'head', killed: true });
    expect(t.isDone('shoot')).toBe(true);
  });
});
