// File: src/utils/logVersions.js
import * as THREE from 'three';

export async function logVersions() {
  // Three’s runtime revision:
  console.log(`[versions] three r${THREE.REVISION}`);

  // Best-effort: dynamically read package.json versions (may fail if bundler disallows)
  try {
    const fiber = await import('@react-three/fiber/package.json');
    console.log('[versions] @react-three/fiber', fiber.version);
  } catch {
    console.log('[versions] @react-three/fiber loaded (version not resolved)');
  }
  try {
    const drei = await import('@react-three/drei/package.json');
    console.log('[versions] @react-three/drei', drei.version);
  } catch {
    console.log('[versions] @react-three/drei loaded (version not resolved)');
  }
}