// Test shapes: exact signed distance and closest surface point. No three.js.
// Classic script: defines global `Shapes` in the browser, module.exports in Node.
// For an exact SDF, the closest point t of p gives the normal: n = (p − t) / sdf(p).
(function (root) {
  'use strict';

  // Closest point to p on the sphere (c, R). The center itself picks +x.
  function onSphere(p, c, R) {
    const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(v[0], v[1], v[2]);
    if (l === 0) return [c[0] + R, c[1], c[2]];
    return [c[0] + R * v[0] / l, c[1] + R * v[1] / l, c[2] + R * v[2] / l];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const BOX = [0.7, 0.5, 0.4];                          // half extents
  const TORUS = { R: 0.75, r: 0.3 };                     // axis z
  const CYL = { r: 0.5, h: 0.7 };                        // capped cylinder, axis z: radius, half height
  const TWO = { R: 0.55, cx: 0.45 };                     // spheres at (±cx, 0, 0)
  TWO.rc = Math.sqrt(TWO.R * TWO.R - TWO.cx * TWO.cx);   // crease circle radius, in the plane x = 0

  // Two-sphere union: closest point. Outside, the nearer sphere's closest point (always on its
  // exposed part). Inside, the nearer of each sphere's exposed cap (if its closest point lies on
  // the cap) and the crease circle.
  function twoClosest(p) {
    const { R, cx, rc } = TWO, L = [-cx, 0, 0], Rt = [cx, 0, 0];
    const dl = dist(p, L) - R, dr = dist(p, Rt) - R;
    if (dl >= 0 && dr >= 0) return dl <= dr ? onSphere(p, L, R) : onSphere(p, Rt, R);
    const ryz = Math.hypot(p[1], p[2]);
    const crease = ryz === 0 ? [0, rc, 0] : [0, rc * p[1] / ryz, rc * p[2] / ryz];
    let best = crease, bd = dist(p, crease);
    const qL = onSphere(p, L, R), qR = onSphere(p, Rt, R);
    if (qL[0] <= 0 && Math.abs(dl) < bd) { best = qL; bd = Math.abs(dl); }
    if (qR[0] >= 0 && Math.abs(dr) < bd) { best = qR; bd = Math.abs(dr); }
    return best;
  }


  // ---------- Triangle meshes (OBJ) ----------
  // Parse OBJ text into welded positions and triangles. Faces are fan-triangulated; v/vt/vn and
  // negative indices are accepted. Vertices at the same position are merged, so edge adjacency
  // (needed for the sign) is found even when the file duplicates them.
  function parseOBJ(text) {
    const raw = [], pos = [], tris = [], weld = new Map(), map = [];
    const idx = i => { const k = map[i]; if (k === undefined) throw new Error(`OBJ face uses missing vertex ${i + 1}`); return k; };
    for (const line of text.split('\n')) {
      const w = line.trim().split(/\s+/);
      if (w[0] === 'v') {
        const p = [+w[1], +w[2], +w[3]];
        if (!p.every(Number.isFinite)) throw new Error(`bad OBJ vertex: ${line.trim()}`);
        const key = p.join(',');
        if (!weld.has(key)) { weld.set(key, pos.length); pos.push(p); }
        map.push(weld.get(key)); raw.push(p);
      } else if (w[0] === 'f') {
        const f = w.slice(1).map(s => { const i = parseInt(s, 10); return idx(i < 0 ? raw.length + i : i - 1); });
        for (let j = 1; j + 1 < f.length; j++) tris.push([f[0], f[j], f[j + 1]]);
      }
    }
    if (!tris.length) throw new Error('OBJ has no faces');
    return { pos, tris };
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

  // Closest point on triangle abc (Ericson, Real-Time Collision Detection 5.1.5), with the feature
  // it lies on: 'f' face, 'e0'/'e1'/'e2' edge ab/bc/ca, 'v0'/'v1'/'v2' vertex a/b/c.
  function closestOnTriangle(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return [a, 'v0'];
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return [b, 'v1'];
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [[a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]], 'e0']; }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return [c, 'v2'];
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [[a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]], 'e2']; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return [[b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])], 'e1'];
    }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return [[a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w], 'f'];
  }

  // Exact unsigned distance and closest point to a triangle mesh, via a bounding-volume hierarchy.
  // The sign comes from the angle-weighted pseudonormal of the closest feature (Bærentzen & Aanæs
  // 2005): face normal, sum of the two face normals at an edge, angle-weighted sum at a vertex.
  // It is correct for a closed, consistently oriented mesh; holes or flipped faces give wrong signs
  // near them. The mesh is centered and scaled so its bounding box spans [-size, size] on its longest side.
  function meshShape(text, size = 1) {
    const { pos: raw, tris: all } = parseOBJ(text);
    const lo = [0, 1, 2].map(k => Math.min(...raw.map(p => p[k]))), hi = [0, 1, 2].map(k => Math.max(...raw.map(p => p[k])));
    const ctr = lo.map((l, k) => (l + hi[k]) / 2), half = Math.max(...hi.map((h, k) => h - lo[k])) / 2;
    if (!(half > 0)) throw new Error('OBJ is flat or empty');
    const pos = raw.map(p => p.map((x, k) => (x - ctr[k]) * size / half));
    const tris = [], fn = [];
    for (const t of all) {
      const n = cross(sub(pos[t[1]], pos[t[0]]), sub(pos[t[2]], pos[t[0]]));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-14) continue; // degenerate: no normal, never needed for distance
      tris.push(t); fn.push(unit(n));
    }
    const vn = pos.map(() => [0, 0, 0]), en = new Map();
    const ekey = (i, j) => i < j ? `${i},${j}` : `${j},${i}`;
    tris.forEach((t, f) => {
      for (let k = 0; k < 3; k++) {
        const i = t[k], j = t[(k + 1) % 3], l = t[(k + 2) % 3];
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(pos[j], pos[i])), unit(sub(pos[l], pos[i]))))));
        for (let c = 0; c < 3; c++) vn[i][c] += ang * fn[f][c];
        const e = ekey(i, j), s = en.get(e) || [0, 0, 0];
        for (let c = 0; c < 3; c++) s[c] += fn[f][c];
        en.set(e, s);
      }
    });

    // BVH: median split on the longest axis of the centroid bounds, up to 4 triangles per leaf.
    const cen = tris.map(t => [0, 1, 2].map(k => (pos[t[0]][k] + pos[t[1]][k] + pos[t[2]][k]) / 3));
    const nodes = [];
    function build(ids) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const f of ids) for (const v of tris[f]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v][k]); hi[k] = Math.max(hi[k], pos[v][k]); }
      const node = { lo, hi }; nodes.push(node);
      if (ids.length <= 4) { node.ids = ids; return node; }
      const clo = [0, 1, 2].map(k => Math.min(...ids.map(f => cen[f][k]))), chi = [0, 1, 2].map(k => Math.max(...ids.map(f => cen[f][k])));
      const ax = [0, 1, 2].reduce((a, k) => chi[k] - clo[k] > chi[a] - clo[a] ? k : a, 0);
      ids.sort((f, g) => cen[f][ax] - cen[g][ax]);
      const m = ids.length >> 1;
      node.kids = [build(ids.slice(0, m)), build(ids.slice(m))];
      return node;
    }
    const root = build(tris.map((_, f) => f));
    const boxD2 = (p, n) => { let s = 0; for (let k = 0; k < 3; k++) { const e = Math.max(n.lo[k] - p[k], 0, p[k] - n.hi[k]); s += e * e; } return s; };

    function query(p) {
      let best = null, bd = Infinity, bf = -1, bfeat = null;
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        if (boxD2(p, n) >= bd) continue;
        if (n.ids) {
          for (const f of n.ids) {
            const t = tris[f], [q, feat] = closestOnTriangle(p, pos[t[0]], pos[t[1]], pos[t[2]]);
            const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
            if (d < bd) { bd = d; best = q; bf = f; bfeat = feat; }
          }
        } else {
          const [a, b] = n.kids, da = boxD2(p, a), db = boxD2(p, b);
          if (da < db) stack.push(b, a); else stack.push(a, b); // nearer child popped first
        }
      }
      const t = tris[bf];
      const pn = bfeat === 'f' ? fn[bf] : bfeat[0] === 'v' ? vn[t[+bfeat[1]]] : en.get(ekey(t[+bfeat[1]], t[(+bfeat[1] + 1) % 3]));
      return { point: best, dist: Math.sqrt(bd), sign: dot(sub(p, best), pn) >= 0 ? 1 : -1 };
    }

    let last = null, lastQ = null; // the viewer asks sdf(p) and then closest(p) for the same p
    const q = p => { if (last !== p) { last = p; lastQ = query(p); } return lastQ; };
    return {
      sdf: p => { const r = q(p); return r.sign * r.dist; },
      closest: p => q(p).point.slice(),
      positions: pos, triangles: tris, nTrianglesIn: all.length,
    };
  }

  const Shapes = {
    sphere: {
      sdf: ([x, y, z]) => Math.hypot(x, y, z) - 0.8,
      closest: p => onSphere(p, [0, 0, 0], 0.8),
    },
    box: {
      sdf: ([x, y, z]) => {
        const h = BOX, q = [Math.abs(x) - h[0], Math.abs(y) - h[1], Math.abs(z) - h[2]];
        return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
      },
      // Outside: clamp into the box. Inside: push the coordinate nearest its face onto it.
      closest: p => {
        const h = BOX, q = p.map((x, k) => Math.abs(x) - h[k]);
        if (Math.max(q[0], q[1], q[2]) > 0) return p.map((x, k) => Math.min(h[k], Math.max(-h[k], x)));
        const k = q.indexOf(Math.max(q[0], q[1], q[2])), t = p.slice();
        t[k] = (p[k] < 0 ? -1 : 1) * h[k];
        return t;
      },
    },
    torus: {
      sdf: ([x, y, z]) => Math.hypot(Math.hypot(x, y) - TORUS.R, z) - TORUS.r,
      // Nearest point on the core circle, then onto the tube around it.
      closest: p => {
        const rxy = Math.hypot(p[0], p[1]);
        const c = rxy === 0 ? [TORUS.R, 0, 0] : [TORUS.R * p[0] / rxy, TORUS.R * p[1] / rxy, 0];
        return onSphere(p, c, TORUS.r);
      },
    },
    // A developable side (one principal curvature is zero everywhere) between flat caps.
    cylinder: {
      sdf: ([x, y, z]) => {
        const dx = Math.hypot(x, y) - CYL.r, dz = Math.abs(z) - CYL.h;
        return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
      },
      // Outside: clamp the radius and the height. Inside: onto the nearer of the side and the caps.
      closest: ([x, y, z]) => {
        const rho = Math.hypot(x, y), ux = rho > 0 ? x / rho : 1, uy = rho > 0 ? y / rho : 0;
        let R = rho, Z = z;
        if (rho > CYL.r || Math.abs(z) > CYL.h) { R = Math.min(rho, CYL.r); Z = Math.max(-CYL.h, Math.min(CYL.h, z)); }
        else if (CYL.r - rho < CYL.h - Math.abs(z)) R = CYL.r;
        else Z = (z < 0 ? -1 : 1) * CYL.h;
        return [R * ux, R * uy, Z];
      },
    },
    twospheres: {
      // min(dL, dR) is exact outside but not inside: there the nearest surface point may be on the
      // crease circle, or on the part of a sphere that is not buried in the other one.
      sdf: p => {
        const { R, cx } = TWO;
        const dl = dist(p, [-cx, 0, 0]) - R, dr = dist(p, [cx, 0, 0]) - R;
        if (dl >= 0 && dr >= 0) return Math.min(dl, dr);
        return -dist(p, twoClosest(p));
      },
      closest: twoClosest,
    },
    fromOBJ: meshShape,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Shapes;
  else root.Shapes = Shapes;
})(this);
