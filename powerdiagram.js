// Power diagram (Laguerre diagram) in 3D via half-space clipping of a bounding box.
// Classic script: defines global `PowerDiagram` in the browser, module.exports in Node.
(function (root) {
  'use strict';

  const EPS = 1e-10;

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function lerp(a, b, t) {
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  }

  // Axis-aligned box as a convex polyhedron. Faces are CCW seen from outside.
  // Bounding-box faces carry label -1.
  function boxPolyhedron(lo, hi) {
    const v = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
    const quads = [
      [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -x
      [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], // +x
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -y
      [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // +y
      [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], // -z
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +z
    ];
    return quads.map(q => ({ verts: q.map(c => v(c[0], c[1], c[2])), label: -1 }));
  }

  // Clip convex polyhedron (array of faces) to the half-space n·x <= c.
  // The new cap face gets `label`. Returns the new face list (possibly empty).
  function clip(faces, n, c, label) {
    let anyOut = false, anyIn = false;
    for (const f of faces) {
      for (const p of f.verts) {
        const s = dot(n, p) - c;
        if (s > EPS) anyOut = true; else anyIn = true;
      }
    }
    if (!anyOut) return faces;
    if (!anyIn) return [];

    const out = [];
    const cap = [];
    for (const f of faces) {
      const vs = f.verts, m = vs.length;
      const s = vs.map(p => dot(n, p) - c);
      const poly = [];
      for (let k = 0; k < m; k++) {
        const a = vs[k], b = vs[(k + 1) % m], sa = s[k], sb = s[(k + 1) % m];
        const aIn = sa <= EPS, bIn = sb <= EPS;
        if (aIn) {
          poly.push(a);
          if (sa >= -EPS) cap.push(a);
        }
        if (aIn !== bIn) {
          const p = lerp(a, b, sa / (sa - sb));
          poly.push(p);
          cap.push(p);
        }
      }
      if (poly.length >= 3) out.push({ verts: poly, label: f.label });
    }

    // Build the cap polygon from the collected points on the plane.
    const uniq = [];
    for (const p of cap) {
      if (!uniq.some(q => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9)) uniq.push(p);
    }
    if (uniq.length >= 3) {
      const ctr = [0, 0, 0];
      for (const p of uniq) { ctr[0] += p[0]; ctr[1] += p[1]; ctr[2] += p[2]; }
      ctr[0] /= uniq.length; ctr[1] /= uniq.length; ctr[2] /= uniq.length;
      const nn = norm(n);
      const nu = [n[0] / nn, n[1] / nn, n[2] / nn];
      const helper = Math.abs(nu[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = cross(nu, helper); const ul = norm(u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
      const w = cross(nu, u);
      // CCW around +n (outward normal of the cap).
      uniq.sort((p, q) => {
        const dp = sub(p, ctr), dq = sub(q, ctr);
        return Math.atan2(dot(dp, w), dot(dp, u)) - Math.atan2(dot(dq, w), dot(dq, u));
      });
      out.push({ verts: uniq, label });
    }
    return out;
  }

  function polygonArea(vs) {
    const a = [0, 0, 0];
    for (let k = 1; k + 1 < vs.length; k++) {
      const c = cross(sub(vs[k], vs[0]), sub(vs[k + 1], vs[0]));
      a[0] += c[0]; a[1] += c[1]; a[2] += c[2];
    }
    return 0.5 * norm(a);
  }

  // sites: array of [x,y,z]; weights: array of w (power distance |x-p|^2 - w).
  // Returns array of cells; each cell is an array of faces {verts, label}, label = neighbor
  // site index or -1 for the bounding box. Empty cells are [].
  function computePowerDiagram(sites, weights, lo, hi) {
    const n = sites.length;
    const cells = new Array(n);
    const sq = sites.map(p => dot(p, p));
    const order = new Array(n);
    for (let i = 0; i < n; i++) {
      const pi = sites[i];
      // Clip against sites with smallest power distance to p_i first so the cell shrinks
      // quickly and most later planes are rejected by the cheap all-inside test.
      for (let j = 0; j < n; j++) order[j] = j;
      const pow = sites.map((p, j) => { const d = sub(p, pi); return dot(d, d) - weights[j]; });
      order.sort((a, b) => pow[a] - pow[b]);
      let faces = boxPolyhedron(lo, hi);
      for (const j of order) {
        if (j === i) continue;
        const pj = sites[j];
        const nrm = [2 * (pj[0] - pi[0]), 2 * (pj[1] - pi[1]), 2 * (pj[2] - pi[2])];
        if (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]) < 1e-12) {
          // Coincident sites: the larger weight wins outright (ties broken by index).
          if (weights[j] > weights[i] || (weights[j] === weights[i] && j < i)) { faces = []; break; }
          continue;
        }
        const c = sq[j] - sq[i] + weights[i] - weights[j];
        faces = clip(faces, nrm, c, j);
        if (faces.length === 0) break;
      }
      cells[i] = faces.filter(f => polygonArea(f.verts) > 1e-12);
    }
    return cells;
  }

  const api = { computePowerDiagram, clip, boxPolyhedron, polygonArea };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PowerDiagram = api;
})(this);
