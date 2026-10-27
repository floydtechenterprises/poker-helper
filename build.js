const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'es2020',
  outdir: 'dist',
};

async function build() {
  // Content script
  const contentBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/content/main.ts'],
    outfile: 'dist/content.js',
    outdir: undefined,
    format: 'iife',
  });

  // Service worker
  const swBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/background/service-worker.ts'],
    outfile: 'dist/service-worker.js',
    outdir: undefined,
    format: 'iife',
  });

  // Popup
  const popupBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
    outdir: undefined,
    format: 'iife',
  });

  // Equity web worker
  const workerBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/engine/equity/worker-entry.ts'],
    outfile: 'dist/equity-worker.js',
    outdir: undefined,
    format: 'iife',
  });

  await Promise.all([contentBuild, swBuild, popupBuild, workerBuild]);

  // Copy static files to dist with corrected paths
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.content_scripts[0].js = manifest.content_scripts[0].js.map(p => p.replace('dist/', ''));
  manifest.background.service_worker = manifest.background.service_worker.replace('dist/', '');
  manifest.action.default_popup = manifest.action.default_popup.replace('dist/', '');
  manifest.web_accessible_resources[0].resources = manifest.web_accessible_resources[0].resources.map(p => p.replace('dist/', ''));
  delete manifest.icons;
  fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
  fs.copyFileSync('src/popup/popup.css', 'dist/popup.css');

  // Copy popup.html with corrected CSS path for dist
  let popupHtml = fs.readFileSync('src/popup/popup.html', 'utf8');
  popupHtml = popupHtml.replace('../popup/popup.css', 'popup.css');
  fs.writeFileSync('dist/popup.html', popupHtml);

  console.log('Build complete!');
}

if (isWatch) {
  // For watch mode, use context API
  async function watch() {
    const contexts = await Promise.all([
      esbuild.context({
        ...commonOptions,
        entryPoints: ['src/content/main.ts'],
        outfile: 'dist/content.js',
        outdir: undefined,
        format: 'iife',
      }),
      esbuild.context({
        ...commonOptions,
        entryPoints: ['src/background/service-worker.ts'],
        outfile: 'dist/service-worker.js',
        outdir: undefined,
        format: 'iife',
      }),
      esbuild.context({
        ...commonOptions,
        entryPoints: ['src/popup/popup.ts'],
        outfile: 'dist/popup.js',
        outdir: undefined,
        format: 'iife',
      }),
      esbuild.context({
        ...commonOptions,
        entryPoints: ['src/engine/equity/worker-entry.ts'],
        outfile: 'dist/equity-worker.js',
        outdir: undefined,
        format: 'iife',
      }),
    ]);

    for (const ctx of contexts) {
      await ctx.watch();
    }
    console.log('Watching for changes...');
  }
  watch();
} else {
  build().catch(() => process.exit(1));
}
