/**
 * Resolución dinámica (GDD, «Arquitectura técnica»): si los fotogramas caen,
 * se baja la resolución interna antes que la calidad del juego, y se vuelve a
 * subir poco a poco cuando sobra tiempo. Solo mira el tiempo de cada fotograma.
 */

/** Por debajo de estos fotogramas por segundo se baja la resolución; por encima de los otros se sube. */
const LOWER_BELOW_FPS = 50;
const RAISE_ABOVE_FPS = 57;
/** Segundos que se promedian antes de decidir, y segundos buenos seguidos que hacen falta para subir. */
const WINDOW_SECONDS = 1;
const GOOD_SECONDS_TO_RAISE = 3;
const STEP_DOWN = 0.12;
const STEP_UP = 0.06;
/** La resolución nunca baja de esta fracción de la de la pantalla. */
const MIN_FRACTION = 0.55;

export class DynamicResolution {
  private acc = 0;
  private frames = 0;
  private good = 0;
  /** Fracción de la resolución completa que se usa ahora (de MIN_FRACTION a 1). */
  fraction = 1;

  constructor(
    /** Resolución completa: los píxeles de pantalla por píxel CSS, con su tope. */
    private readonly full: () => number,
    private readonly apply: (pixelRatio: number) => void,
  ) {}

  /** Llamar una vez por fotograma mientras se juega. */
  frame(seconds: number): void {
    if (seconds <= 0 || seconds > 0.5) return;
    this.acc += seconds;
    this.frames++;
    if (this.acc < WINDOW_SECONDS) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    let next = this.fraction;
    if (fps < LOWER_BELOW_FPS) {
      this.good = 0;
      next = Math.max(MIN_FRACTION, this.fraction - STEP_DOWN);
    } else if (fps > RAISE_ABOVE_FPS && this.fraction < 1) {
      this.good++;
      if (this.good >= GOOD_SECONDS_TO_RAISE) {
        this.good = 0;
        next = Math.min(1, this.fraction + STEP_UP);
      }
    } else {
      this.good = 0;
    }
    if (next !== this.fraction) {
      this.fraction = next;
      this.apply(this.full() * next);
    }
  }
}
