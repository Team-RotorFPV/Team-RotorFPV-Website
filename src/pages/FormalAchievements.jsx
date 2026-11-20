import React, { useState, useEffect, useMemo } from 'react';
import './FormalAchievements.css';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import Seo from '../components/Seo';

const FormalAchievements = () => {
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chosenYear, setSelectedYear] = useState('');
  const pillRef = React.useRef(null);
  const isWheelScrollingRef = React.useRef(false);

  useEffect(() => {
    const q = query(collection(db, 'achievements'), orderBy('order', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAchievements(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching achievements: ", error);
      // Fallback data for preview/testing
      setAchievements([
        { id: '1', title: 'National Champions', year: '2023', position: '1st', description: 'Won the national drone racing championship.' },
        { id: '2', title: 'Best Engineering', year: '2023', position: '2nd', description: 'Awarded for best custom frame design.' },
        { id: '3', title: 'Global Qualifiers', year: '2024', position: '3rd', description: 'Qualified for the international tournament.' },
        { id: '4', title: 'Speed Record', year: '2024', position: '1st', description: 'Broke the track speed record.' },
        { id: '5', title: 'Innovation Award', year: '2025', position: '1st', description: 'New aerodynamic propulsion system.' },
        { id: '6', title: 'Endurance Test', year: '2025', position: '2nd', description: 'Longest flight time in competition.' },
        { id: '7', title: 'Autonomous Flight', year: '2026', position: '1st', description: 'First fully autonomous circuit completion.' },
      ]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const availableYears = useMemo(() => {
    const years = achievements.map(a => a.year).filter(Boolean);
    return [...new Set(years)].sort((a, b) => b - a);
  }, [achievements]);

  // Until someone picks a year: the year shared from the other achievements
  // view if it exists here, otherwise the newest. Derived, not set in an effect.
  const defaultYear = useMemo(() => {
    let sharedYear = null;
    try { sharedYear = sessionStorage.getItem('shared_year'); } catch { /* storage blocked */ }
    return sharedYear && availableYears.includes(sharedYear) ? sharedYear : (availableYears[0] || '');
  }, [availableYears]);
  const selectedYear = chosenYear || defaultYear;

  const activeIndex = availableYears.indexOf(selectedYear);

  // Touch devices can't drive the year pill with a scroll wheel, so the mobile
  // arrows step through years directly. Years are sorted newest-first, so the
  // up arrow goes to a newer year (lower index) and down to an older one.
  const goToNewerYear = () => {
    if (activeIndex > 0) setSelectedYear(availableYears[activeIndex - 1]);
  };
  const goToOlderYear = () => {
    if (activeIndex >= 0 && activeIndex < availableYears.length - 1) {
      setSelectedYear(availableYears[activeIndex + 1]);
    }
  };

  useEffect(() => {
    if (selectedYear) {
      sessionStorage.setItem('shared_year', selectedYear);
    }
  }, [selectedYear]);

  useEffect(() => {
    const pill = pillRef.current;
    if (!pill || availableYears.length === 0) return;

    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (isWheelScrollingRef.current) return;
      
      const currentIndex = activeIndex;
      let nextIndex = currentIndex;
      
      if (e.deltaY > 0 && currentIndex < availableYears.length - 1) {
        nextIndex = currentIndex + 1; // Scroll down goes to older years
      } else if (e.deltaY < 0 && currentIndex > 0) {
        nextIndex = currentIndex - 1; // Scroll up goes to newer years
      }
      
      if (nextIndex !== currentIndex && nextIndex >= 0 && nextIndex < availableYears.length) {
        isWheelScrollingRef.current = true;
        setSelectedYear(availableYears[nextIndex]);
        
        // Cooldown
        setTimeout(() => {
          isWheelScrollingRef.current = false;
        }, 300); 
      }
    };

    pill.addEventListener('wheel', handleWheel, { passive: false });
    return () => pill.removeEventListener('wheel', handleWheel);
  }, [activeIndex, availableYears]);

  const filteredAchievements = achievements.filter(a => a.year === selectedYear);

  if (loading) {
    return (
      <div className="formal-achievements-loading">
        LOADING ACHIEVEMENTS...
      </div>
    );
  }

  return (
    <div className="formal-achievements-page">
      <Seo description="Team RotorFPV's competition results and milestones — championships, records, and awards across years of FPV drone racing at VIT." />
      {/* The 3D Rotating Year Dropdown Pill */}
      {availableYears.length > 0 && (
        <div className="fa-pill-container" ref={pillRef}>
          <div className="fa-cylinder-container">
            {availableYears.map((year, index) => {
              const offset = index - activeIndex;
              const isVisible = Math.abs(offset) <= 2;

              return (
                <div
                  key={year}
                  className="fa-cylinder-item"
                  style={{
                    transform: `rotateX(${-offset * 45}deg) translateZ(25px)`,
                    opacity: isVisible ? 1 - Math.abs(offset) * 0.5 : 0,
                    pointerEvents: isVisible ? 'auto' : 'none',
                    color: offset === 0 ? '#ffffff' : '#888888'
                  }}
                  onClick={() => setSelectedYear(year)}
                >
                  {year}
                </div>
              );
            })}
          </div>

          {/* Mobile-only year steppers (no scroll wheel on touch) */}
          <button
            type="button"
            className="fa-pill-arrow fa-pill-arrow--up"
            onClick={goToNewerYear}
            disabled={activeIndex <= 0}
            aria-label="Newer year"
          >
            ▲
          </button>
          <button
            type="button"
            className="fa-pill-arrow fa-pill-arrow--down"
            onClick={goToOlderYear}
            disabled={activeIndex >= availableYears.length - 1}
            aria-label="Older year"
          >
            ▼
          </button>
        </div>
      )}

      <div className="formal-achievements-list">
        {filteredAchievements.map((data, index) => (
          <div key={data.id || index} className="formal-achievement-item">
            {/* LEFT COLUMN: Title */}
            <div className="fa-col fa-title-col">
              <h2>{data.title}</h2>
            </div>

            {/* CENTER COLUMN: Visual Focus */}
            <div className="fa-col fa-visual-col">
              {data.images && data.images.length > 0 && data.images[0] ? (
                <div className="fa-image-wrapper">
                  <img src={data.images[0]} alt={data.title} />
                </div>
              ) : (
                <div className="fa-placeholder">
                  <div className="fa-placeholder-inner" />
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Description */}
            <div className="fa-col fa-desc-col">
              <p>{data.description}</p>
            </div>
          </div>
        ))}
        {filteredAchievements.length === 0 && (
          <div className="fa-no-data">No achievements found for this year.</div>
        )}
      </div>
    </div>
  );
};

export default FormalAchievements;
