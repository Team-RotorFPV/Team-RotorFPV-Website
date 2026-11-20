import { useEffect, useState } from 'react';

// The current time, refreshed on every `intervalMs` boundary of the clock.
//
// Defaults to once a minute: Event Schedules use whole-minute times, so a
// minute-aligned tick flips an event to Live/Past at exactly the right moment.
// It used to tick every second, re-rendering all of Home and Events (and their
// heavy animated components) for nothing. Only <LiveCountdown> on the Events
// page needs seconds, and it asks for them itself.
const useEventNow = (intervalMs = 60_000) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, intervalMs - (Date.now() % intervalMs));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [intervalMs]);

  return now;
};

export default useEventNow;
