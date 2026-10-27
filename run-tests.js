// Cross-platform test runner: executes every test/*.test.ts through tsx.
//
// Files run in PARALLEL, one process each, across the available cores.
//
// The sequential version launched `npx tsx` 143 times in a row. npx alone
// costs a second or two per launch before any test code runs, and the suite
// grew long enough that it routinely failed to finish within a working
// session — which meant fixes could not be verified end to end at all. Tests
// are already isolated (a process per file), so running them side by side is
// safe; calling the tsx CLI directly skips the npx startup entirely.
//
// Each file's output is buffered and printed as one block when that file
// finishes, so parallel runs never interleave lines. The summary lines are
// unchanged ("All N test files passed." / ">>> FAILED: name"), since tooling
// and people both read them.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(__dirname, 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort();
const tsxCli = path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Leave a core free so a Monte Carlo test does not starve the rest
const workers = Math.max(1, Math.min(files.length, (os.cpus().length || 2) - 1));

let next = 0;
let failed = 0;
const failures = [];

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [tsxCli, path.join(dir, file)], {
      cwd: __dirname,
      env: process.env,
    });
    const chunks = [];
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => chunks.push(d));
    child.on('close', (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(Buffer.concat(chunks));
      if (code !== 0) {
        failed++;
        failures.push(file);
        console.error(`\n>>> FAILED: ${file} (${secs}s)\n`);
      } else {
        console.log(`--- ${file} ok (${secs}s)`);
      }
      resolve();
    });
  });
}

async function worker() {
  while (next < files.length) {
    const file = files[next++];
    await runOne(file);
  }
}

const suiteStart = Date.now();
Promise.all(Array.from({ length: workers }, worker)).then(() => {
  const mins = ((Date.now() - suiteStart) / 60000).toFixed(1);
  console.log(
    failed === 0
      ? `\nAll ${files.length} test files passed. (${mins} min, ${workers} workers)`
      : `\n${failed} of ${files.length} test files FAILED. (${mins} min, ${workers} workers)`,
  );
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  process.exit(failed > 0 ? 1 : 0);
});
