import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';

export const NeonRing = ({ geometry, color = "#FF5722", baseIntensity = 15 }) => {
  const materialRef = useRef();
  
  // Create a unique random offset for this specific ring so they don't all flicker at the exact same time
  const [randomOffset] = useState(() => Math.random() * 100);

  useFrame((state) => {
    if (!materialRef.current) return;
    
    const t = state.clock.elapsedTime + randomOffset;
    
    // We want a sparse, glitchy flicker. 
    // We use a combination of low frequency sine wave and random noise.
    // If sin(t * 2) > 0.8, we enter a "flicker period"
    if (Math.sin(t * 1.5) > 0.85) {
      // During flicker period, wildly modulate intensity
      if (Math.random() > 0.5) {
        materialRef.current.emissiveIntensity = baseIntensity * (0.1 + Math.random() * 0.4); // Drops low
      } else {
        materialRef.current.emissiveIntensity = baseIntensity; // Spikes back to normal
      }
    } else {
      // Normal state: slowly smoothly return to full intensity just in case
      materialRef.current.emissiveIntensity += (baseIntensity - materialRef.current.emissiveIntensity) * 0.2;
      
      // Micro-flicker: a very tiny random drop occasionally
      if (Math.random() > 0.98) {
        materialRef.current.emissiveIntensity = baseIntensity * 0.8;
      }
    }
  });

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial 
        ref={materialRef}
        color="#000000" 
        emissive={color} 
        emissiveIntensity={baseIntensity} 
        toneMapped={false} 
      />
    </mesh>
  );
};
