import React, { useMemo, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { generateContinuousTrack } from './track/TrackGenerator';
import { YearCircuit } from './track/YearCircuit';
import { FPVCamera, LOOK_AHEAD_DISTANCE } from './camera/FPVCamera';
import { CircuitPostProcessing } from './effects/PostProcessing';
import { useFPVCircuit } from './FPVCircuitProvider';
import { useFlightProgress, FlightController, setMaxProgress, setTotalTrackLength } from './utils/progress';
import { OSDOverlay } from './overlay/OSDOverlay';
import { detectWebGLSupport } from './utils/webglSupport';
import { FPVErrorBoundary } from './FPVErrorBoundary';
import { FPVUnsupported } from './FPVUnsupported';

const CircuitScene = ({ progress, continuousTrackData, isMobile, flyToNextGate, autoFly }) => {
  return (
    <>
      <fog attach="fog" args={['#050608', 500, 20000]} />
      <ambientLight intensity={0.15} color="#93C5FD" />
      <directionalLight position={[50, 50, -50]} intensity={0.3} color="#60A5FA" />
      <hemisphereLight skyColor="#0B1220" groundColor="#172033" intensity={0.2} />

      <FlightController />
      {continuousTrackData?.masterSpline && (
        <FPVCamera spline={continuousTrackData.masterSpline} />
      )}
      
      {continuousTrackData?.allIslandsData?.map((island, index) => (
        <group key={island.year}>
          {/* Render the single YearCircuit for this island's achievements and gates */}
          <YearCircuit yearData={island} startPos={island.startPos} index={index} />
        </group>
      ))}

      <CircuitPostProcessing />

      {isMobile && !autoFly && (
        <mesh 
          position={[0, 0, -5]} 
          onClick={() => flyToNextGate(Math.min(progress + 0.05, 1))}
        >
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </>
  );
};

export const FPVExperience = () => {
  const { progress, isMobile, flyToNextGate, pauseFlight, autoFly } = useFlightProgress();
  const { yearCircuits } = useFPVCircuit();

  // Bail out to a graceful fallback if the browser can't provide a WebGL context
  // capable of instanced rendering, rather than letting the renderer throw an
  // uncaught "ANGLE_instanced_arrays not supported" error and blank the page.
  const [webglSupported] = useState(() => detectWebGLSupport().supported);

  const continuousTrackData = useMemo(() => {
    if (!yearCircuits || yearCircuits.length === 0) return null;
    return generateContinuousTrack(yearCircuits);
  }, [yearCircuits]);

  // Clamp the maximum scroll so the camera rests one look-ahead distance short of
  // the spline's end, keeping the TRACK COMPLETE banner centered ahead and
  // preventing the user from scrolling past it.
  useEffect(() => {
    const spline = continuousTrackData?.masterSpline;
    if (!spline) return;
    const total = spline.getLength();
    setTotalTrackLength(total);
    if (total > LOOK_AHEAD_DISTANCE) {
      setMaxProgress((total - LOOK_AHEAD_DISTANCE) / total);
    }
    return () => setMaxProgress(1.02); // restore default if the track changes/unmounts
  }, [continuousTrackData]);

  if (!webglSupported) {
    return <FPVUnsupported />;
  }

  return (
    <>
      <FPVErrorBoundary>
        <Canvas
          camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 25000 }}
          gl={{ antialias: true, powerPreference: "high-performance", toneMappingExposure: 1.0 }}
          dpr={[1, 2]}
        >
          {continuousTrackData && (
            <CircuitScene
              progress={progress}
              continuousTrackData={continuousTrackData}
              isMobile={isMobile}
              flyToNextGate={flyToNextGate}
              pauseFlight={pauseFlight}
              autoFly={autoFly}
            />
          )}
        </Canvas>
      </FPVErrorBoundary>
      <OSDOverlay progress={progress} allIslandsData={continuousTrackData?.allIslandsData || []} />
      
      {isMobile && (
        <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1001 }}>
          <button 
            onClick={() => autoFly ? pauseFlight() : flyToNextGate(Math.min(progress + 0.05, 1))}
            style={{ 
              padding: '10px 20px', 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid rgba(255, 255, 255, 0.2)', 
              color: 'white', 
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            {autoFly ? 'PAUSE FLIGHT' : 'NEXT WAYPOINT'}
          </button>
        </div>
      )}
    </>
  );
};
