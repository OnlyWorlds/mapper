// The flat tool never pays for 3D: builds the page into a scratch folder with a plugin that lists
// each chunk's modules, then fails if any module under node_modules/three/ sits in the entry chunk or
// in a chunk the entry imports statically. Its positive control: three must be found in a chunk the
// entry reaches only through a dynamic import (a grep for three's banner finds nothing either way:
// the build strips it).
//   node walk/chunks.mjs
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
console.log(`chunks: ${chunks.map((c) => `${c.file}${c.entry ? ' (entry)' : ''}`).join(', ')}`);
process.exit(fail ? 1 : 0);
