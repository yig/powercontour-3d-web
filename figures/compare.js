// The comparison table of RECOVERY.md: every recovery method on the same samples, plus the raw
// power contour. `node figures/compare.js [n] [sampling]` prints Markdown rows. The fandisk is
// included if FANDISK (default ../../code-release/examples/fandisk.obj) exists.
// Settings are the viewer's defaults: seed 1, s = 0.1, exact tau, trust 2, tangent balls ρ = 0.5, cap 100.
'use strict';
const fs = require('fs'), path = require('path');
const PowerDiagram = require('../powerdiagram.js'), Recover = require('../recover.js'), Shapes = require('../shapes.js');

const B = 1.5, BAND = 0.1, OFF = 0.02, S = 0.1, TAU = 1e-12, TRUST = 2;
const N = +(process.argv[2] || 1500), SAMPLING = process.argv[3] || 'random';

function mulberry32(a) { // as in index.html
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function samplePoints(n, mode, seed, sdf) {
  const rnd = mulberry32(seed), pts = [];
  while (pts.length < n) {
    const p = [(rnd() * 2 - 1) * B, (rnd() * 2 - 1) * B, (rnd() * 2 - 1) * B];
    if (mode !== 'band' || Math.abs(sdf(p)) < BAND) pts.push(p);
  }
  return pts;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function polyArea(P) { // vector area of a planar loop of points
  const s = [0, 0, 0];
  for (let i = 1; i + 1 < P.length; i++) { const c = cross(sub(P[i], P[0]), sub(P[i + 1], P[0])); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
  return Math.hypot(...s) / 2;
}

// Sites as in index.html's compute(): samples (scaled spheres or tangent balls), then tangent points.
function build(shape, inputs, balls) {
  const planes = new Map();
  inputs.forEach((p, k) => {
    const d = shape.sdf(p);
    if (Math.abs(d) < 1e-9) return;
    const t = shape.closest(p);
    planes.set(k, { point: t, normal: [(p[0] - t[0]) / d, (p[1] - t[1]) / d, (p[2] - t[2]) / d], d });
  });
  let sites = [], weights = [], signs = [], owner = [], lifts;
  if (balls) {
    const tb = Recover.tangentBallSites(planes, {});
    ({ sites, weights, signs, owner, lifts } = tb);
  } else {
    inputs.forEach((p, k) => {
      const d = shape.sdf(p), t = planes.get(k)?.point ?? p;
      sites.push([t[0] + S * (p[0] - t[0]), t[1] + S * (p[1] - t[1]), t[2] + S * (p[2] - t[2])]);
      weights.push((S * d) ** 2); signs.push(d >= 0 ? 1 : -1); owner.push(k);
    });
    for (const [k, { point, d }] of planes) { sites.push(point); weights.push(0); signs.push(d >= 0 ? -1 : 1); owner.push(k); }
  }
  const t0 = Date.now();
  const cells = PowerDiagram.computePowerDiagram(sites, weights, [-B, -B, -B], [B, B, B], lifts);
  return { sites, weights, signs, owner, planes, cells, ms: Date.now() - t0 };
}

// The raw power contour: faces between a + cell and a − cell. Own faces are a sample's face with its own tangent point.
function contourStats(D, sdf) {
  let nFaces = 0, area = 0, ownArea = 0, maxErr = 0, nOff = 0, nVerts = 0;
  D.cells.forEach((faces, i) => faces.forEach(f => {
    const j = f.label;
    if (j < 0 || j < i || D.signs[i] === D.signs[j]) return;
    nFaces++; const a = polyArea(f.verts); area += a; if (D.owner[i] === D.owner[j]) ownArea += a;
    for (const p of f.verts) { const e = Math.abs(sdf(p)); nVerts++; maxErr = Math.max(maxErr, e); if (e > OFF) nOff++; }
  }));
  return { nFaces, area, ownFrac: ownArea / area, maxErr, offFrac: nOff / nVerts };
}

// A recovered surface: vertex errors, hole edges, off-plane distance (tangent-plane faces only), area.
function surfaceStats(r, planes, sdf) {
  let maxErr = 0, nOff = 0;
  for (const p of r.verts) { const e = Math.abs(sdf(p)); maxErr = Math.max(maxErr, e); if (e > OFF) nOff++; }
  const loops = r.polys.flatMap(P => [P.verts, ...(P.holes || [])]), dir = new Set();
  for (const L of loops) for (let k = 0; k < L.length; k++) dir.add(`${L[k]},${L[(k + 1) % L.length]}`);
  let holes = 0;
  for (const e of dir) { const [a, b] = e.split(','); if (!dir.has(`${b},${a}`)) holes++; }
  let offPlane = 0, area = 0, nFaces = 0, nExtra = 0;
  for (const P of r.polys) {
    const pts = P.verts.map(k => r.verts[k]);
    area += polyArea(pts) - (P.holes || []).reduce((s, H) => s + polyArea(H.map(k => r.verts[k])), 0);
    if (P.chamfer || P.gap || !planes.has(P.owner)) { nExtra++; continue; }
    nFaces++;
    const { point, normal } = planes.get(P.owner);
    for (const p of pts) offPlane = Math.max(offPlane, Math.abs(dot(normal, sub(p, point))));
  }
  return { maxErr, nOff, nVerts: r.verts.length, holes, offPlane, area, nFaces, nExtra };
}

const METHODS = [
  ['Contract contour regions', false, D => Recover.recoverSurface(D.sites, D.signs, D.owner, D.cells, D.planes, 0.01, TAU, TRUST)],
  ['Extend own faces', false, D => Recover.extendOwnFaces(D.sites, D.signs, D.owner, D.cells, D.planes, { tau: TAU, trust: TRUST, maxJunction: 4 })],
  ['Triangulate step patches', false, D => Recover.triangulatePatches(D.sites, D.signs, D.owner, D.cells, D.planes, { tau: TAU, trust: TRUST })],
  ['Collapse and flip', false, D => Recover.triangulatePatches(D.sites, D.signs, D.owner, D.cells, D.planes, { tau: TAU, trust: TRUST, rank: true })],
  ['Merge steps into faces', true, D => Recover.mergeSteps(D.sites, D.signs, D.owner, D.cells, D.planes, {})],
  ['Clip tangent planes', false, D => { // a polygon soup: give each face its own copies of its points
    const m = Recover.mirroredSites(D.planes, 1e-3);
    const cells = PowerDiagram.computePowerDiagram(m.sites, m.weights, [-B, -B, -B], [B, B, B]);
    const { polys } = Recover.clipTangentPlanes(D.planes, Recover.contourNeighbors(m.signs, m.owner, cells), {});
    const verts = [], out = polys.map(P => ({ owner: P.owner, verts: P.pts.map(p => verts.push(p) - 1) }));
    return { verts, polys: out, soup: true };
  }],
];

const shapes = [['torus', Shapes.torus], ['two spheres', Shapes.twospheres], ['box', Shapes.box], ['cylinder', Shapes.cylinder]];
const FANDISK = process.env.FANDISK || path.join(__dirname, '../../../code-release/examples/fandisk.obj');
if (fs.existsSync(FANDISK)) shapes.push(['fandisk', Shapes.fromOBJ(fs.readFileSync(FANDISK, 'utf8'), 1)]);

const f3 = x => x < 1e-9 ? '0' : x < 1e-3 ? x.toExponential(0).replace('e', '·10^') : x.toFixed(3);
console.log(`n = ${N}, sampling = ${SAMPLING}`);
console.log('| shape | method | max error | off > 0.02 | vertices | tangent-plane faces + extra | hole edges | off-plane | area |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, shape] of shapes) {
  const inputs = samplePoints(N, SAMPLING, 1, shape.sdf);
  const diagrams = { false: build(shape, inputs, false), true: build(shape, inputs, true) };
  for (const balls of [false, true]) {
    const c = contourStats(diagrams[balls], shape.sdf);
    console.log(`| ${name} | power contour${balls ? ', tangent balls' : ', s = 0.1'} | ${f3(c.maxErr)} | ${(100 * c.offFrac).toFixed(0)}% | ${c.nFaces} faces | ${(100 * c.ownFrac).toFixed(0)}% own (area) | 0 | — | ${c.area.toFixed(2)} |`);
  }
  for (const [mname, balls, run] of METHODS) {
    const D = diagrams[balls], t0 = Date.now();
    let r;
    try { r = run(D); } catch (e) { console.log(`| ${name} | ${mname} | error: ${e.message} |`); continue; }
    const s = surfaceStats(r, D.planes, shape.sdf);
    console.log(`| ${name} | ${mname} | ${f3(s.maxErr)} | ${s.nOff} | ${s.nVerts} | ${s.nFaces} + ${s.nExtra} | ${r.soup ? 'soup' : s.holes} | ${f3(s.offPlane)} | ${s.area.toFixed(2)} | ${Date.now() - t0} ms`);
  }
}
