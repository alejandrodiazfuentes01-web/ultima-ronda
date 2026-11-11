/**
 * Arranque y bucle principal. La simulación avanza a paso fijo de 60 Hz y
 * el render interpola entre pasos (regla 2).
 *
 * Estados: cargando → menú → jugando ⇄ pausa → fin de partida → jugando.
 */
import * as THREE from 'three/webgpu';
import { loadConfig } from '../../shared/config';
import { FixedStepper } from '../../shared/sim/fixedStep';
import { Game } from '../../shared/sim/game';
import { initSim } from '../../shared/sim/libs';
import { AudioEngine } from './audio/engine';
import { Hud } from './hud';
import { detectLanguage, setLanguage, t, type TextKey } from './i18n';
import { Input } from './input';
import { loadModels } from './models';
import { PerfMeter } from './perf';
import { GameView } from './render';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'over';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Falta el elemento #${id}`);
  return e as T;
}

function applyTexts(): void {
  document.title = t('game.title');
  for (const node of document.querySelectorAll<HTMLElement>('[data-text]')) {
    node.textContent = t(node.dataset.text as TextKey);
  }
}

function showError(): void {
  const e = el('error');
  e.textContent = t('error.noGraphics');
  e.hidden = false;
}

async function start(): Promise<void> {
  const lang = detectLanguage(navigator.languages ?? [navigator.language]);
  setLanguage(lang);
  document.documentElement.lang = lang;
  applyTexts();

  const canvas = el<HTMLCanvasElement>('game');
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const cfg = loadConfig();
  await Promise.all([renderer.init(), initSim()]);
  const usingWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const perf = new PerfMeter(el('perf'), t(usingWebGPU ? 'renderer.webgpu' : 'renderer.webgl2'));

  // Modelos del mapa: se cargan antes de montar la escena; si alguno falla, sale como caja gris.
  const m = cfg.map;
  const modelNames = [m.powerSwitch, ...m.perkStations, m.forja, ...m.contenedorSpots, ...m.decor]
    .map((f) => f.model)
    .filter((n): n is string => !!n);
  await loadModels(modelNames);
  const view = new GameView(cfg.map, cfg.rounds.aliveCap.max);
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    view.resize(window.innerWidth, window.innerHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  const input = new Input(canvas);
  const hud = new Hud();
  const audio = new AudioEngine();
  const stepper = new FixedStepper();
  let game: Game | null = null;
  let state: State = 'loading';

  const menu = el('menu');
  const pause = el('pause');
  const over = el('over');
  const menuError = el('menu-error');
  const playButton = el<HTMLButtonElement>('play');

  const setState = (s: State) => {
    state = s;
    menu.hidden = s !== 'menu' && s !== 'loading';
    pause.hidden = s !== 'paused';
    over.hidden = s !== 'over';
    hud.show(s === 'playing' || s === 'paused');
  };

  const capture = async () => {
    menuError.hidden = true;
    try {
      await input.lock();
    } catch {
      // Chrome no deja recapturar el ratón justo después de soltarlo: se reintenta con otro clic.
      menuError.textContent = t('error.pointerLock');
      menuError.hidden = false;
    }
  };

  const newGame = async () => {
    // El navegador solo deja sonar audio tras un clic: se arranca aquí, al pulsar Jugar.
    audio.start();
    game?.free();
    game = new Game(cfg, { seed: (Math.random() * 2 ** 31) | 0 });
    // Solo en el servidor de desarrollo: acceso a la partida para pruebas automáticas. No existe en el build publicado.
    if (import.meta.env.DEV) Object.assign(window, { __game: game, __audio: audio });
    input.setView(game.player.yaw, 0);
    input.releaseAll();
    hud.reset();
    await capture();
    if (input.locked) setState('playing');
    else setState(state === 'over' ? 'over' : 'menu');
  };

  playButton.addEventListener('click', () => void newGame());
  el('again').addEventListener('click', () => void newGame());
  el('resume').addEventListener('click', () => {
    audio.start();
    void capture();
  });

  document.addEventListener('pointerlockchange', () => {
    if (input.locked) {
      if (state === 'paused' || state === 'menu') setState('playing');
    } else {
      input.releaseAll();
      if (state === 'playing') {
        setState('paused');
        audio.suspend();
      }
    }
  });

  playButton.textContent = t('menu.play');
  playButton.disabled = false;
  setState('menu');

  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const frameSeconds = Math.min((now - last) / 1000, 0.25);
    last = now;
    let alpha = 1;

    if (game && state === 'playing') {
      const g = game;
      alpha = stepper.advance(frameSeconds, () => {
        g.step(input.next());
        for (const ev of g.events) {
          hud.onEvent(ev);
          view.onEvent(ev, g);
          audio.onEvent(ev, g);
          if (ev.type === 'gameOver') {
            el('over-round').textContent = t('over.round', { round: ev.round });
            setState('over');
            input.unlock();
          }
        }
      });
    }

    if (game) {
      view.update(game, alpha, input.yaw, input.pitch, state === 'playing' ? frameSeconds : 0);
      hud.update(game, frameSeconds);
      if (state === 'playing') audio.update(game, view.camera.position, input.yaw);
    }
    renderer.render(view.scene, view.camera);
    const info = renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number };
    perf.frame(frameSeconds, info.drawCalls ?? info.calls ?? 0, info.triangles ?? 0);
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showError();
});
