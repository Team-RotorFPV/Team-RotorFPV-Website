import React from 'react';
import * as THREE from 'three';
import { Cone } from '@react-three/drei';

import { NeonRing } from '../effects/NeonRing';

export const RaceGate = ({ position }) => {
  const outerGeo = React.useMemo(() => new THREE.TorusGeometry(23.6, 0.15, 16, 64), []);
  const innerGeo = React.useMemo(() => new THREE.TorusGeometry(16.4, 0.15, 16, 64), []);

  // Imperatively-created geometries aren't auto-disposed by R3F; free them on unmount.
  React.useEffect(() => () => {
    outerGeo.dispose();
    innerGeo.dispose();
  }, [outerGeo, innerGeo]);

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* Clean Glass Filler Loop */}
      <mesh>
        <torusGeometry args={[20, 3.5, 16, 64]} />
        <meshPhysicalMaterial 
          color="#0F172A" // Dark slate
          emissive="#2563EB" // Muted deep blue glow
          emissiveIntensity={0.5}
          transmission={0.99} // 99% transparent glass
          opacity={0.1}
          transparent={true}
          roughness={0.1}
          metalness={0.2}
          ior={1.5}
          thickness={5}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Outer Neon Border */}
      <NeonRing geometry={outerGeo} color="#FF5722" baseIntensity={15} />
      
      {/* Inner Neon Border */}
      <NeonRing geometry={innerGeo} color="#FF5722" baseIntensity={15} />

      {/* Directional Guide Arrows (Pointing Inwards) */}
      <group>
        <Cone args={[0.8, 3, 4]} position={[0, 18, 0]} rotation={[Math.PI, 0, 0]}>
          <meshBasicMaterial color="#ffffff" opacity={0.6} transparent />
        </Cone>
        <Cone args={[0.8, 3, 4]} position={[0, -18, 0]} rotation={[0, 0, 0]}>
          <meshBasicMaterial color="#ffffff" opacity={0.6} transparent />
        </Cone>
        <Cone args={[0.8, 3, 4]} position={[18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <meshBasicMaterial color="#ffffff" opacity={0.6} transparent />
        </Cone>
        <Cone args={[0.8, 3, 4]} position={[-18, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <meshBasicMaterial color="#ffffff" opacity={0.6} transparent />
        </Cone>
      </group>
    </group>
  );
};
