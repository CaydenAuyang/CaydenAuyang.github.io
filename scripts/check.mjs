// check.mjs: "npm run check", every check in one command, against a fresh production build.
//
// In order:
//   1. build         astro build
//   2. types         astro check (TypeScript in .astro and .ts files), then the browser code
//                    again without Node's types (tsc -p tsconfig.client.json)
//   3. a11y          scripts/check-a11y.mjs (axe, WCAG 2.2 A and AA)
//   4. devices       scripts/devices.mjs (15 phone, tablet and desktop sizes, V4.md 8.9)
//   5. budgets       scripts/budgets.mjs (JavaScript, the intro chunk, first load on a phone)
// Steps 3 to 5 run against the build, served by scripts/serve.mjs on a free port, which this
// starts and stops itself. If the build fails, nothing else can run; any other failure doesn't
// stop the later steps, so one run lists everything. It exits with code 1 if any step failed.
//
// Options:
//   --webkit             also run the device check in WebKit (Safari's engine)
//   --out-dir=<folder>   build there instead of dist/ (to run beside another build)
//   --skip=types,a11y    leave steps out
//   --lighthouse         pass --lighthouse to the budgets (Lighthouse mobile; fetched with npx)
//   --shots              save the device check's screenshots to .devices/
//   --only=a,b           device check: only these sizes (names as in scripts/devices.mjs)
//   --shard=1/2          device check: every second size, starting with the first (CI's split)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { serve } from './serve.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outDir = path.resolve(arg('out-dir') || 'dist');
const skip = new Set((arg('skip') || '').split(',').filter(Boolean));
const webkit = process.argv.includes('--webkit');
const lighthouse = process.argv.includes('--lighthouse');
const shots = process.argv.includes('--shots') ? ['--shots'] : [];
const devicesArgs = [...shots, ...process.argv.filter((a) => a.startsWith('--only=') || a.startsWith('--shard='))];
const results = [];

function run(command, args, env = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', (error) => {
      console.error(error.message);
      done(1);
    });
    child.on('exit', (code, signal) => done(signal ? 1 : code));
  });
}

// One step: a command, or several in a row ([[command, args], ...]); a step with several runs
// them all, so one run lists every error, and fails if any fails.
async function step(name, command, args, env) {
  if (skip.has(name)) {
    results.push({ name, status: 'skipped', seconds: 0 });
    return true;
  }
  const start = Date.now();
  let ok = true;
  for (const [c, a] of Array.isArray(command) ? command : [[command, args]]) {
    console.log(`\n==== ${name}: ${[c, ...a].join(' ')}\n`);
    if ((await run(c, a, env)) !== 0) ok = false;
  }
  results.push({ name, status: ok ? 'pass' : 'FAIL', seconds: (Date.now() - start) / 1000 });
  return ok;
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;
const built = await step('build', npx, ['astro', 'build', ...(outDir !== path.resolve('dist') ? ['--outDir', outDir] : [])]);

if (built) {
  await step('types', [
    [npx, ['astro', 'check']],
    [npx, ['tsc', '-p', 'tsconfig.client.json']],
  ]);
  const { server, url } = await serve(outDir, 0);
  console.log(`\nServing ${outDir} at ${url}`);
  const env = { BASE: url };
  await step('a11y', node, ['scripts/check-a11y.mjs'], env);
  await step('devices', node, ['scripts/devices.mjs', ...devicesArgs], env);
  if (webkit) await step('devices-webkit', node, ['scripts/devices.mjs', '--webkit', ...devicesArgs], env);
  await step('budgets', node, ['scripts/budgets.mjs', `--dist=${outDir}`, ...(lighthouse ? ['--lighthouse'] : [])], env);
  server.close();
}

console.log('\n==== Summary');
for (const { name, status, seconds } of results) console.log(`  ${status.padEnd(8)} ${name.padEnd(16)} ${seconds ? `${seconds.toFixed(0)} s` : ''}`);
if (!built) console.log('  The build failed, so nothing else ran.');
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(failed ? `\n${failed} step(s) failed.` : '\nEverything passed.');
process.exit(failed ? 1 : 0);
