import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useFPVCircuit } from '../FPVCircuitProvider';

export const TrackVisuals = ({ spline }) => {
  const { qualitySettings } = useFPVCircuit();

  const points = useMemo(() => {
    // 200 points for a smooth line
    return spline.getPoints(200);
  }, [spline]);

  return (
    <group>
      {/* Thin Energy Corridor / Path */}
      <Line
        points={points}
        color="#00E5FF"
        lineWidth={qualitySettings.bloom ? 2 : 1}
        transparent
        opacity={0.3}
      />
      {qualitySettings.bloom && (
        <Line
          points={points}
          color="#ffffff"
          lineWidth={1}
          transparent
          opacity={0.8}
        />
      )}
    </group>
  );
};
