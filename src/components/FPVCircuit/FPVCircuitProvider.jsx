import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { detectQuality, getQualitySettings } from './utils/performance';

const FPVCircuitContext = createContext();

export const useFPVCircuit = () => useContext(FPVCircuitContext);

const GATE_TYPES = ['square', 'circular', 'hexagonal', 'split', 'tunnel'];
const SEGMENT_TYPES = ['straight', 'curve_left', 'curve_right', 'hairpin', 'dive', 'climb', 'spiral'];

export const FPVCircuitProvider = ({ children, rawAchievements }) => {
  const [quality, setQuality] = useState('high');
  const [activeGate, setActiveGate] = useState(null);
  const [chosenYear, setSelectedYear] = useState(null);
  
  useEffect(() => {
    detectQuality().then(({ quality }) => setQuality(quality));
  }, []);

  const qualitySettings = useMemo(() => getQualitySettings(quality), [quality]);

  // Data Enrichment
  const achievements = useMemo(() => {
    return rawAchievements.map((a, i) => {
      // Deterministic segment/gate selection based on string hash or index
      const idStr = a.id || String(i);
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
      }
      hash = Math.abs(hash);

      // Map position to segment rules
      let segmentType = a.segmentType;
      if (!segmentType) {
        if (a.position?.toLowerCase().includes('1st')) segmentType = 'spiral';
        else if (a.position?.toLowerCase().includes('2nd')) segmentType = 'hairpin';
        else if (a.position?.toLowerCase().includes('3rd')) segmentType = 'curve_right';
        else segmentType = SEGMENT_TYPES[hash % SEGMENT_TYPES.length];
      }

      return {
        ...a,
        gateType: a.gateType ?? GATE_TYPES[hash % GATE_TYPES.length],
        segmentType,
        videos: a.videos ?? [],
        images: a.images ?? (a.imageUrl ? [a.imageUrl] : []),
        stats: a.stats ?? {}
      };
    });
  }, [rawAchievements]);

  // Year Circuits Separation
  const yearCircuits = useMemo(() => {
    const grouped = achievements.reduce((acc, ach) => {
      const year = ach.year || '2024'; // Default if none
      if (!acc[year]) acc[year] = [];
      acc[year].push(ach);
      return acc;
    }, {});
    
    return Object.entries(grouped)
      .sort(([yearA], [yearB]) => Number(yearB) - Number(yearA)) // Descending order
      .map(([year, achs]) => ({
        year,
        achievements: achs
      }));
  }, [achievements]);

  const availableYears = useMemo(() => {
    return yearCircuits.map(c => c.year);
  }, [yearCircuits]);

  // Until someone picks a year, show the newest (availableYears is descending).
  const selectedYear = chosenYear ?? availableYears[0] ?? null;

  return (
    <FPVCircuitContext.Provider value={{
      achievements,
      yearCircuits,
      qualitySettings,
      activeGate,
      setActiveGate,
      quality,
      selectedYear,
      setSelectedYear,
      availableYears
    }}>
      {children}
    </FPVCircuitContext.Provider>
  );
};
