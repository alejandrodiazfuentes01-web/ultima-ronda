/**
 * Modelos 3D del juego (glTF binario en client/public/models). Se cargan una vez
 * al arrancar y se clonan para cada uso. Si uno falla, se dibuja una caja gris.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Box, Point2 } from '../../shared/config';

const cache = new Map<string, THREE.Object3D>();

/** Carga los modelos indicados. Devuelve los que no se pudieron cargar. */
export async function loadModels(names: Iterable<string>): Promise<string[]> {
  const loader = new GLTFLoader();
  const failed: string[] = [];
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      try {
        // Ruta relativa (regla 9).
        const gltf = await loader.loadAsync(`./models/${name}.glb`);
        cache.set(name, gltf.scene);
      } catch (err) {
        console.warn(`No se pudo cargar el modelo ${name}`, err);
        failed.push(name);
      }
    }),
  );
  return failed;
}

const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();

/**
 * Coloca una copia del modelo dentro de una caja del mapa, mirando hacia `facing`.
 * Escala uniforme: el modelo cabe entero en la caja, apoyado en su base.
 * Los modelos generados miran hacia +z.
 */
export function placeModel(name: string | null, box: Box, facing: Point2, fallbackColor: number): THREE.Object3D {
  const [x0, y0, z0, x1, y1, z1] = box;
  const src = name ? cache.get(name) : undefined;
  if (!src) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
      new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.8 }),
    );
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return mesh;
  }
  const model = src.clone(true);
  const yaw = Math.atan2(facing[0], facing[1]);
  model.rotation.y = yaw;
  model.updateMatrixWorld(true);
  tmpBox.setFromObject(model);
  tmpBox.getSize(tmpSize);
  const scale = Math.min((x1 - x0) / tmpSize.x, (y1 - y0) / tmpSize.y, (z1 - z0) / tmpSize.z);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  tmpBox.setFromObject(model);
  tmpBox.getCenter(tmpCenter);
  model.position.set((x0 + x1) / 2 - tmpCenter.x, y0 - tmpBox.min.y, (z0 + z1) / 2 - tmpCenter.z);
  return model;
}
