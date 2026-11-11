/**
 * Medidor de rendimiento para decidir el renderizador al cerrar la fase 1:
 * fotogramas medios, el 1 % más lento, llamadas de dibujo y triángulos.
 * Se fuerza WebGL 2 abriendo el juego con ?renderer=webgl en la dirección.
 */
import { t } from './i18n';

const WINDOW = 240; // fotogramas que se promedian
const REFRESH_SECONDS = 0.5;

export class PerfMeter {
  private readonly samples = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private count = 0;
  private head = 0;
  private sinceRefresh = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly backend: string,
  ) {}

  frame(frameSeconds: number, calls: number, triangles: number): void {
    if (frameSeconds <= 0 || frameSeconds > 1) return;
    this.samples[this.head] = frameSeconds;
    this.head = (this.head + 1) % WINDOW;
    this.count = Math.min(this.count + 1, WINDOW);
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh < REFRESH_SECONDS) return;
    this.sinceRefresh = 0;

    let total = 0;
    for (let i = 0; i < this.count; i++) {
      total += this.samples[i]!;
      this.sorted[i] = this.samples[i]!;
    }
    const view = this.sorted.subarray(0, this.count).sort();
    // El 1 % más lento: media de los fotogramas más largos.
    const n = Math.max(1, Math.floor(this.count / 100));
    let slow = 0;
    for (let i = this.count - n; i < this.count; i++) slow += view[i]!;
    this.el.textContent = t('perf.line', {
      fps: Math.round(this.count / total),
      low: Math.round(n / slow),
      calls,
      tris: triangles.toLocaleString('en-US'),
      backend: this.backend,
    });
  }
}
