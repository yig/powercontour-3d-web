// Experiments for the untried ideas of RECOVERY.md §5. `node figures/experiments.js [n] [random|band] [method ...]`
// prints one row per shape and method, with the metrics of compare.js plus containment: the number
// of tangent-plane faces whose polygon does not contain their tangent point.
'use strict';
const { samplePoints, build, surfaceStats, allShapes, f3 } = require('./compare.js');
const Recover = require('../recover.js');

const N = +(process.argv[2] || 1500), SAMPLING = process.argv[3] || 'random';
const P = (D, extra) => Recover.triangulatePatches(D.sites, D.signs, D.owner, D.cells, D.planes, { tau: 1e-12, trust: 2, ...extra });
const EXPERIMENTS = {
  // Baselines (RECOVERY.md, Approaches 3-5).
  patches: [false, D => P(D, {})],
  collapse: [false, D => P(D, { rank: true })],
  merge: [true, D => Recover.mergeSteps(D.sites, D.signs, D.owner, D.cells, D.planes, {})],
  // Idea 1: the tangent-ball diagram's plane partition as connectivity, plane intersections as geometry.
  'idea1-partition': [true, D => P(D, { partition: 'plane', patchDP: false })],
  idea1: [true, D => P(D, { partition: 'plane', patchDP: false, rank: true })],
  'idea1-patches': [true, D => P(D, { partition: 'plane', rank: true })],
  // Idea 2: tangent-point containment as a cost on diagonals and a veto on flips ('flips': only in step 4b).
  'idea2-all': [false, D => P(D, { rank: true, contain: true })],
  idea2: [false, D => P(D, { rank: true, contain: 'flips' })],
  // Idea 3: Delaunay in the estimated curvature metric, by flips (from the partition, or from Approach 3).
  idea3: [false, D => P(D, { patchDP: false, metric: true })],
  'idea3-patches': [false, D => P(D, { metric: true })],
  'idea3+collapse': [false, D => P(D, { metric: true, rank: true })],
  // Idea 6: soft vertices (planes + pull to the initial placement, optional containment hinges).
  idea6: [false, D => P(D, { rank: true, chamfer: false, soft: true })],
  'idea6-hinge': [false, D => P(D, { rank: true, chamfer: false, soft: { contain: 1 } })],
  // Combinations.
  'idea1+2': [true, D => P(D, { partition: 'plane', patchDP: false, rank: true, contain: 'flips' })],
  'idea1+6': [true, D => P(D, { partition: 'plane', patchDP: false, rank: true, chamfer: false, soft: true })],
  'idea1+2+6': [true, D => P(D, { partition: 'plane', patchDP: false, rank: true, contain: 'flips', chamfer: false, soft: true })],
  'idea2+6': [false, D => P(D, { rank: true, contain: 'flips', chamfer: false, soft: true })],
};

// Does each tangent-plane face contain its tangent point? In the face's plane: 0 if t is inside the
// polygon (winding number), else its distance to the polygon. A face of collapsed owners uses the
// nearest of its tangent points. Returns the count of faces whose t is more than 1e-6 outside, and the
// largest such distance.
function containment(r, planes, members) {
  let outside = 0, faces = 0, worst = 0;
  for (const Pg of r.polys) {
    if (Pg.chamfer || Pg.gap || !planes.has(Pg.owner)) continue;
    faces++;
    const { normal: n } = planes.get(Pg.owner);
    const u = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[2], 0, n[0]], ul = Math.hypot(...u); u.forEach((x, i) => u[i] = x / ul);
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const uv = p => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * w[0] + p[1] * w[1] + p[2] * w[2]];
    const loop = Pg.verts.map(k => uv(r.verts[k]));
    const away = t => {
      const [x, y] = uv(t); let wn = 0, d = Infinity;
      for (let i = 0; i < loop.length; i++) {
        const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length], cr = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y0 <= y) { if (y1 > y && cr > 0) wn++; } else if (y1 <= y && cr < 0) wn--;
        const L = (x1 - x0) ** 2 + (y1 - y0) ** 2, s = L ? Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / L)) : 0;
        d = Math.min(d, Math.hypot(x - x0 - s * (x1 - x0), y - y0 - s * (y1 - y0)));
      }
      return wn ? 0 : d;
    };
    const d = Math.min(...(members?.get(Pg.owner) || [Pg.owner]).map(a => away(planes.get(a).point)));
    if (d > 1e-6) { outside++; worst = Math.max(worst, d); }
  }
  return { outside, faces, worst };
}

// Idea 2's per-edge test on a dual triangulation: an edge a-b is inadmissible when f_a(t_b) and
// f_b(t_a) have strictly opposite signs (then one of the two tangent points is on the wrong side of
// the line P_a ∩ P_b, whatever the edge's type).
function inadmissible(tris, planes) {
  const f = (a, x) => { const P = planes.get(a), n = P.normal, t = P.point; return n[0] * (x[0] - t[0]) + n[1] * (x[1] - t[1]) + n[2] * (x[2] - t[2]); };
  const seen = new Set(); let bad = 0;
  for (const T of tris) for (let k = 0; k < 3; k++) {
    const a = T[k], b = T[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
    if (seen.has(key)) continue; seen.add(key);
    const fa = f(a, planes.get(b).point), fb = f(b, planes.get(a).point), sc = 1e-9 * Math.max(Math.abs(fa), Math.abs(fb), 1e-12);
    if ((fa > sc && fb < -sc) || (fa < -sc && fb > sc)) bad++;
  }
  return { bad, edges: seen.size };
}

function run(names) {
  console.log(`n = ${N}, sampling = ${SAMPLING}`);
  console.log('| shape | method | max error | off > 0.02 | vertices | faces + extra | holes | off-plane | t outside face (worst) | inadmissible dual edges | area | ms |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, shape] of allShapes()) {
    const inputs = samplePoints(N, SAMPLING, 1, shape.sdf), D = {};
    for (const m of names) {
      const [balls, fn] = EXPERIMENTS[m];
      D[balls] ??= build(shape, inputs, balls);
      const t0 = Date.now(), r = fn(D[balls]), ms = Date.now() - t0;
      const s = surfaceStats(r, D[balls].planes, shape.sdf), c = containment(r, D[balls].planes, r.members);
      const ia = r.triangles ? inadmissible(r.triangles, D[balls].planes) : null;
      console.log(`| ${name} | ${m} | ${f3(s.maxErr)} | ${s.nOff} | ${s.nVerts} | ${s.nFaces} + ${s.nExtra} | ${s.holes} | ${f3(s.offPlane)} | ${c.outside} (${f3(c.worst)}) | ${ia ? ia.bad + ' / ' + ia.edges : '—'} | ${s.area.toFixed(2)} | ${ms} |`);
    }
  }
}
module.exports = { EXPERIMENTS, containment, inadmissible };
if (require.main === module) run(process.argv.length > 4 ? process.argv.slice(4) : Object.keys(EXPERIMENTS));
