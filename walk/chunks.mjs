// The flat tool never pays for 3D: builds the page into a scratch folder with a plugin that lists
// each chunk's modules, then fails if any module under node_modules/three/ sits in the entry chunk or
// in a chunk the entry imports statically. Its positive control: three must be found in a chunk the
// entry reaches only through a dynamic import (a grep for three's banner finds nothing either way:
// the build strips it).
// The 3D layout's code (the SDK's `layoutByLinks3d`) runs in a module file worker of its own and never
// sits in the page's first script: the emitted files are read for `held-box`, a string only the layout
// code holds, which must be in the worker's file (its known positive) and in no file the entry loads
// statically; the entry must name the worker's file (a file worker, never an inline `blob:` one, which
// the CSP refuses).
//   node walk/chunks.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { build } from 'vite';

const chunks = [];
await build({
  logLevel: 'warn',
  build: { outDir: '.scratch/chunks-build', emptyOutDir: true },
  plugins: [{
    name: 'list-chunks',
    generateBundle(_o, bundle) {
      for (const c of Object.values(bundle)) {
        if (c.type !== 'chunk') continue;
        chunks.push({ file: c.fileName, entry: c.isEntry, imports: c.imports, dynamic: c.dynamicImports, modules: c.moduleIds ?? Object.keys(c.modules ?? {}) });
      }
    },
  }],
});

const byFile = new Map(chunks.map((c) => [c.file, c]));
const isThree = (m) => /[\\/]node_modules[\\/]three[\\/]/.test(m);
const statics = new Set();
const walk = (f) => {
  if (statics.has(f)) return;
  statics.add(f);
  for (const i of byFile.get(f)?.imports ?? []) walk(i);
};
for (const c of chunks) if (c.entry) walk(c.file);
const dynamics = new Set();
for (const f of statics) for (const d of byFile.get(f)?.dynamic ?? []) if (!statics.has(d)) dynamics.add(d);

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fail++;
};
const leaked = [...statics].flatMap((f) => byFile.get(f).modules.filter(isThree).map((m) => `${f}: ${m}`));
check('no three.js module in the entry or its static imports', leaked.length === 0, leaked.slice(0, 3).join('; '));
const found = [...dynamics].flatMap((f) => byFile.get(f).modules.filter(isThree));
check('three.js found in a chunk reached only by a dynamic import (the positive control)', found.length > 0, `${found.length} modules in ${[...dynamics].join(', ')}`);
const OUT = '.scratch/chunks-build/assets';
const files = readdirSync(OUT).filter((f) => f.endsWith('.js'));
const text = (f) => readFileSync(`${OUT}/${f}`, 'utf8');
const workers = files.filter((f) => /^links3d\.worker-[\w-]+\.js$/.test(f));
check('the layout worker is a file of its own', workers.length === 1, workers.join(', ') || 'none');
check('the layout code is in the worker file (the positive control: held-box found)', workers.length === 1 && text(workers[0]).includes('held-box'));
// The entries and their static imports, as emitted (an entry with no script of its own emits no file).
const entryText = [...statics].filter((f) => files.includes(f.replace(/^assets\//, ''))).map((f) => ({ f, t: readFileSync(`.scratch/chunks-build/${f}`, 'utf8') }));
const holding = entryText.filter((e) => e.t.includes('held-box')).map((e) => e.f);
check('no held-box in the entry or its static imports', entryText.length > 0 && holding.length === 0, holding.join(', ') || `${entryText.length} files read: ${entryText.map((e) => e.f).join(', ')}`);
const made = entryText.flatMap((e) => e.t.match(/new Worker\(new URL\(`[^`]*`/g) ?? []);
check('the entry makes the worker from its file (a file worker, never a blob)', workers.length === 1 && made.length === 1 && made[0].includes(`/assets/${workers[0]}`), made.join(' | '));
check('three.js stays out of the worker file', workers.length === 1 && !text(workers[0]).includes('WebGLRenderer'));
console.log(`chunks: ${chunks.map((c) => `${c.file}${c.entry ? ' (entry)' : ''}`).join(', ')}`);
process.exit(fail ? 1 : 0);
