// Regenerate the vendored three.js files:  node vendor/update-three.mjs [version]
//
// Browsers refuse to load ES modules from file:// pages, so the ES module builds are
// wrapped into classic scripts that define a global `THREE` (plus `THREE.OrbitControls`).
// That way index.html opens straight from disk, with no network or server.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] || '0.170.0';
const base = `https://cdn.jsdelivr.net/npm/three@${version}`;
const outDir = dirname(fileURLToPath(import.meta.url));

async function get(path) {
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

// Replace the single trailing `export { a, b as c };` with assignments onto `target`.
function stripExport(src, target) {
  const re = /^export \{([^}]*)\};?\s*$/m;
  const matches = src.match(new RegExp(re.source, 'gm')) || [];
  if (matches.length !== 1) throw new Error(`expected exactly one export statement, found ${matches.length}`);
  return src.replace(re, (_, names) => names.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, exported = local] = s.split(/\s+as\s+/);
    return `${target}.${exported} = ${local};`;
  }).join('\n'));
}

const banner = `// three.js r${version.split('.')[1]} (${base}), wrapped as a classic script by vendor/update-three.mjs. Do not edit.\n`;

let core = await get('build/three.module.js');
if (/^\s*import\s/m.test(core)) throw new Error('three.module.js has imports; this version needs a real bundler');
core = stripExport(core, 'THREE');
await writeFile(join(outDir, 'three.js'), `${banner}(function () {\nconst THREE = window.THREE = {};\n${core}\n})();\n`);

let orbit = await get('examples/jsm/controls/OrbitControls.js');
const importRe = /^import\s*\{([^}]*)\}\s*from\s*'three';\s*$/m;
if (!importRe.test(orbit)) throw new Error('OrbitControls.js: unexpected import form');
orbit = orbit.replace(importRe, (_, names) => `const {${names}} = THREE;`);
orbit = stripExport(orbit, 'THREE');
await writeFile(join(outDir, 'OrbitControls.js'), `${banner}(function () {\n${orbit}\n})();\n`);

await writeFile(join(outDir, 'three-LICENSE'), await get('LICENSE'));
console.log(`wrote three.js, OrbitControls.js, three-LICENSE for three@${version}`);
