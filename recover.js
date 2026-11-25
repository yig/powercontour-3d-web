// Recover a surface from the power contour by intersecting tangent planes.
// Classic script: defines global `Recover` in the browser, module.exports in Node.
//
// Every site has an owner: the sample it comes from (a sample owns itself and its tangent point).
// The power contour is partitioned into one region per owner:
//   - the face between a sample and its own tangent point (it lies in that tangent plane) and
//   - every other contour face, given to whichever of its two owners has the nearer tangent point.
// The regions' boundaries then form a polygon mesh on the contour: a vertex wherever >= 3 regions
// meet, one polygon per region (its boundary loop). Each output vertex is placed where the tangent
// planes of the regions meeting there intersect. See ARCHITECTURE.md.
(function (root) {
  'use strict';

  const WELD = 1e-7; // contour vertices closer than this are the same vertex

  // 3x3 linear solve by Gaussian elimination with partial pivoting.
  function solve3(A, b) {
    const M = A.map((r, i) => [r[0], r[1], r[2], b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // Welds nearly coincident points. Each cell computes its own copy of a shared vertex,
  // so copies differ by rounding error.
  function makeWelder() {
    const grid = new Map(), pts = [];
    const cell = (x) => Math.floor(x / WELD);
    return {
      pts,
      id(p) {
        const c = [cell(p[0]), cell(p[1]), cell(p[2])];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`);
          if (bucket) for (const k of bucket) {
            const q = pts[k];
            if (Math.abs(q[0] - p[0]) <= WELD && Math.abs(q[1] - p[1]) <= WELD && Math.abs(q[2] - p[2]) <= WELD) return k;
          }
        }
        const key = c.join(',');
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(pts.length);
        pts.push(p);
        return pts.length - 1;
      },
    };
  }

  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // sites, signs, owner, cells: as in the viewer (cells from computePowerDiagram).
  // planes: owner -> { point, normal } (the tangent point and the unit SDF gradient).
  // lambda: pull toward the contour vertex; keeps nearly parallel planes well-posed.
  // Returns { verts, anchors, vertOwners, polys: [{ owner, normal, verts }], badOwners, nRegions }.
  function recoverSurface(sites, signs, owner, cells, planes, lambda) {
    // 1. Contour faces (oriented from the + side), welded, each labeled with the owning region.
    const welder = makeWelder(), faces = [];
    cells.forEach((cf, i) => {
      if (signs[i] <= 0) return;
      for (const f of cf) {
        const j = f.label;
        if (j < 0 || signs[j] >= 0) continue;
        const a = owner[i], b = owner[j];
        let label = a;
        if (a !== b) {
          const c = f.verts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / f.verts.length);
          const pa = planes.get(a), pb = planes.get(b);
          if (!pa || (pb && dist2(c, pb.point) < dist2(c, pa.point))) label = b;
        }
        const alt = label === a ? b : a;
        if (!planes.get(label)) continue; // a sample on the surface has no tangent plane
        faces.push({ label, alt: planes.get(alt) ? alt : label, green: a === b, vs: f.verts.map(p => welder.id(p)) });
      }
    });

    // 2. Half-edges and face adjacency.
    const heFace = new Map(); // "u,v" -> face index
    faces.forEach((F, fi) => {
      for (let k = 0; k < F.vs.length; k++) heFace.set(`${F.vs[k]},${F.vs[(k + 1) % F.vs.length]}`, fi);
    });
    const nbrs = faces.map(F => F.vs.map((u, k) => heFace.get(`${F.vs[(k + 1) % F.vs.length]},${u}`)).filter(x => x !== undefined));

    // 3. Clean up the partition so that every region is one connected piece. The nearest-tangent
    //    rule can leave stray pieces cut off from the region's green face; give those to the
    //    face's other owner, or failing that to the most common neighboring region. A region
    //    enclosed by a single other region (an island) is merged into it.
    for (let pass = 0; pass < 8; pass++) {
      const comp = new Int32Array(faces.length).fill(-1), comps = [];
      faces.forEach((F, fi) => {
        if (comp[fi] >= 0) return;
        const c = comps.length, members = [fi];
        comp[fi] = c;
        for (let q = 0; q < members.length; q++) for (const g of nbrs[members[q]]) {
          if (comp[g] < 0 && faces[g].label === F.label) { comp[g] = c; members.push(g); }
        }
        comps.push({ label: F.label, members, green: members.some(g => faces[g].green) });
      });
      const keep = new Map(); // label -> the component to keep: the one with the green face, else the largest
      comps.forEach((C, c) => {
        const k = keep.get(C.label);
        if (k === undefined || (C.green && !comps[k].green) || (C.green === comps[k].green && C.members.length > comps[k].members.length)) keep.set(C.label, c);
      });
      let changed = 0;
      comps.forEach((C, c) => {
        if (keep.get(C.label) === c) {
          const around = new Set();
          for (const fi of C.members) for (const g of nbrs[fi]) if (faces[g].label !== C.label) around.add(faces[g].label);
          if (around.size === 1) { const [l] = around; for (const fi of C.members) faces[fi].label = l; changed++; }
          return;
        }
        for (const fi of C.members) {
          const F = faces[fi];
          if (F.alt !== F.label) { F.label = F.alt; F.alt = F.label; changed++; continue; }
          const count = new Map();
          for (const g of nbrs[fi]) if (faces[g].label !== F.label) count.set(faces[g].label, (count.get(faces[g].label) || 0) + 1);
          let best = -1, bc = 0;
          for (const [l, n] of count) if (n > bc) { best = l; bc = n; }
          if (best >= 0) { F.label = best; changed++; }
        }
      });
      if (!changed) break;
    }

    const vLabels = welder.pts.map(() => new Set());
    for (const F of faces) for (const u of F.vs) vLabels[u].add(F.label);

    // 4. Output vertices: contour vertices where >= 3 regions meet, placed where their planes meet.
    const outId = new Int32Array(welder.pts.length).fill(-1), verts = [], anchors = [], vertOwners = [];
    vLabels.forEach((ls, k) => {
      if (ls.size < 3) return;
      const v = welder.pts[k];
      const A = [[lambda, 0, 0], [0, lambda, 0], [0, 0, lambda]], b = [lambda * v[0], lambda * v[1], lambda * v[2]];
      for (const o of ls) {
        const { normal: n, point: t } = planes.get(o), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
        for (let r = 0; r < 3; r++) {
          for (let q = 0; q < 3; q++) A[r][q] += n[r] * n[q];
          b[r] += n[r] * c;
        }
      }
      outId[k] = verts.length; verts.push(solve3(A, b)); anchors.push(v); vertOwners.push([...ls]);
    });

    // 5. Boundary of each region: half-edges whose twin belongs to another region (or is missing).
    const bnext = new Map(); // label -> Map(u -> [v, ...])
    faces.forEach((F, fi) => {
      for (let k = 0; k < F.vs.length; k++) {
        const u = F.vs[k], v = F.vs[(k + 1) % F.vs.length], tw = heFace.get(`${v},${u}`);
        if (tw !== undefined && faces[tw].label === F.label) continue;
        if (!bnext.has(F.label)) bnext.set(F.label, new Map());
        const m = bnext.get(F.label);
        if (!m.has(u)) m.set(u, []);
        m.get(u).push(v);
      }
    });

    // 6. One polygon per region: walk its boundary loop, keeping the output vertices on it.
    //    A region that is not a disc (several loops, or a vertex visited twice) is reported instead.
    const polys = [], badOwners = [];
    for (const [label, m] of bnext) {
      let pinched = false;
      for (const vs of m.values()) if (vs.length > 1) pinched = true;
      const [start] = m.keys(), loop = [];
      let u = start, steps = 0;
      do { loop.push(u); u = m.get(u)?.[0]; steps++; } while (u !== undefined && u !== start && steps <= m.size);
      if (pinched || u !== start || steps !== m.size) { badOwners.push(label); continue; }
      const ring = loop.map(k => outId[k]).filter(k => k >= 0);
      if (ring.length < 3) { badOwners.push(label); continue; }
      // Contour faces are oriented from + to −; flip so polygons face the + (outside) side.
      polys.push({ owner: label, normal: planes.get(label).normal, verts: ring.reverse() });
    }
    return { verts, anchors, vertOwners, polys, badOwners, nRegions: bnext.size };
  }

  // ---------- Clipped tangent planes ----------
  //
  // Connectivity from MIRRORED PAIRS: each tangent point t (normal n) becomes two sites t + δn (+)
  // and t − δn (−), weight 0. Their power contour is each tangent plane clipped to t's Voronoi cell,
  // plus thin steps on the Voronoi faces between neighbors; tangent points whose pieces meet at a
  // contour vertex are neighbors (the restricted Delaunay neighborhood). Only tangent data is used.
  function mirroredSites(planes, delta) {
    const sites = [], signs = [], owner = [];
    for (const [k, { point: t, normal: n }] of planes) {
      sites.push([t[0] + delta * n[0], t[1] + delta * n[1], t[2] + delta * n[2]]); signs.push(1); owner.push(k);
      sites.push([t[0] - delta * n[0], t[1] - delta * n[1], t[2] - delta * n[2]]); signs.push(-1); owner.push(k);
    }
    return { sites, weights: sites.map(() => 0), signs, owner };
  }

  // Neighbors: owners that meet at some vertex of the power contour.
  function contourNeighbors(signs, owner, cells) {
    const welder = makeWelder(), vOwners = [];
    cells.forEach((cf, i) => {
      if (signs[i] <= 0) return;
      for (const f of cf) {
        const j = f.label;
        if (j < 0 || signs[j] >= 0) continue;
        for (const p of f.verts) {
          const k = welder.id(p);
          (vOwners[k] = vOwners[k] || new Set()).add(owner[i]).add(owner[j]);
        }
      }
    });
    const nbrs = new Map();
    for (const os of vOwners) if (os) for (const a of os) for (const b of os) if (a !== b) {
      if (!nbrs.has(a)) nbrs.set(a, new Set());
      nbrs.get(a).add(b);
    }
    return nbrs;
  }

  // Clips a convex 2D polygon to { p : a·p ≤ b }.
  function clip2(poly, a0, a1, b) {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const P = poly[k], Q = poly[(k + 1) % poly.length];
      const sp = a0 * P[0] + a1 * P[1] - b, sq = a0 * Q[0] + a1 * Q[1] - b;
      if (sp <= 0) out.push(P);
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) { const t = sp / (sp - sq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return out;
  }

  // Face i = tangent plane P_i clipped by the half-spaces of its neighbors' tangent planes, keeping
  // the side that contains t_i: f_j ≤ 0 if t_i is below P_j (locally convex: the max of the f's),
  // f_j ≥ 0 if above (concave: the min). f_j(x) = n_j·(x − t_j).
  // Ties (t_i on P_j, as at corners and creases, where many samples share a closest point; see
  // featureTies): samples outside (d > 0) see a convex feature (keep f_j ≤ 0), inside a concave one.
  // So a supporting plane at a corner keeps only its corner: its face shrinks to (nearly) nothing,
  // while it clips the planes of the flat areas around it exactly along the edge or at the corner.
  // Nearly parallel neighbors (angle < parallelDeg) are split by their Voronoi bisector instead,
  // since their plane-plane line is ill-defined. planes: owner -> { point, normal, d }.
  // Feature points: tangent points on a corner or crease, where samples on both sides share
  // closest points. Their planes are supporting planes, not tangent planes of a patch.
  // For a pair (i, j) whose normals turn much faster than patch j's curvature allows (θ > 3 κ_j r +
  // 10°, r = |t_i − t_j|), t_i is on the feature if it is no farther off P_j than j's curvature
  // explains (|f_j(t_i)| ≤ κ_j r²): exactly on it for a flat patch (box edges and corners), up to
  // curvature for a curved one (the two-sphere crease). Smooth pairs never qualify, and neither does
  // a face point near a box edge: it is first-order off the adjacent face's plane.
  // κ_j: median normal turn per unit distance from j to neighbors with similar normals (< 20°).
  function featureTies(planes, nbrs, o) {
    const kappa = new Map();
    for (const [j, pj] of planes) {
      const ks = [];
      for (const k of nbrs.get(j) || []) {
        const pk = planes.get(k), c = pj.normal[0] * pk.normal[0] + pj.normal[1] * pk.normal[1] + pj.normal[2] * pk.normal[2];
        const r = Math.sqrt(dist2(pj.point, pk.point));
        if (c > Math.cos(o.similarDeg * Math.PI / 180) && r > 1e-9) ks.push(Math.acos(Math.min(1, c)) / r);
      }
      ks.sort((a, b) => a - b);
      kappa.set(j, ks.length ? ks[ks.length >> 1] : 0);
    }
    // tie(i, j): t_i is on the feature shared with patch j.
    return (i, j) => {
      const pi = planes.get(i), pj = planes.get(j), kj = kappa.get(j);
      const c = pi.normal[0] * pj.normal[0] + pi.normal[1] * pj.normal[1] + pi.normal[2] * pj.normal[2];
      const r = Math.sqrt(dist2(pi.point, pj.point));
      if (Math.acos(Math.min(1, c)) <= o.turnFactor * kj * r + o.marginDeg * Math.PI / 180) return false;
      const f = pj.normal[0] * (pi.point[0] - pj.point[0]) + pj.normal[1] * (pi.point[1] - pj.point[1]) + pj.normal[2] * (pi.point[2] - pj.point[2]);
      return Math.abs(f) <= o.onPlaneFactor * kj * r * r + 1e-9;
    };
  }

  // Options (CLIP_DEFAULTS): parallelDeg; features (false: no feature detection at all; an exact
  // tie, t_i exactly on P_j, then falls back to the samples' signs); similarDeg, turnFactor, marginDeg,
  // onPlaneFactor (featureTies); ring2 (clip feature points, or all points if ring2All, by their
  // two-ring); splitFeature (split two points on the same feature, or exactly on each other's
  // planes, by their Voronoi bisector).
  // "Exactly on a plane": tangent points come from finite-difference gradients (error ~1e-10).
  const EXACT = 1e-9;
  const CLIP_DEFAULTS = { parallelDeg: 10, features: false, similarDeg: 20, turnFactor: 3, marginDeg: 10, onPlaneFactor: 1, ring2: true, ring2All: false, splitFeature: true };
  function clipTangentPlanes(planes, nbrs, opts) {
    const o = { ...CLIP_DEFAULTS, ...opts };
    const cosPar = Math.cos(o.parallelDeg * Math.PI / 180), polys = [];
    const tie = o.features ? featureTies(planes, nbrs, o) : () => false, feat = new Set();
    for (const [i] of planes) for (const j of nbrs.get(i) || []) if (tie(i, j)) { feat.add(i); break; }
    let nEmpty = 0, nEmptyFeature = 0;
    for (const [i, { point: t, normal: n, d }] of planes) {
      let N = nbrs.get(i);
      if (!N) continue;
      // A corner or crease point (t_i on a neighbor's non-parallel plane) may not see the planes
      // that should cut its supporting plane down; give it the two-ring of neighbors.
      let feature = feat.has(i);
      if ((feature && o.ring2) || o.ring2All) { const N2 = new Set(N); for (const j of N) for (const k of nbrs.get(j) || []) if (k !== i) N2.add(k); N = N2; }
      const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul;
      const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      let R = 0;
      for (const j of N) R = Math.max(R, Math.sqrt(dist2(t, planes.get(j).point)));
      R = 2 * R + 1e-6;
      let poly = [[-R, -R], [R, -R], [R, R], [-R, R]]; // 2D coordinates (along u, w) about t
      for (const j of N) {
        const { point: tj, normal: nj, d: dj } = planes.get(j);
        const dv = [tj[0] - t[0], tj[1] - t[1], tj[2] - t[2]], dd = Math.hypot(dv[0], dv[1], dv[2]);
        const cos = n[0] * nj[0] + n[1] * nj[1] + n[2] * nj[2];
        if (cos > cosPar) {
          if (dd < 1e-9) continue; // same point, same plane
          // Voronoi bisector: 2 dv·(x − t) ≤ |dv|²
          poly = clip2(poly, 2 * (dv[0] * u[0] + dv[1] * u[1] + dv[2] * u[2]), 2 * (dv[0] * w[0] + dv[1] * w[1] + dv[2] * w[2]), dd * dd);
        } else {
          const fji = nj[0] * (t[0] - tj[0]) + nj[1] * (t[1] - tj[1]) + nj[2] * (t[2] - tj[2]); // f_j(t_i)
          // Keep the side of P_j that contains t_i. Only when t_i lies on P_j (a corner or crease
          // point) decide by convexity: f_i(t_j) < 0 means convex, else ask the sample signs.
          // On a feature, the feature point's sample tells convex (outside) from concave (inside).
          const iOn = tie(i, j), jOn = tie(j, i);
          if (Math.abs(fji) <= EXACT) feature = true; // exactly on a neighbor's plane: corner or edge point
          const convex = iOn ? d > 0 : jOn ? dj > 0 : Math.abs(fji) > EXACT ? fji < 0 : d + dj > 0;
          // Two points on the same edge (or corner) have planes through the same line, which never
          // separate them along it; split them by their Voronoi bisector too.
          const exactMutual = Math.abs(fji) <= EXACT && Math.abs(n[0] * dv[0] + n[1] * dv[1] + n[2] * dv[2]) <= EXACT;
          if (o.splitFeature && ((iOn && jOn) || exactMutual) && dd > 1e-9) poly = clip2(poly, 2 * (dv[0] * u[0] + dv[1] * u[1] + dv[2] * u[2]), 2 * (dv[0] * w[0] + dv[1] * w[1] + dv[2] * w[2]), dd * dd);
          const sg = convex ? 1 : -1; // keep sg · f_j(x) ≤ 0, with x = t + p0 u + p1 w
          poly = clip2(poly, sg * (nj[0] * u[0] + nj[1] * u[1] + nj[2] * u[2]), sg * (nj[0] * w[0] + nj[1] * w[1] + nj[2] * w[2]), -sg * fji);
        }
        if (poly.length < 3) break;
      }
      if (poly.length < 3) { nEmpty++; if (feature) nEmptyFeature++; continue; }
      polys.push({ owner: i, normal: n, feature,
        pts: poly.map(([p, q]) => [t[0] + p * u[0] + q * w[0], t[1] + p * u[1] + q * w[1], t[2] + p * u[2] + q * w[2]]) });
    }
    return { polys, nEmpty, nEmptyFeature };
  }

  const api = { recoverSurface, mirroredSites, contourNeighbors, clipTangentPlanes, CLIP_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recover = api;
})(this);
