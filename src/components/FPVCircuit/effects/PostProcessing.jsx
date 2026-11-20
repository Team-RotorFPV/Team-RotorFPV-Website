import React from 'react';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { useFPVCircuit } from '../FPVCircuitProvider';

export const CircuitPostProcessing = () => {
  const { qualitySettings } = useFPVCircuit();

  if (!qualitySettings.bloom) return null;

  return (
    <EffectComposer disableNormalPass>
      {qualitySettings.bloom && (
        <Bloom 
          luminanceThreshold={0.5} 
          luminanceSmoothing={0.9} 
          intensity={0.4} 
          mipmapBlur 
        />
      )}
      <Vignette eskil={false} offset={0.1} darkness={1.1} />
    </EffectComposer>
  );
};
