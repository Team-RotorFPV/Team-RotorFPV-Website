import React, { useEffect, useRef } from 'react';
import { useFPVCircuit } from '../FPVCircuitProvider';
import { resetProgress } from '../utils/progress';

export const OSDOverlay = ({ progress, allIslandsData }) => {
  const { availableYears } = useFPVCircuit();
  const pillRef = useRef(null);
  const isWheelScrollingRef = useRef(false);

  // Determine current active year based on global progress
  let activeIsland = null;
  let activeIslandIndex = 0;
  if (allIslandsData && allIslandsData.length > 0) {
    // Find the latest island we have entered
    for (let i = allIslandsData.length - 1; i >= 0; i--) {
      if (progress >= allIslandsData[i].startProgress) {
        activeIsland = allIslandsData[i];
        activeIslandIndex = i;
        break;
      }
    }
    // If we are before the first island's startProgress (e.g. at the very start)
    if (!activeIsland) {
      activeIsland = allIslandsData[0];
      activeIslandIndex = 0;
    }
  }


  const hasSyncedRef = useRef(false);

  // Initial sync from formal view
  useEffect(() => {
    if (!hasSyncedRef.current && availableYears && availableYears.length > 0 && allIslandsData && allIslandsData.length > 0) {
      const sharedYear = sessionStorage.getItem('shared_year');
      if (sharedYear) {
        const islandIndex = allIslandsData.findIndex(i => i.year === sharedYear);
        if (islandIndex !== -1 && activeIslandIndex !== islandIndex) {
          hasSyncedRef.current = true;
          resetProgress(allIslandsData[islandIndex].startProgress);
        } else {
          hasSyncedRef.current = true; // Synced successfully (already matching)
        }
      } else {
        hasSyncedRef.current = true; // Nothing to sync
      }
    }
  }, [availableYears, allIslandsData, activeIslandIndex]);

  // Wheel scrolling logic for the 3D Pill
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill || !availableYears || availableYears.length === 0 || !allIslandsData) return;

    const handleWheel = (e) => {
      e.preventDefault(); // Stop main page scrolling when hovering pill
      e.stopPropagation(); // Stop the event from reaching the global flight controller!
      
      if (isWheelScrollingRef.current) return;
      
      const currentIndex = activeIslandIndex;
      let nextIndex = currentIndex;
      
      if (e.deltaY > 0 && currentIndex < availableYears.length - 1) {
        nextIndex = currentIndex + 1; // Scroll down goes to older years
      } else if (e.deltaY < 0 && currentIndex > 0) {
        nextIndex = currentIndex - 1; // Scroll up goes to newer years
      }
      
      if (nextIndex !== currentIndex) {
        isWheelScrollingRef.current = true;
        const targetYear = allIslandsData[nextIndex].year;
        sessionStorage.setItem('shared_year', targetYear);
        // Jump progress to the start of the targeted year
        resetProgress(allIslandsData[nextIndex].startProgress);
        
        // Cooldown to prevent hyper-scrolling
        setTimeout(() => {
          isWheelScrollingRef.current = false;
        }, 600); 
      }
    };

    pill.addEventListener('wheel', handleWheel, { passive: false });
    return () => pill.removeEventListener('wheel', handleWheel);
  }, [activeIslandIndex, availableYears, allIslandsData]);

  // (A flight timer used to tick here every second, re-rendering the whole
  // overlay for a value that was never displayed.)
  let warningText = "";

  if (activeIsland) {
    const hasAchievements = activeIsland.checkpoints?.some(cp => cp.type === 'achievement');

    if (hasAchievements) {
      if (progress < 0.01) {
        warningText = "SCROLL TO ARM";
      }
    } else {
      warningText = "NO ACHIEVEMENTS";
    }
  }

  // FPV Battery Physics (Simulating a 6S LiPo 1300mAh battery)
  // Voltage drops across the entire progress of ALL years
  const batteryPct = Math.max(0, Math.min(100, 100 - (progress * 100)));
  const batteryVolts = (25.2 - (progress * 4.2)).toFixed(1);
  const batteryMah = "1300"; 
  
  // Color code the battery based on charge
  let batColor = '#44FF44'; // Green
  if (batteryPct < 40) batColor = '#FFFF44'; // Yellow
  if (batteryPct < 20) batColor = '#FF4444'; // Red

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
          
          .betaflight-osd {
            position: fixed;
            top: 50vh; left: 0; width: 100vw; height: 50vh;
            pointer-events: none;
            z-index: 1000;
            color: #ffffff;
            font-family: 'VT323', monospace;
            font-size: 26px;
            text-transform: uppercase;
            text-shadow: 2px 2px 0px #000, -1px -1px 0px #000, 1px -1px 0px #000, -1px 1px 0px #000, 1px 1px 0px #000;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 2vw 4vw;
            box-sizing: border-box;
          }
          
          .osd-blink {
            animation: blinker 1s steps(2, start) infinite;
          }
          
          @keyframes blinker {
            to { visibility: hidden; }
          }

          /* 3D Rotating Pill Timeline styles */
          .osd-pill-container {
            position: fixed;
            left: max(20px, calc(50% - 705px));
            top: 30px;
            width: 160px;
            height: 70px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            pointer-events: auto; /* Allow hovering and scrolling */
            z-index: 2000;
          }
          
          .osd-cylinder-container {
            position: relative;
            width: 100%;
            height: 100%;
            perspective: 600px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            border-radius: 20px;
          }
          
          .osd-cylinder-item {
            position: absolute;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            transform-style: preserve-3d;
            font-family: 'Inter', sans-serif;
            font-size: 20px;
            font-weight: 700;
            color: #ffffff;
            cursor: pointer;
            text-align: center;
            width: 100%;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            text-transform: none;
            letter-spacing: 1px;
          }
          
          /* Below ~1450px the navbar (max-width 1050px) reaches the corner where
             the pill would sit, so drop the pill beneath the navbar to avoid
             overlapping it. Above that, it tucks into the top-left corner. */
          @media screen and (max-width: 1450px) {
            .osd-pill-container {
              top: 120px;
            }
          }
        `}
      </style>
      
      <div className="betaflight-osd">
        {/* TOP ROW */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '30px' }}>
            {/* Moved to bottom right */}
          </div>
        </div>

        {/* CENTER CROSSHAIR */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: '15px', opacity: 0.6 }}>
          <div style={{ width: '20px', height: '2px', background: '#fff', boxShadow: '2px 2px 0px #000' }}></div>
          <div style={{ width: '4px', height: '4px', background: '#fff', boxShadow: '2px 2px 0px #000' }}></div>
          <div style={{ width: '20px', height: '2px', background: '#fff', boxShadow: '2px 2px 0px #000' }}></div>
        </div>

        {/* 3D PILL TIMELINE (RIGHT SIDE) */}
        {availableYears && availableYears.length > 0 && (
          <div className="osd-pill-container" ref={pillRef}>
            <div className="osd-cylinder-container">
              {availableYears.map((year, index) => {
                const offset = index - activeIslandIndex;
                const isVisible = Math.abs(offset) <= 2;
                
                return (
                  <div
                    key={year}
                    className="osd-cylinder-item"
                    style={{
                      transform: `rotateX(${-offset * 45}deg) translateZ(25px)`,
                      opacity: isVisible ? 1 - Math.abs(offset) * 0.5 : 0,
                      pointerEvents: isVisible ? 'auto' : 'none',
                      color: offset === 0 ? '#ffffff' : '#888888'
                    }}
                    onClick={() => {
                      if (allIslandsData && allIslandsData[index]) {
                        resetProgress(allIslandsData[index].startProgress);
                      }
                    }}
                  >
                    {year}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* BOTTOM MIDDLE WARNINGS */}
        {warningText && (
          <div className="osd-blink" style={{ position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)', fontSize: '32px', color: '#FF4444' }}>
            {warningText}
          </div>
        )}

        {/* BOTTOM ROW */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <span>BAT <span style={{ color: batColor }}>{batteryPct.toFixed(0)}%</span></span>
            <span style={{ color: batColor }}>{batteryMah} mAh</span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
            <span><span style={{ color: batColor }}>{batteryVolts}</span> V</span>
            <span>RSSI <span style={{ color: '#44FF44' }}>99</span></span>
            <span>SATS 18</span>
          </div>
        </div>
      </div>
    </>
  );
};
