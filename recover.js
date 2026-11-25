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

  const api = { recoverSurface };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recover = api;
})(this);
