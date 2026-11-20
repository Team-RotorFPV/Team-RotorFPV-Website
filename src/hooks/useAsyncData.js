import { useCallback, useEffect, useState } from 'react';

// Run an async loader on mount, and again whenever reload() is called.
// `load` must be stable (a module-level function or a useCallback).
//
// State only changes from the promise callbacks or from reload() (an event
// handler), never synchronously inside the effect, so there is no extra
// cascading render, and a response that arrives after unmount is ignored.
export default function useAsyncData(load) {
  const [state, setState] = useState({ data: undefined, loading: true, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => { if (!cancelled) setState({ data, loading: false, error: null }); },
      (error) => { if (!cancelled) setState((prev) => ({ ...prev, loading: false, error })); },
    );
    return () => { cancelled = true; };
  }, [load, version]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    setVersion((v) => v + 1);
  }, []);

  return { ...state, reload };
}
