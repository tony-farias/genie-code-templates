import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runQuery, withUserAuthorization } from './api/sql.js';
import { mountScintillaRoutes } from './api/routes.scintilla.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || process.env.DATABRICKS_APP_PORT || 8000;

app.use(express.json());
app.use(withUserAuthorization);

app.get('/api/health', async (_req, res) => {
  try {
    const r = await runQuery('SELECT 1 AS ok');
    res.json({ ok: true, sql: r[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

mountScintillaRoutes(app);

// Hashed asset bundles are content-addressed (Vite adds a hash to each filename)
// so they're safe to cache aggressively.
app.use('/assets', express.static(path.join(__dirname, 'dist', 'assets'), {
  immutable: true,
  maxAge: '30d',
}));

// Other static files (favicon, manifest) served normally.
app.use(express.static(path.join(__dirname, 'dist')));

// Return 404 on missing static assets (JS/CSS/img/etc) so the SPA shell never
// gets returned for a missing asset path — prevents the "Loading chunk failed"
// trap where the browser parses index.html as JS after a stale chunk reference.
app.get(/\.(?:js|css|map|png|jpe?g|svg|ico|json|webmanifest)$/, (_req, res) => {
  res.status(404).end();
});

// SPA fallback — always serve a FRESH index.html so the browser picks up
// new chunk hashes immediately after a deploy (no stale-bookmark blank screens).
app.get('*', (_req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Warm the serverless SQL warehouse on boot so the first user-facing query
  // isn't stuck behind a cold-start spin-up. Fire-and-forget; never crash boot.
  runQuery('SELECT 1 AS ok')
    .then(() => console.log('[warmup] warehouse is warm'))
    .catch((e) => console.warn('[warmup] warehouse warm-up skipped:', e.message || e));
});
