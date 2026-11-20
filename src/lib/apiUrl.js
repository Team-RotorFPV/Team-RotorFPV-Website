// The backend base URL, for the whole frontend. Deliberately free of Firebase
// imports so public pages (App, Home) can use it without pulling Firebase into
// the main chunk. vite.config.js fails a production build when VITE_API_URL is
// missing, so the localhost fallback only ever applies in `vite dev`.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
