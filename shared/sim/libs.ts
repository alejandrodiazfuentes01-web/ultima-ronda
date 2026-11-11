/**
 * Rapier y recast son WebAssembly y se inicializan de forma asíncrona.
 * Hay que esperar a initSim() una vez antes de crear una partida.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { init as initRecast } from '@recast-navigation/core';

let ready: Promise<void> | null = null;

export function initSim(): Promise<void> {
  ready ??= Promise.all([RAPIER.init(), initRecast()]).then(() => undefined);
  return ready;
}

export { RAPIER };
