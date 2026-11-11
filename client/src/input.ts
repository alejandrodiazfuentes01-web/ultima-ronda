/**
 * Teclado y ratón (regla 6): ratón capturado con Pointer Lock, nada en Ctrl,
 * y Escape lo gestiona el navegador soltando el ratón, que abre la pausa.
 */
import { emptyInput, type PlayerInput } from '../../shared/sim/types';

/** Sensibilidad del ratón en radianes por píxel. Pasará a Ajustes en la fase 3. */
const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = 1.5;

type Action = 'fire' | 'jump' | 'reload' | 'use' | 'melee' | 'sprint';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'jump',
  KeyR: 'reload',
  KeyE: 'use',
  KeyV: 'melee',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class Input {
  yaw = 0;
  pitch = 0;
  private readonly keys = new Set<string>();
  private readonly held: Record<Action, boolean> = { fire: false, jump: false, reload: false, use: false, melee: false, sprint: false };
  /** Pulsaciones cortas que podrían caer entre dos pasos: se cuentan en el siguiente. */
  private readonly tapped: Record<Action, boolean> = { fire: false, jump: false, reload: false, use: false, melee: false, sprint: false };
  private pendingSlot: number | null = null;
  private pendingCycle = 0;
  private readonly sample: PlayerInput = emptyInput();

  constructor(private readonly target: HTMLElement) {
    document.addEventListener('keydown', (e) => this.onKey(e, true));
    document.addEventListener('keyup', (e) => this.onKey(e, false));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * MOUSE_SENSITIVITY));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.set('fire', true);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.set('fire', false);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.locked && e.deltaY !== 0) this.pendingCycle = e.deltaY > 0 ? 1 : -1;
      },
      { passive: true },
    );
    window.addEventListener('blur', () => this.releaseAll());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Captura el ratón. Debe llamarse desde un clic del jugador. */
  async lock(): Promise<void> {
    await this.target.requestPointerLock();
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  releaseAll(): void {
    this.keys.clear();
    for (const a of Object.keys(this.held) as Action[]) {
      this.held[a] = false;
      this.tapped[a] = false;
    }
  }

  /** Coloca la vista (al empezar partida). */
  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Entrada para el siguiente paso de simulación. Reutiliza el mismo objeto. */
  next(): PlayerInput {
    const s = this.sample;
    s.moveX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    s.moveZ = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    s.yaw = this.yaw;
    s.pitch = this.pitch;
    s.fire = this.consume('fire');
    s.jump = this.consume('jump');
    s.reload = this.consume('reload');
    s.use = this.consume('use');
    s.melee = this.consume('melee');
    s.sprint = this.consume('sprint');
    s.selectSlot = this.pendingSlot;
    s.cycleWeapon = this.pendingCycle;
    this.pendingSlot = null;
    this.pendingCycle = 0;
    return s;
  }

  private consume(a: Action): boolean {
    const v = this.held[a] || this.tapped[a];
    this.tapped[a] = false;
    return v;
  }

  private set(a: Action, down: boolean): void {
    if (down) this.tapped[a] = true;
    this.held[a] = down;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.locked) {
      if (!down) this.keys.delete(e.code);
      return;
    }
    // Nada en Ctrl: los atajos del navegador (Ctrl + W cierra la pestaña) no se tocan.
    if (e.ctrlKey || e.metaKey) return;
    if (MOVE_KEYS.has(e.code) || e.code in KEY_ACTIONS || e.code === 'Digit1' || e.code === 'Digit2') e.preventDefault();
    if (MOVE_KEYS.has(e.code)) {
      if (down) this.keys.add(e.code);
      else this.keys.delete(e.code);
    }
    const action = KEY_ACTIONS[e.code];
    if (action && !(down && e.repeat)) this.set(action, down);
    if (down && e.code === 'Digit1') this.pendingSlot = 0;
    if (down && e.code === 'Digit2') this.pendingSlot = 1;
  }
}
