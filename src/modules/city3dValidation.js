/** Validate the buffers consumed by the City3D WebGL renderer before upload. */
export function validateInstancedMesh(mesh) {
  const capacity = mesh?.instanceMatrix?.count ?? 0;
  const count = Number(mesh?.count);
  if (!mesh?.isInstancedMesh || !Number.isInteger(count) || count < 0 || count > capacity) {
    throw new Error(`Invalid InstancedMesh count (${count}) for capacity ${capacity}`);
  }
  const matrices = mesh.instanceMatrix.array;
  for (let index = 0; index < count * 16; index++) {
    if (!Number.isFinite(matrices[index])) throw new Error(`Non-finite instance transform at element ${index}`);
  }
  if (mesh.instanceColor && mesh.instanceColor.array.length < count * 3) {
    throw new Error(`Instanced color buffer is shorter than active instance count (${count})`);
  }
  return true;
}

export function adaptiveQualityAction({ fps, targetFps, workMs, pixelRatio, minimum, maximum }) {
  const budgetMs = 1000 / targetFps;
  if ((fps < targetFps - 2 || workMs > budgetMs * .85) && pixelRatio > minimum) return 'lower';
  if (fps >= targetFps - 1 && workMs < budgetMs * .65 && pixelRatio < maximum) return 'raise';
  return null;
}

export function validateCity3DScene(scene) {
  const errors = [];
  scene?.traverse((object) => {
    if (!object.geometry) return;
    const label = object.userData?.kind || object.type;
    if (object.isInstancedMesh) {
      try { validateInstancedMesh(object); }
      catch (error) { errors.push(`${label}: ${error.message}`); }
    }
    const geometry = object.geometry;
    const position = geometry?.getAttribute('position');
    for (const [name, attribute] of Object.entries(geometry?.attributes || {})) {
      for (let index = 0; index < attribute.array.length; index++) {
        if (!Number.isFinite(attribute.array[index])) { errors.push(`${label}: non-finite ${name} buffer element ${index}`); break; }
      }
    }
    const index = geometry?.getIndex();
    if (index && position) {
      for (let offset = 0; offset < index.count; offset++) {
        if (index.getX(offset) >= position.count) { errors.push(`${label}: geometry index ${index.getX(offset)} exceeds ${position.count} vertices`); break; }
      }
    }
    const itemCount = index?.count ?? position?.count ?? 0;
    const { start, count } = geometry?.drawRange || { start: 0, count: Infinity };
    if (!Number.isFinite(start) || start < 0 || (count !== Infinity && (!Number.isFinite(count) || count < 0 || start + count > itemCount))) {
      errors.push(`${label}: draw range [${start}, ${start + count}) exceeds ${itemCount} elements`);
    }
    if (!object.isMesh && !object.isLine && !object.isPoints) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.length || materials.some((material) => {
      if (!material?.isMaterial || !Number.isFinite(material.opacity)) return true;
      for (const color of [material.color, material.emissive]) {
        if (color && ![color.r, color.g, color.b].every(Number.isFinite)) return true;
      }
      return ['roughness', 'metalness', 'emissiveIntensity'].some((key) => key in material && !Number.isFinite(material[key]));
    })) {
      errors.push(`${label}: invalid or missing material`);
    }
  });
  if (errors.length) throw new Error(`City3D scene validation failed: ${errors.join('; ')}`);
  return true;
}
