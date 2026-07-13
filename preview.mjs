// preview.mjs — serve the production build (dist/) locally. Cross-platform wrapper so
// `npm run preview` works on Windows cmd as well as POSIX shells.
process.env.SERVE_DIR = 'dist';
await import('./serve.mjs');
