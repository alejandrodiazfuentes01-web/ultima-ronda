/**
 * Tutorial dentro de la primera partida (GDD, «Interfaz»): cuatro avisos
 * contextuales, sin pantallas de texto. Cada aviso aparece cuando toca y se
 * va en cuanto el jugador lo hace; si ya lo hizo antes, no aparece.
 * Lo superado se recuerda entre partidas (localStorage dentro de try/catch, regla 7).
 */
import type { SimEvent } from '../../shared/sim/types';

export const TUTORIAL_STEPS = ['shoot', 'repair', 'buyWeapon', 'openDoor'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Lo que el tutorial necesita saber de la partida en cada momento. */
export interface TutorialView {
  /** Hay algún enemigo en camino o dentro. */
  enemiesAround: boolean;
  /** Hay una ventana con planchas arrancadas cerca del jugador. */
  brokenWindowNear: boolean;
  /** Le llega para comprar el arma de la pared y aún no la tiene. */
  canAffordWallWeapon: boolean;
  /** Le llega para abrir la puerta y sigue cerrada. */
  canAffordDoor: boolean;
}

const STORAGE_KEY = 'ultimaRonda.tutorial';

function loadDone(): Set<TutorialStep> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((s): s is TutorialStep => (TUTORIAL_STEPS as readonly string[]).includes(s)) : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<TutorialStep>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
  } catch {
    // Modo incógnito o portal que bloquea el almacenamiento: el tutorial se repetirá, sin más.
  }
}

export class Tutorial {
  private readonly done: Set<TutorialStep>;
  private readonly persist: boolean;

  constructor(options: { done?: TutorialStep[]; persist?: boolean } = {}) {
    this.persist = options.persist ?? true;
    this.done = options.done ? new Set(options.done) : this.persist ? loadDone() : new Set();
  }

  isDone(step: TutorialStep): boolean {
    return this.done.has(step);
  }

  private complete(step: TutorialStep): void {
    if (this.done.has(step)) return;
    this.done.add(step);
    if (this.persist) saveDone(this.done);
  }

  /** Marca como hecho lo que el jugador acaba de hacer. */
  onEvent(ev: SimEvent): void {
    if (ev.type === 'hit') this.complete('shoot');
    else if (ev.type === 'plankRepaired') this.complete('repair');
    else if (ev.type === 'purchase' && ev.what === 'weapon') this.complete('buyWeapon');
    else if (ev.type === 'purchase' && ev.what === 'door') this.complete('openDoor');
  }

  /** El aviso que toca enseñar ahora, o null. Solo uno a la vez, por orden. */
  current(v: TutorialView): TutorialStep | null {
    if (!this.done.has('shoot') && v.enemiesAround) return 'shoot';
    if (!this.done.has('repair') && v.brokenWindowNear) return 'repair';
    if (!this.done.has('buyWeapon') && v.canAffordWallWeapon) return 'buyWeapon';
    if (!this.done.has('openDoor') && v.canAffordDoor && this.done.has('buyWeapon')) return 'openDoor';
    return null;
  }
}
