// build.mjs — bundle src/game.js and its imports into one self-contained page: dist/commuter-cave.html
import { build } from 'esbuild';
import fs from 'node:fs';

const result = await build({
  entryPoints: ['src/game.js'], bundle: true, format: 'iife', target: 'es2020', write: false,
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) throw new Error('bundle contains </script; cannot inline safely');
const shell = fs.readFileSync('src/shell.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/commuter-cave.html', shell.replace('/*BUNDLE*/', js));
console.log(`dist/commuter-cave.html (${Math.round(fs.statSync('dist/commuter-cave.html').size / 1024)} KB)`);
