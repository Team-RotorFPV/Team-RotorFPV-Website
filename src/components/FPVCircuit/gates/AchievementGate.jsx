import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { AchievementHologram } from '../holograms/AchievementHologram';

import { NeonRing } from '../effects/NeonRing';

export const AchievementGate = ({ gateData }) => {
  const { worldPosition, rotation } = gateData;
  const placement = typeof gateData.position === 'string' ? gateData.position.toLowerCase() : '';

  const { geometry, outerGeo, innerGeo } = useMemo(() => {
    let baseRadius = 25;
    let tubeRadius = 3.5;

    if (placement.includes('1st')) {
      baseRadius = 28;
      tubeRadius = 4.0;
    } else if (placement.includes('2nd')) {
      baseRadius = 26;
      tubeRadius = 3.8;
    } else if (placement.includes('3rd')) {
      baseRadius = 25;
      tubeRadius = 3.5;
    }

    return { 
      geometry: <torusGeometry args={[baseRadius, tubeRadius, 16, 64]} />,
      outerGeo: new THREE.TorusGeometry(baseRadius + tubeRadius + 0.1, 0.15, 16, 64),
      innerGeo: new THREE.TorusGeometry(baseRadius - tubeRadius - 0.1, 0.15, 16, 64)
    };
  }, [placement]);

  // These geometries are created imperatively (not via JSX), so R3F won't
  // auto-dispose them. Free the GPU buffers when they change or on unmount.
  useEffect(() => () => {
    outerGeo.dispose();
    innerGeo.dispose();
  }, [outerGeo, innerGeo]);

  const hasImage = (gateData.images && gateData.images.length > 0) || gateData.imageUrl;

  return (
    <group position={worldPosition} rotation={rotation}>
      {!hasImage && (
        <>
          <mesh>
            {geometry}
            <meshPhysicalMaterial 
              color="#0F172A" // Dark slate
              emissive="#2563EB" // Muted deep blue glow
              emissiveIntensity={0.5}
              transmission={0.99} 
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
          <NeonRing geometry={outerGeo} color="#FF5722" baseIntensity={15} />
          <NeonRing geometry={innerGeo} color="#FF5722" baseIntensity={15} />
        </>
      )}
      {/* Show hologram exhibit unconditionally so it can be seen from miles away */}
      <AchievementHologram data={gateData} />
    </group>
  );
};
