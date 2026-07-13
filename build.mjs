// build.mjs — produce an upload-ready `dist/` for CrazyGames.
//
// - Bundles all ES modules (src/main.js + imports) into one minified IIFE via esbuild.
//   Phaser stays a global provided by the local phaser.min.js, so it is NOT re-bundled.
// - Vendors Phaser locally (CrazyGames forbids external CDNs — except its own SDK).
// - Keeps the CrazyGames SDK loading from sdk.crazygames.com (required by the platform).
// - Copies level data so the runtime fetch resolves at the same relative path as in dev.
import esbuild from 'esbuild';
import { rm, mkdir, cp, writeFile, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = `${root}dist`;

const PROD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <title>Gravity Ball</title>
    <link rel="icon" href="data:," />
    <style>
      html, body {
        margin: 0; padding: 0; height: 100%;
        overflow: hidden;
        font-family: system-ui, sans-serif;
        touch-action: none; overscroll-behavior: none;
        background: #0d1018;
        background: radial-gradient(130% 90% at 50% 30%, #171d31 0%, #0d1018 72%);
      }
      #game-root { width: 100vw; height: 100vh; height: 100dvh; }
      canvas { display: block; }
      #loading { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 16px; }
      #loading .spinner { width: 42px; height: 42px; border-radius: 50%;
        border: 4px solid #2a3050; border-top-color: #38e1ff; animation: gb-spin .9s linear infinite; }
      #loading .label { color: #7a80a8; font-size: 13px; letter-spacing: .15em; text-transform: uppercase; }
      @keyframes gb-spin { to { transform: rotate(360deg); } }
    </style>

    <!-- Physics/render engine, vendored locally (no external CDN in production). -->
    <script src="phaser.min.js"></script>
    <!-- CrazyGames SDK v3 — the one external the platform requires. -->
    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
  </head>
  <body>
    <div id="game-root"></div>
    <div id="loading"><div class="spinner"></div><div class="label">Loading</div></div>
    <script src="bundle.js"></script>
  </body>
</html>
`;

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  // 1. Bundle our source. `Phaser` and other globals are left as free references.
  const result = await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2019',
    outfile: 'dist/bundle.js',
    legalComments: 'none',
    metafile: true,
  });

  // 1b. Bundle the level editor (separate entry point / page).
  await esbuild.build({
    entryPoints: ['src/editor/main.js'],
    bundle: true, minify: true, format: 'iife', target: 'es2019',
    outfile: 'dist/editor.js', legalComments: 'none',
  });

  // 2. Vendor Phaser.
  await copyFile('node_modules/phaser/dist/phaser.min.js', 'dist/phaser.min.js');

  // 3. Level data (kept at its dev-relative path so the runtime fetch is unchanged).
  await mkdir(`${dist}/src/data`, { recursive: true });
  await copyFile('src/data/levels.json', 'dist/src/data/levels.json');

  // 4. Any real assets (sprites/audio/fonts).
  await cp('assets', 'dist/assets', { recursive: true }).catch(() => {});

  // 5. Production entry point.
  await writeFile('dist/index.html', PROD_HTML);

  // 5b. Editor page — reuse dev editor.html, swapping the CDN/module refs for local ones.
  const editorHtml = (await readFile('editor.html', 'utf8'))
    .replace('https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js', 'phaser.min.js')
    .replace('<script type="module" src="/src/editor/main.js"></script>', '<script src="editor.js"></script>');
  await writeFile('dist/editor.html', editorHtml);

  const bundleBytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`\n  dist/ ready`);
  console.log(`    bundle.js   ${(bundleBytes / 1024).toFixed(1)} KB (minified)`);
  console.log(`    + phaser.min.js, index.html, src/data/levels.json`);
  console.log(`\n  Test locally:  SERVE_DIR=dist PORT=3001 node serve.mjs`);
  console.log(`  Upload:        zip the CONTENTS of dist/ (index.html at the zip root) → CrazyGames.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
