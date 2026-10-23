// build.mjs — bundle src/game.js and its imports into one self-contained page: dist/commuter-cave.html
import { build } from 'esbuild';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

// A hash of the code that makes worlds (species, landscape, spawn): every source file reachable from
// generator.js, landscape.js, geo.js and pack.js. Kept worlds are keyed by it (checkWorld in game.js).
const reach = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, dep] of fs.readFileSync(`src/${file}`, 'utf8').matchAll(/^import [^;]*? from '\.\/([\w-]+\.js)';/gm)) reach(dep, seen);
  return seen;
};
const genFiles = [...['generator.js', 'landscape.js', 'geo.js', 'pack.js'].reduce((s, f) => reach(f, s), new Set())].sort();
const genHash = createHash('sha256').update(genFiles.map(f => fs.readFileSync(`src/${f}`, 'utf8')).join('\0')).digest('hex').slice(0, 12);

const result = await build({
  entryPoints: ['src/game.js'], bundle: true, format: 'iife', target: 'es2020', write: false,
  define: { __GEN_HASH__: JSON.stringify(genHash) },
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) throw new Error('bundle contains </script; cannot inline safely');
const shell = fs.readFileSync('src/shell.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/commuter-cave.html', shell.replace('/*BUNDLE*/', js));
console.log(`dist/commuter-cave.html (${Math.round(fs.statSync('dist/commuter-cave.html').size / 1024)} KB)`);
