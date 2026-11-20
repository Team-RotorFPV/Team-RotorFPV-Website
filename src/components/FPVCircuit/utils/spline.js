import * as THREE from 'three';

// Simple deterministic pseudo-random number generator
const mulberry32 = (a) => {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
};

export const generateDeterministicSpline = (achievements, year, startPos = new THREE.Vector3(0, 0, 0)) => {
  const points = [];
  points.push(startPos.clone());
  
  // Seed based on year to ensure the track for a given year is always the same
  const prng = mulberry32(year);

  let currentPos = startPos.clone();
  let currentDir = new THREE.Vector3(0, 0, -1); // Starting forward

  const segmentLength = 50;
  
  achievements.forEach(() => {
    // Generate a sequence of points for each achievement
    const numPointsPerSegment = 3;
    for (let i = 0; i < numPointsPerSegment; i++) {
      // Randomize direction slightly
      const randomYaw = (prng() - 0.5) * Math.PI / 2;
      const randomPitch = (prng() - 0.5) * Math.PI / 4;
      
      const axisY = new THREE.Vector3(0, 1, 0);
      const axisX = new THREE.Vector3(1, 0, 0).applyAxisAngle(axisY, randomYaw);
      
      currentDir.applyAxisAngle(axisY, randomYaw * 0.5);
      currentDir.applyAxisAngle(axisX, randomPitch * 0.5);
      currentDir.normalize();

      currentPos.add(currentDir.clone().multiplyScalar(segmentLength));
      points.push(currentPos.clone());
    }
  });
  
  // Add an exit point
  currentPos.add(currentDir.clone().multiplyScalar(segmentLength * 2));
  points.push(currentPos.clone());

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
};
