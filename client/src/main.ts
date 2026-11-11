/**
 * Fase 0: un cubo girando. Sirve para comprobar el build, el despliegue y
 * el renderizador. El giro avanza en la simulación de paso fijo (60 Hz) y el
 * render interpola entre el paso anterior y el actual (regla 2).
 */
import * as THREE from 'three/webgpu';
import { FixedStepper, SIM_DT } from '../../shared/sim/fixedStep';
import { detectLanguage, setLanguage, t } from './i18n';

// Velocidad de giro del cubo de prueba (radianes por segundo). No es un valor de balance.
const SPIN_SPEED = 0.8;

function text(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showError(): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = t('error.noGraphics');
  el.hidden = false;
}

async function start(): Promise<void> {
  const lang = detectLanguage(navigator.languages ?? [navigator.language]);
  setLanguage(lang);
  document.documentElement.lang = lang;
  document.title = t('game.title');
  text('title', t('game.title'));
  text('phase', t('build.phase'));

  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const usingWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  text('renderer', t(usingWebGPU ? 'renderer.webgpu' : 'renderer.webgl2'));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1014);
  scene.fog = new THREE.Fog(0x0d1014, 4, 12);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.2, 4);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4e6, 0x1a1410, 0.6));
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.2);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x8a96a3, roughness: 0.7, metalness: 0.1 }),
  );
  scene.add(cube);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  scene.add(floor);

  // Estado de la simulación: ángulo actual y el del paso anterior, para interpolar.
  let angle = 0;
  let previousAngle = 0;
  const stepper = new FixedStepper();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const frameSeconds = (now - last) / 1000;
    last = now;
    const alpha = stepper.advance(frameSeconds, () => {
      previousAngle = angle;
      angle += SPIN_SPEED * SIM_DT;
    });
    const shown = previousAngle + (angle - previousAngle) * alpha;
    cube.rotation.set(shown * 0.6, shown, 0);
    renderer.render(scene, camera);
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showError();
});
