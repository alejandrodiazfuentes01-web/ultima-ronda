/**
 * Paso fijo de la simulación (regla de arquitectura 2).
 *
 * El cliente le pasa el tiempo real transcurrido entre fotogramas; el
 * acumulador ejecuta tantos pasos de 1/60 s como quepan y devuelve la
 * fracción sobrante (alfa) para que el render interpole entre el estado
 * anterior y el actual. Así la velocidad del juego no depende de los Hz
 * del monitor.
 */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Tope de tiempo por fotograma: tras una pestaña en segundo plano no se intenta recuperar todo de golpe. */
export const MAX_FRAME_SECONDS = 0.25;

export class FixedStepper {
  private accumulator = 0;

  /**
   * Avanza el reloj `frameSeconds` y llama a `step` una vez por cada paso fijo.
   * Devuelve alfa en [0, 1): cuánto falta del siguiente paso, para interpolar.
   */
  advance(frameSeconds: number, step: () => void): number {
    const dt = Number.isFinite(frameSeconds) ? Math.min(Math.max(frameSeconds, 0), MAX_FRAME_SECONDS) : 0;
    this.accumulator += dt;
    while (this.accumulator >= SIM_DT) {
      step();
      this.accumulator -= SIM_DT;
    }
    return this.accumulator / SIM_DT;
  }
}
