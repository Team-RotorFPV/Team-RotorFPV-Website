import React from 'react';
import { Cylinder, Text } from '@react-three/drei';

export const AchievementPedestal = ({ position }) => {
  return (
    <group position={[position.x, position.y - 1, position.z]}>
      {/* Hexagonal Platform (Cylinder with 6 radial segments) */}
      <Cylinder args={[30, 28, 2, 6]} rotation={[0, Math.PI / 6, 0]}>
        <meshStandardMaterial 
          color="#172033" 
          roughness={0.7} 
          metalness={0.8} 
        />
      </Cylinder>
      
      {/* Inner carbon fiber style hexagon */}
      <Cylinder args={[24, 24, 2.1, 6]} rotation={[0, Math.PI / 6, 0]}>
        <meshStandardMaterial 
          color="#0B1220" 
          roughness={0.9} 
          metalness={0.5} 
        />
      </Cylinder>

      {/* Blue Rim Light Edge */}
      <Cylinder args={[30.2, 28.2, 0.2, 6]} position={[0, 0.5, 0]} rotation={[0, Math.PI / 6, 0]}>
        <meshBasicMaterial 
          color="#60A5FA" 
          transparent 
          opacity={0.4} 
        />
      </Cylinder>
    </group>
  );
};

export const YearMonument = ({ year, position }) => {
  // Massive intro sculpture that the camera flies over/past
  return (
    <group position={[position.x, position.y + 15, position.z]}>
      <Text
        position={[0, 0, 0]}
        fontSize={40}
        color="#E5E7EB"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.05}
        font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff"
      >
        {year}
      </Text>
      
      <Text
        position={[0, -25, 0]}
        fontSize={10}
        color="#60A5FA"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.2}
        font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff"
      >
        ACHIEVEMENTS
      </Text>
      
      {/* Subtle lighting for the monument */}
      <pointLight position={[0, -10, 20]} intensity={0.5} color="#93C5FD" distance={100} decay={2} />
    </group>
  );
};

export const TrackComplete = ({ position }) => {
  // Shown at the very end of the track, once every year's achievements have been
  // flown through and there are no prior years left to visit.
  return (
    <group position={[position.x, position.y + 15, position.z]}>
      <Text
        position={[0, 0, 0]}
        fontSize={32}
        color="#E5E7EB"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.1}
        font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff"
      >
        TRACK COMPLETE
      </Text>
    </group>
  );
};
