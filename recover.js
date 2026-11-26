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
  // Returns { verts, anchors, vertOwners, polys: [{ owner, normal, verts, holes }], badOwners, nRegions, topo }.
  // opts.label: 'tangent' (default) labels a step with the owner of the nearer tangent point; 'plane'
  // with the owner whose tangent plane is nearer (the larger distance of its corners, minimized).
  // opts.keepCells: keep every vertex of the region boundaries at its contour position instead of
  // intersecting planes at the junctions (used by Merge steps into faces, Approach 4).
  function recoverSurface(sites, signs, owner, cells, planes, lambda, tau = 0, trust = Infinity, opts = {}) {
    const byPlane = opts.label === 'plane', keepCells = !!opts.keepCells;
    const fAbs = (P, x) => Math.abs(P.normal[0] * (x[0] - P.point[0]) + P.normal[1] * (x[1] - P.point[1]) + P.normal[2] * (x[2] - P.point[2]));
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
          const pa = planes.get(a), pb = planes.get(b);
          if (byPlane) {
            if (!pa || (pb && Math.max(...f.verts.map(p => fAbs(pb, p))) < Math.max(...f.verts.map(p => fAbs(pa, p))))) label = b;
          } else {
            const c = f.verts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / f.verts.length);
            if (!pa || (pb && dist2(c, pb.point) < dist2(c, pa.point))) label = b;
          }
        }
        const alt = label === a ? b : a;
        if (!planes.get(label)) continue; // a sample on the surface has no tangent plane
        // Welding can merge consecutive corners of a tiny face: drop the repeats (a u -> u edge breaks boundary walks).
        const vs = f.verts.map(p => welder.id(p)).filter((u, k, w) => u !== w[(k + 1) % w.length]);
        if (vs.length < 3) continue;
        faces.push({ label, alt: planes.get(alt) ? alt : label, green: a === b, vs });
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
    const components = () => { // connected pieces of each region: label -> count
      const comp = new Int32Array(faces.length).fill(-1), count = new Map();
      faces.forEach((F, fi) => {
        if (comp[fi] >= 0) return;
        comp[fi] = fi; const st = [fi];
        while (st.length) for (const g of nbrs[st.pop()]) if (comp[g] < 0 && faces[g].label === F.label) { comp[g] = fi; st.push(g); }
        count.set(F.label, (count.get(F.label) || 0) + 1);
      });
      return count;
    };
    const split0 = [...components().values()].filter(n => n > 1).length;
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

    // 4. Topology. Every region must become faces: dropping one leaves a hole in the surface. For each
    //    connected piece of a region, take its boundary cycles. The largest (by area in the region's
    //    tangent plane) is the outer boundary; cycles of the same orientation are lobes pinched to it at
    //    a vertex; cycles of the opposite orientation are holes. A hole with no own face inside contains
    //    only steps, so it is erased (given to the region). Repeat until stable. A piece with fewer
    //    than three junctions has no corners of its own and collapses: its one or two neighbors already
    //    share the edge between its junctions, so dropping it leaves no hole.
    const topo = { split0, erasedHoles: 0, collapsed: 0, pieces: 0, splitRegions: 0, pinched: 0, annuli: 0, multiArc: 0, junction4: 0 };
    const pts = welder.pts;
    function cycleArea(cyc, n) {
      const a = [0, 0, 0];
      cyc.forEach((u, k) => { const p = pts[u], q = pts[cyc[(k + 1) % cyc.length]];
        a[0] += p[1] * q[2] - p[2] * q[1]; a[1] += p[2] * q[0] - p[0] * q[2]; a[2] += p[0] * q[1] - p[1] * q[0]; });
      return (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 2;
    }
    let pieces, comp, vLabels;
    function analyze() {
      vLabels = pts.map(() => new Set());
      for (const F of faces) for (const u of F.vs) vLabels[u].add(F.label);
      comp = new Int32Array(faces.length).fill(-1); pieces = [];
      faces.forEach((F, fi) => {
        if (comp[fi] >= 0) return;
        const P = { label: F.label, faces: [fi] }; comp[fi] = pieces.length;
        for (let q = 0; q < P.faces.length; q++) for (const g of nbrs[P.faces[q]]) if (comp[g] < 0 && faces[g].label === F.label) { comp[g] = pieces.length; P.faces.push(g); }
        pieces.push(P);
      });
      pieces.forEach((P, pi) => {
        const out = new Map(); P.across = new Map(); // boundary half-edges u -> [v]; "u,v" -> face across
        for (const fi of P.faces) {
          const vs = faces[fi].vs;
          vs.forEach((u, k) => {
            const v = vs[(k + 1) % vs.length], tw = heFace.get(`${v},${u}`);
            if (tw !== undefined && comp[tw] === pi) return;
            if (!out.has(u)) out.set(u, []);
            out.get(u).push(v); P.across.set(`${u},${v}`, tw);
          });
        }
        P.pinched = [...out.values()].some(vs => vs.length > 1);
        const cycles = [];
        for (const [u0, vs0] of out) while (vs0.length) {
          const cyc = []; let u = u0;
          do { cyc.push(u); u = out.get(u)?.pop(); } while (u !== undefined && u !== u0);
          if (u === u0) cycles.push(cyc);
        }
        const n = planes.get(P.label).normal, areas = cycles.map(c => cycleArea(c, n));
        const o = areas.reduce((b, a, k) => Math.abs(a) > Math.abs(areas[b]) ? k : b, 0), sg = Math.sign(areas[o]);
        P.outer = cycles[o] || []; P.holes = []; P.extra = [];
        cycles.forEach((c, k) => {
          if (k === o) return;
          if (Math.sign(areas[k]) !== sg) { P.holes.push(c); return; }
          const i = P.outer.findIndex(u => c.includes(u)); // splice a lobe in at a shared vertex
          if (i < 0) { P.extra.push(c); return; }
          const j = c.indexOf(P.outer[i]);
          P.outer = [...P.outer.slice(0, i + 1), ...c.slice(j + 1), ...c.slice(0, j + 1), ...P.outer.slice(i + 1)];
        });
      });
    }
    for (let iter = 0; iter < 8; iter++) {
      analyze();
      let changed = false;
      pieces.forEach((P, pi) => {
        for (const h of P.holes) {
          const seen = new Set(), st = [];
          h.forEach((u, k) => { const f = P.across.get(`${u},${h[(k + 1) % h.length]}`); if (f !== undefined && !seen.has(f)) { seen.add(f); st.push(f); } });
          while (st.length) for (const g of nbrs[st.pop()]) if (comp[g] !== pi && !seen.has(g)) { seen.add(g); st.push(g); }
          if (seen.size > faces.length / 2 || [...seen].some(f => faces[f].green)) continue;
          for (const f of seen) faces[f].label = P.label;
          topo.erasedHoles++; changed = true;
        }
      });
      if (!changed) break;
    }

    // 5. Output vertices: contour vertices where >= 3 regions meet, placed where those regions' tangent planes meet.
    const outId = new Int32Array(pts.length).fill(-1), verts = [], anchors = [], vertOwners = [];
    vLabels.forEach((ls, k) => {
      if (keepCells && ls.size >= 2) {
        // The contour vertex, or with opts.snap > 0 the regularized least-squares point of its regions' planes:
        // min Σ f_a(x)² + snap |x − v|², which moves it at most about the step height when the planes nearly agree.
        const v = pts[k], mu = opts.snap || 0;
        let x = v;
        if (mu > 0) {
          const A = [[mu, 0, 0], [0, mu, 0], [0, 0, mu]], b = [mu * v[0], mu * v[1], mu * v[2]];
          for (const o of ls) { const { normal: n, point: t } = planes.get(o), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
            for (let r = 0; r < 3; r++) { for (let q = 0; q < 3; q++) A[r][q] += n[r] * n[q]; b[r] += n[r] * c; } }
          x = solve3(A, b);
        }
        outId[k] = verts.length; verts.push(x); anchors.push(v); vertOwners.push([...ls]); return;
      }
      if (ls.size < 3) return;
      if (ls.size >= 4) topo.junction4++;
      const v = pts[k];
      // tau: exact plane intersection, truncated where the planes are dependent (qefTruncated);
      // otherwise Tikhonov regularization toward the contour vertex with weight lambda.
      const reg = tau ? 0 : lambda;
      const A = [[reg, 0, 0], [0, reg, 0], [0, 0, reg]], b = [reg * v[0], reg * v[1], reg * v[2]];
      for (const o of ls) {
        const { normal: n, point: t } = planes.get(o), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
        for (let r = 0; r < 3; r++) {
          for (let q = 0; q < 3; q++) A[r][q] += n[r] * n[q];
          b[r] += n[r] * c;
        }
      }
      const x = tau ? qefTruncated(A, b, v, tau, trustRadius(v, ls, planes, trust)) : solve3(A, b);
      outId[k] = verts.length; verts.push(x); anchors.push(v); vertOwners.push([...ls]);
    });

    // 6. Faces: one per piece (several for a split region), keeping the output vertices on its
    //    boundary; holes that contain own faces stay as holes of the face (an annulus).
    //    Contour faces are oriented from + to −; reverse so faces face the + (outside) side.
    const polys = [], badOwners = [], ring = c => c.map(k => outId[k]).filter(k => k >= 0).reverse();
    const perLabel = new Map();
    for (const P of pieces) {
      perLabel.set(P.label, (perLabel.get(P.label) || 0) + 1);
      const normal = planes.get(P.label).normal;
      for (const c of [P.outer, ...P.extra]) {
        const R = ring(c);
        if (R.length < 3) { topo.collapsed++; continue; }
        const holes = c === P.outer ? P.holes.map(ring).filter(H => H.length >= 3) : [];
        if (holes.length) topo.annuli++;
        if (P.pinched) topo.pinched++;
        // A neighbor met along two separate arcs: the two faces share two edges.
        const runs = c.map((u, k) => { const f = P.across.get(`${u},${c[(k + 1) % c.length]}`); return f === undefined ? -1 : faces[f].label; }), seen = new Set();
        runs.forEach((l, k) => { if (l !== runs[(k + runs.length - 1) % runs.length]) { if (seen.has(l)) topo.multiArc++; seen.add(l); } });
        polys.push({ owner: P.label, normal, verts: R, holes });
      }
    }
    topo.pieces = pieces.length;
    topo.splitRegions = [...perLabel.values()].filter(n => n > 1).length;
    return { verts, anchors, vertOwners, polys, badOwners, nRegions: perLabel.size, topo, contour: { pts, faces, heFace } };
  }

  // ---------- Extended own faces ----------
  //
  // One face per tangent point; every other contour face is eliminated. Sample a and tangent point
  // t_a form a super cell C_a, and the own face F_a = P_a ∩ C_a lies exactly in the tangent plane.
  // Every other contour face is a step on a wall between two super cells, where neighboring planes
  // do not meet on the wall. Eliminating the steps means extending each own face in its plane until
  // it meets its neighbors' planes:
  //   - each edge of F_a borders a step toward one neighbor b (the owner of the third cell there);
  //     a run of edges facing b becomes part of the line P_a ∩ P_b;
  //   - a corner of F_a has two cells of a plus one of b and one of c, so it touches at most three
  //     owners; a switch from b to c becomes the vertex P_a ∩ P_b ∩ P_c, shared by faces a, b, c.
  // Vertices are exact plane intersections; when the planes are (nearly) dependent, e.g. coplanar on
  // a flat face, the vertex stays at its contour position projected onto them (truncated QEF).
  // A triple that is not seen from all three faces leaves a crack; hole edges report it.
  function extendOwnFaces(sites, signs, owner, cells, planes, opts) {
    const o = { tau: 1e-2, maxJunction: 4, trust: Infinity, ...opts };
    const welder = makeWelder();
    const triples = new Map(); // "a,b,c" -> { owners, sum, n }
    const rings = [];          // per own face: { owner, keys: [triple key or null], anchors }
    cells.forEach((cf, i) => {
      if (signs[i] <= 0) return; // each own face once, from its + cell
      const a = owner[i];
      if (!planes.get(a)) return;
      const ownIdx = cf.findIndex(f => f.label >= 0 && owner[f.label] === a && signs[f.label] < 0);
      if (ownIdx < 0) return;
      // Welded vertex ids of every face of this cell, to find the third cell at each edge of F_a.
      const ids = cf.map(f => f.verts.map(p => welder.id(p)));
      const edgeLabel = new Map();
      cf.forEach((f, fi) => {
        if (fi === ownIdx) return;
        const v = ids[fi];
        for (let k = 0; k < v.length; k++) { const p = v[k], q = v[(k + 1) % v.length]; edgeLabel.set(p < q ? `${p},${q}` : `${q},${p}`, f.label); }
      });
      const V = ids[ownIdx], P = cf[ownIdx].verts;
      const nb = V.map((p, k) => { const q = V[(k + 1) % V.length], l = edgeLabel.get(p < q ? `${p},${q}` : `${q},${p}`);
        return l === undefined || l < 0 ? -1 : owner[l]; }); // -1: the bounding box
      // Corners where the neighbor switches: vertex k + 1 between edges k and k + 1.
      const ring = [];
      for (let k = 0; k < V.length; k++) {
        const b = nb[k], c = nb[(k + 1) % V.length];
        if (b === c) continue;
        const corner = P[(k + 1) % V.length];
        if (b < 0 || c < 0) { ring.push({ key: null, at: corner }); continue; }
        const ow = [a, b, c].sort((x, y) => x - y), key = ow.join(',');
        if (!triples.has(key)) triples.set(key, { owners: ow, sum: [0, 0, 0], n: 0 });
        const e = triples.get(key); e.sum[0] += corner[0]; e.sum[1] += corner[1]; e.sum[2] += corner[2]; e.n++;
        ring.push({ key, at: corner });
      }
      rings.push({ owner: a, ring });
    });
    // Flips: where four owners meet nearly at one point, the faces can disagree about which diagonal
    // is an edge, so a triple is seen by fewer than its three faces. Merge each such junction (the
    // incomplete triples linked by sharing two owners, at most o.maxJunction owners in all) into one
    // vertex, where all of its planes meet.
    const seenBy = new Map();
    for (const { owner: a, ring } of rings) for (const { key } of ring) if (key !== null) {
      if (!seenBy.has(key)) seenBy.set(key, new Set()); seenBy.get(key).add(a);
    }
    const group = new Map(); // triple key -> representative key
    const find = k => { while (group.get(k) !== k) k = group.get(k); return k; };
    for (const k of triples.keys()) group.set(k, k);
    const incomplete = [...triples.keys()].filter(k => seenBy.get(k).size < 3);
    const byPair = new Map();
    for (const k of incomplete) { const [x, y, z] = triples.get(k).owners;
      for (const pk of [`${x},${y}`, `${x},${z}`, `${y},${z}`]) { if (!byPair.has(pk)) byPair.set(pk, []); byPair.get(pk).push(k); } }
    const members = new Map(); // representative -> owners of the merged group
    for (const k of triples.keys()) members.set(k, new Set(triples.get(k).owners));
    for (const ks of byPair.values()) for (let q = 1; q < ks.length; q++) {
      const r1 = find(ks[0]), r2 = find(ks[q]);
      if (r1 === r2) continue;
      const u = new Set([...members.get(r1), ...members.get(r2)]);
      if (u.size > o.maxJunction) continue;
      group.set(r2, r1); members.set(r1, u);
    }
    // Vertices: where the planes of each (possibly merged) junction meet.
    const verts = [], anchors = [], vertOwners = [], idOf = new Map(), sums = new Map();
    for (const [key, e] of triples) {
      const g = find(key);
      if (!sums.has(g)) sums.set(g, { sum: [0, 0, 0], n: 0 });
      const t = sums.get(g); t.sum[0] += e.sum[0]; t.sum[1] += e.sum[1]; t.sum[2] += e.sum[2]; t.n += e.n;
    }
    let nMerged = 0;
    for (const [g, { sum, n: cnt }] of sums) {
      const m = [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt], ows = [...members.get(g)];
      if (ows.length > 3) nMerged++;
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (const ow of ows) {
        const { normal: nn, point: t } = planes.get(ow), c = nn[0] * t[0] + nn[1] * t[1] + nn[2] * t[2];
        for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) A[p][q] += nn[p] * nn[q]; r[p] += nn[p] * c; }
      }
      idOf.set(g, verts.length); verts.push(qefTruncated(A, r, m, o.tau, trustRadius(m, ows, planes, o.trust))); anchors.push(m); vertOwners.push(ows);
    }
    // Faces: the ring of switch vertices (merged junctions collapse repeats); box corners keep their
    // contour position.
    const polys = [];
    let nDegenerate = 0;
    for (const { owner: a, ring } of rings) {
      const vs = [];
      for (const { key, at } of ring) {
        let v;
        if (key !== null) v = idOf.get(find(key));
        else { verts.push(at); anchors.push(at); vertOwners.push([a]); v = verts.length - 1; }
        if (vs[vs.length - 1] !== v) vs.push(v);
      }
      while (vs.length > 1 && vs[0] === vs[vs.length - 1]) vs.pop();
      if (vs.length < 3) { nDegenerate++; continue; }
      polys.push({ owner: a, normal: planes.get(a).normal, verts: vs });
    }
    // Cracks: a triple seen by fewer than three faces leaves directed edges without a reverse.
    const dir = new Set();
    for (const P of polys) P.verts.forEach((v, k) => dir.add(`${v},${P.verts[(k + 1) % P.verts.length]}`));
    let open = 0;
    for (const e of dir) { const [p, q] = e.split(','); if (!dir.has(`${q},${p}`)) open++; }
    return { verts, anchors, vertOwners, polys, nDegenerate, nOpen: open, nTriples: triples.size, nMerged };
  }

  // Eigen-decomposition of a symmetric 3x3 matrix (Jacobi). Returns { vals, vecs (columns) }.
  function eig3(A) {
    const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let it = 0; it < 50; it++) {
      let p = 0, q = 1;
      if (Math.abs(a[0][2]) > Math.abs(a[p][q])) { p = 0; q = 2; }
      if (Math.abs(a[1][2]) > Math.abs(a[p][q])) { p = 1; q = 2; }
      if (Math.abs(a[p][q]) < 1e-18) break;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
    return { vals: [a[0][0], a[1][1], a[2][2]], vecs: v };
  }
  // Minimize Σ (n·x − c)² near m: x = m + pinv(A)(r − A m), dropping eigenvalues below tau · max.
  // Independent planes: their exact intersection. Dependent ones: m projected onto them.
  //
  // Trust region (rho): a tangent plane is only accurate within about one sample spacing of its
  // tangent point, so the vertex may not leave the ball of radius rho around m. The eigendirections
  // are added from the best determined (largest eigenvalue) down, and the solution uses the most
  // that keep it within rho: the exact intersection of the planes if it is near, else the nearest
  // point on the line where the two best-determined planes meet, else on their average plane, else
  // m. The corrections along different eigendirections are orthogonal, so the distance only grows.
  function qefTruncated(A, r, m, tau, rho = Infinity) {
    const { vals, vecs } = eig3(A), lmax = Math.max(...vals);
    const res = [0, 1, 2].map(i => r[i] - (A[i][0] * m[0] + A[i][1] * m[1] + A[i][2] * m[2]));
    const x = m.slice();
    let d2 = 0;
    for (const e of [0, 1, 2].sort((p, q) => vals[q] - vals[p])) {
      if (vals[e] <= tau * lmax) break;
      const u = [vecs[0][e], vecs[1][e], vecs[2][e]], coef = (u[0] * res[0] + u[1] * res[1] + u[2] * res[2]) / vals[e];
      if (d2 + coef * coef > rho * rho) break;
      d2 += coef * coef;
      x[0] += coef * u[0]; x[1] += coef * u[1]; x[2] += coef * u[2];
    }
    return x;
  }
  // Trust radius at m: trust × the distance from m to the farthest of the planes' tangent points.
  function trustRadius(m, owners, planes, trust) {
    if (!(trust < Infinity)) return Infinity;
    let far = 0;
    for (const o of owners) far = Math.max(far, Math.sqrt(dist2(m, planes.get(o).point)));
    return trust * far;
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
  // planes, by their Voronoi bisector); concaveUnion (combine concave constraints by union);
  // mutualConvex (convex only if each point is below the other's plane).
  // "Exactly on a plane", up to rounding: tangent points and normals are exact (shapes.js closest).
  const EXACT = 1e-12;
  const CLIP_DEFAULTS = { parallelDeg: 10, features: false, similarDeg: 20, turnFactor: 3, marginDeg: 10, onPlaneFactor: 1, ring2: true, ring2All: false, splitFeature: true, concaveUnion: true, mutualConvex: true };
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
      const concave = []; // half-planes from concave pairs, combined by union (see below)
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
          // Convex only if each point is below the other's plane. A mixed pair (one below, one above,
          // e.g. across a concave crease from far away) cannot be trusted to cut, so like a concave pair it
          // only contributes to the union.
          const fij = n[0] * dv[0] + n[1] * dv[1] + n[2] * dv[2]; // f_i(t_j) = n_i·(t_j − t_i)
          const convex = iOn ? d > 0 : jOn ? dj > 0
            : Math.abs(fji) > EXACT ? fji < 0 && (!o.mutualConvex || fij < EXACT) : d + dj > 0;
          // Two points on the same edge (or corner) have planes through the same line, which never
          // separate them along it; split them by their Voronoi bisector too.
          const exactMutual = Math.abs(fji) <= EXACT && Math.abs(n[0] * dv[0] + n[1] * dv[1] + n[2] * dv[2]) <= EXACT;
          if (o.splitFeature && ((iOn && jOn) || exactMutual) && dd > 1e-9) poly = clip2(poly, 2 * (dv[0] * u[0] + dv[1] * u[1] + dv[2] * u[2]), 2 * (dv[0] * w[0] + dv[1] * w[1] + dv[2] * w[2]), dd * dd);
          const sg = convex ? 1 : -1; // keep sg · f_j(x) ≤ 0, with x = t + p0 u + p1 w
          const hp = [sg * (nj[0] * u[0] + nj[1] * u[1] + nj[2] * u[2]), sg * (nj[0] * w[0] + nj[1] * w[1] + nj[2] * w[2]), -sg * fji];
          if (convex || !o.concaveUnion) poly = clip2(poly, ...hp);
          else concave.push(hp);
        }
        if (poly.length < 3) break;
      }
      // Across a concave crease the surface is min(max(planes on one side), max(planes on the
      // other)): face i must be above at least ONE plane from the other side, not all of them.
      // So concave constraints combine by union: the face is the pieces C ∩ H_j, which overlap.
      const pieces = poly.length < 3 ? [] : !concave.length ? [poly]
        : concave.map(hp => clip2(poly, ...hp)).filter(q => q.length >= 3);
      if (!pieces.length) { nEmpty++; if (feature) nEmptyFeature++; continue; }
      for (const piece of pieces) polys.push({ owner: i, normal: n, feature,
        pts: piece.map(([p, q]) => [t[0] + p * u[0] + q * w[0], t[1] + p * u[1] + q * w[1], t[2] + p * u[2] + q * w[2]]) });
    }
    return { polys, nEmpty, nEmptyFeature };
  }

  // ---------- Triangulate step patches (RECOVERY.md, Approach 3) ----------
  // Own faces are kept; the steps between them are removed patch by patch. A step patch is a
  // connected set of steps (edge-adjacent); its boundary loop visits own faces a_1 ... a_k. Removing
  // it joins those faces: a triangulation of the loop, in which every triangle (a, b, c) is an output
  // vertex P_a ∩ P_b ∩ P_c and every diagonal makes two faces adjacent. The triangulation is chosen
  // by dynamic programming. Its cost asks each vertex to lie on the side of the patch's other planes
  // expected from the loop's edges: inside them where all edges are convex (the intersection of the
  // half-spaces, an envelope of the planes), outside where all are concave (their union), and as close
  // as possible to them on a saddle (mixed edges), which plays the role of an asymptotic decider.
  // Contour vertices where three or more own faces meet with no step between them are loops too.
  // The output faces are the duals: each own face's polygon is the cycle of triangles around it.
  const PATCH_DEFAULTS = { tau: 1e-12, trust: 2, chamfer: true, stitch: true };
  const DP_MAX = 24; // longer loops, and patches with holes, keep the partition's junctions
  function triangulatePatches(sites, signs, owner, cells, planes, opts) {
    const o = { ...PATCH_DEFAULTS, ...opts };
    // 1. The contour, welded and partitioned as in Contract contour regions (each step labeled with
    //    the nearer of its two owners, then cleaned up). The partition is the restricted Voronoi
    //    diagram of the tangent points; its junctions are the Delaunay triangles used wherever the
    //    planes do not decide (flat patches, patches with holes, long loops).
    const base = recoverSurface(sites, signs, owner, cells, planes, 0, o.tau, o.trust);
    const { pts, faces, heFace } = base.contour;
    for (const F of faces) F.owners = [F.label, F.label];
    const across = (u, v) => heFace.get(`${v},${u}`); // the face on the other side of half-edge u -> v

    // 2. Step patches and their boundary loops, as cyclic sequences of own-face owners. Each
    //    position remembers the contour vertices where the loop enters and leaves that face.
    const patchOf = new Int32Array(faces.length).fill(-1), patches = [];
    faces.forEach((F, fi) => {
      if (F.green || patchOf[fi] >= 0) return;
      const P = { faces: [fi] }; patchOf[fi] = patches.length;
      for (let q = 0; q < P.faces.length; q++) {
        const G = faces[P.faces[q]];
        G.vs.forEach((u, k) => { const g = across(u, G.vs[(k + 1) % G.vs.length]); if (g !== undefined && !faces[g].green && patchOf[g] < 0) { patchOf[g] = patches.length; P.faces.push(g); } });
      }
      patches.push(P);
    });
    const loops = [], stats0 = { partitioned: 0, stitched: 0, flippedPatches: 0, flips: 0, chamfers: 0, pairsLimited: 0 };
    const f = (a, x) => { const P = planes.get(a), n = P.normal, t = P.point; return n[0] * (x[0] - t[0]) + n[1] * (x[1] - t[1]) + n[2] * (x[2] - t[2]); };
    // Edge type of two faces: convex (-1) if each tangent point lies below the other's plane,
    // concave (+1) if above, flat (0) if neither (coplanar planes).
    const etypeOf = (p, q) => {
      if (p === q) return 0;
      const s = f(p, planes.get(q).point) + f(q, planes.get(p).point), scale = dist2(planes.get(p).point, planes.get(q).point);
      return s < -1e-9 * scale ? -1 : s > 1e-9 * scale ? 1 : 0;
    };
    const kindOf = types => { const cv = types.includes(-1), cc = types.includes(1); return cv && cc ? 'saddle' : cv ? 'convex' : cc ? 'concave' : 'flat'; };
    const pairKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
    // The vertex of three planes for the dynamic programs' costs, anchored at m: their intersection,
    // limited to the trust radius (the final placement is in step 5).
    const tripleVertex = (os, m) => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (const a of os) { const { normal: n, point: t } = planes.get(a), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
        for (let p = 0; p < 3; p++) { r[p] += n[p] * c; for (let q = 0; q < 3; q++) A[p][q] += n[p] * n[q]; } }
      return qefTruncated(A, r, m, o.tau, trustRadius(m, os, planes, o.trust));
    };
    const meanOf = us => { const m = [0, 0, 0]; for (const u of us) for (let c = 0; c < 3; c++) m[c] += pts[u][c] / us.length; return m; };
    patches.forEach((P, pi) => {
      const out = new Map();
      for (const fi of P.faces) {
        const vs = faces[fi].vs;
        vs.forEach((u, k) => {
          const v = vs[(k + 1) % vs.length], g = across(u, v);
          if (g !== undefined && patchOf[g] === pi) return;
          if (!out.has(u)) out.set(u, []);
          out.get(u).push([v, g]);
        });
      }
      const rings = [];
      for (const [u0, list] of out) while (list.length) {
        const ring = []; let u = u0;
        do { const [v, g] = out.get(u).pop(); ring.push({ u, v, g }); u = v; } while (out.get(u)?.length && u !== u0);
        if (u === u0) rings.push(ring);
      }
      P.rings = rings;
    });
    // Owner sequence of a ring: the own face across each boundary edge, and at each boundary vertex
    // every labeled face passed when rotating around it outside the patch: own faces that touch the
    // patch only at a corner, and (once the triangulated patches are known) steps of partitioned
    // patches that touch it there, with their labels. Consecutive repeats are merged.
    const ringSeq = (pi, ring, withSteps) => {
        const items = [];
        ring.forEach((e, k) => {
          if (e.g !== undefined && faces[e.g].green) items.push({ ow: faces[e.g].label, at: e.u, at2: e.v });
          const e2 = ring[(k + 1) % ring.length];
          if (e.g === undefined || e2.g === undefined || e.g === e2.g) return;
          for (const way of [0, 1]) { // rotate around v from e.g to e2.g; the side that avoids the patch
            const passed = []; let G = e.g, ok = false;
            for (let step = 0; step < 64; step++) {
              const vs = faces[G].vs, i = vs.indexOf(e.v);
              const H = way ? across(vs[(i + vs.length - 1) % vs.length], e.v) : across(e.v, vs[(i + 1) % vs.length]);
              if (H === undefined || patchOf[H] === pi) break;
              if (H === e2.g) { ok = true; break; }
              passed.push(H); G = H;
            }
            if (!ok) continue;
            for (const H of passed) if (faces[H].green || (withSteps && !patches[patchOf[H]]?.own)) items.push({ ow: faces[H].label, at: e.v, at2: e.v });
            break;
          }
        });
        const seq = [];
        for (const it of items) {
          if (seq.length && seq[seq.length - 1].ow === it.ow) seq[seq.length - 1].leave = it.at2;
          else seq.push({ ow: it.ow, enter: it.at, leave: it.at2 });
        }
        if (seq.length > 1 && seq[0].ow === seq[seq.length - 1].ow) { seq[0].enter = seq[seq.length - 1].enter; seq.pop(); }
        return seq;
    };
    // How each patch is triangulated:
    //  - one loop of 3 to DP_MAX own faces: the polygon dynamic program (step 3);
    //  - two loops (a ring of steps, or an island face inside steps): stitching the two loops, the
    //    contour tiling dynamic program of Fuchs, Kedem and Uselton (step 3);
    //  - otherwise (more loops, such as a flat side of the box with its own faces as islands, or a
    //    long loop): the partition's junctions, the restricted Delaunay triangles of the tangent
    //    points, then flipped toward the planes' envelope if the patch is convex or concave (step 4).
    patches.forEach((P, pi) => {
      const seqs = P.rings.map(ring => ringSeq(pi, ring, false));
      P.kind = kindOf(seqs.flatMap(q => q.map((p, i) => etypeOf(p.ow, q[(i + 1) % q.length].ow))));
      P.boundary = new Set(seqs.flatMap(q => q.length > 1 ? q.map((p, i) => pairKey(p.ow, q[(i + 1) % q.length].ow)) : []));
      if (P.rings.length === 1 && seqs[0].length >= 3 && seqs[0].length <= DP_MAX) P.own = 'dp';
      else if (o.stitch && P.rings.length === 2 && seqs.every(q => q.length >= 1) && seqs.some(q => q.length >= 2) && seqs[0].length * seqs[1].length * Math.min(seqs[0].length, seqs[1].length) <= 2e5) P.own = 'stitch';
      else stats0.partitioned++;
    });
    patches.forEach((P, pi) => {
      if (P.own === 'dp') loops.push({ seq: ringSeq(pi, P.rings[0], true), patch: pi });
      if (P.own === 'stitch') {
        const [A, B] = P.rings.map(ring => ringSeq(pi, ring, true)).sort((x, y) => y.length - x.length);
        if (A.length >= 2 && B.length >= 1) { loops.push({ seq: A, inner: B, patch: pi, stitch: true }); stats0.stitched++; }
      }
    });
    const inDP = new Uint8Array(pts.length), vPatch = new Int32Array(pts.length).fill(-1);
    patches.forEach(P => { if (P.own) for (const fi of P.faces) for (const u of faces[fi].vs) inDP[u] = 1; });
    patches.forEach((P, pi) => { if (!P.own) for (const fi of P.faces) for (const u of faces[fi].vs) vPatch[u] = pi; });
    // Junctions: contour vertices outside the triangulated patches where >= 3 labels meet (own faces
    // meeting with no step between them, and the junctions of the partition).
    const label = F => F.label;
    const incident = pts.map(() => []);
    faces.forEach((F, fi) => F.vs.forEach((u, k) => incident[u].push([fi, k])));
    incident.forEach((inc, v) => {
      if (inc.length < 3 || inDP[v]) return;
      const ows = new Set(inc.map(([fi]) => label(faces[fi])));
      if (ows.size < 3) return;
      // Rotate around v: from face F, cross its edge v -> next to the following face.
      const seq = []; let [fi, k] = inc[0], guard = 0;
      do {
        const F = faces[fi], w = F.vs[(k + 1) % F.vs.length];
        if (seq[seq.length - 1]?.ow !== label(F)) seq.push({ ow: label(F), enter: v, leave: v });
        const g = across(v, w); if (g === undefined) return;
        fi = g; k = faces[g].vs.indexOf(v);
      } while (fi !== inc[0][0] && ++guard < 64);
      if (seq.length > 1 && seq[0].ow === seq[seq.length - 1].ow) seq.pop();
      // This rotation is clockwise seen from the + side; patch loops are counterclockwise.
      if (seq.length >= 3) loops.push({ seq: seq.reverse(), patch: -1, junctionOf: vPatch[v] });
    });

    // 3. Triangulate each loop.
    const stats = { patches: patches.length, loops: loops.length, junctions: loops.filter(L => L.patch < 0).length, byK: {}, convex: 0, concave: 0, saddle: 0, saddleMaxMin: 0, saddleMinMax: 0, flat: 0, ...stats0 };
    const tris = []; // { owners: [a, b, c], x, anchor }
    // Pairs already adjacent: consecutive faces on some loop. A diagonal between such a pair would
    // make them adjacent twice (a non-manifold edge), so it is avoided.
    const loopEdges = new Map();
    for (const L of loops) for (const q of [L.seq, L.inner || []]) if (q.length > 1) q.forEach((p, i) => { const key = pairKey(p.ow, q[(i + 1) % q.length].ow); loopEdges.set(key, (loopEdges.get(key) || 0) + 1); });
    const FORBID = 1e6;

    // Envelope cost of a vertex x of three faces against the other faces of the patch: how far it is
    // on the wrong side of their planes (convex: f <= 0, concave: f >= 0), or off them on a saddle.
    const envCost = (kind, x, os, others) => {
      let c = 0;
      for (const d of others) {
        if (os.includes(d)) continue;
        const v = f(d, x);
        c += kind === 'convex' ? Math.max(0, v) : kind === 'concave' ? Math.max(0, -v) : kind === 'saddle' ? Math.abs(v) : 0;
      }
      return c;
    };

    // Stitch the two loops of a patch (Fuchs, Kedem and Uselton 1977). Both loops have the patch on
    // their left, so sweeping around it goes forward along A and backward along B. Each step adds a
    // triangle with an edge of one loop and a corner on the other: (a_i, a_i+1, b_j) or
    // (b_j+1, b_j, a_i) with B reversed. All starting pairs are tried; an island (B of one face) is
    // a fan.
    function stitch(L) {
      const A = L.seq, B = L.inner.slice().reverse(), k = A.length, m = B.length;
      const owners = [...new Set([...A, ...B].map(p => p.ow))];
      const types = [A, L.inner].flatMap(q => q.length > 1 ? q.map((p, i) => etypeOf(p.ow, q[(i + 1) % q.length].ow)) : []);
      const kind = kindOf(types);
      stats[kind]++;
      const cache = new Map();
      const tri = (pa, pb, pc, spans) => { // positions; spans: the two new interior pairs
        const os = [pa.ow, pb.ow, pc.ow];
        if (os[0] === os[1] || os[1] === os[2] || os[0] === os[2]) return { cost: Infinity };
        const key = os.join(',');
        if (!cache.has(key)) {
          const anc = meanOf([pa.enter, pa.leave, pb.enter, pb.leave, pc.enter, pc.leave]), x = tripleVertex(os, anc);
          cache.set(key, { owners: os, x, anchor: anc, cost: envCost(kind, x, os, owners) });
        }
        const t = cache.get(key);
        return { ...t, cost: t.cost + spans.filter(([p, q]) => loopEdges.has(pairKey(p, q))).length * FORBID };
      };
      if (m === 1) { for (let i = 0; i < k; i++) { const t = tri(A[i], A[(i + 1) % k], B[0], []); if (t.x) tris.push(t); } return; }
      let best = null;
      for (let j0 = 0; j0 < m; j0++) {
        const C = Array.from({ length: k + 1 }, () => new Float64Array(m + 1).fill(Infinity)), S = Array.from({ length: k + 1 }, () => new Int8Array(m + 1));
        C[0][0] = 0;
        for (let i = 0; i <= k; i++) for (let j = 0; j <= m; j++) {
          if (C[i][j] === Infinity) continue;
          const a = A[i % k], b = B[(j0 + j) % m];
          if (i < k) { const t = tri(a, A[(i + 1) % k], b, [[A[(i + 1) % k].ow, b.ow]]), c = C[i][j] + t.cost; if (c < C[i + 1][j]) { C[i + 1][j] = c; S[i + 1][j] = 1; } }
          if (j < m) { const b2 = B[(j0 + j + 1) % m], t = tri(b2, b, a, [[b2.ow, a.ow]]), c = C[i][j] + t.cost; if (c < C[i][j + 1]) { C[i][j + 1] = c; S[i][j + 1] = 2; } }
        }
        if (C[k][m] < Infinity && (!best || C[k][m] < best.cost)) best = { cost: C[k][m], S, j0 };
      }
      if (!best) return;
      for (let i = k, j = m; i > 0 || j > 0;) {
        const b = B[(best.j0 + j) % m];
        if (best.S[i][j] === 1) { const t = tri(A[i - 1], A[i % k], B[(best.j0 + j) % m], []); if (t.x) tris.push(t); i--; }
        else { const t = tri(B[(best.j0 + j) % m], B[(best.j0 + j - 1) % m], A[i % k], []); if (t.x) tris.push(t); j--; }
        void b;
      }
    }

    for (const L of loops) {
      if (L.stitch) { stitch(L); continue; }
      const seq = L.seq, k = seq.length, tri0 = tris.length;
      stats.byK[k] = (stats.byK[k] || 0) + 1;
      // Edge types around the loop: convex (-1) if each tangent point lies below the other's plane,
      // concave (+1) if above, flat (0) if neither (coplanar planes).
      const etype = seq.map((p, i) => {
        const q = seq[(i + 1) % k]; if (p.ow === q.ow) return 0;
        const s = f(p.ow, planes.get(q.ow).point) + f(q.ow, planes.get(p.ow).point);
        const scale = dist2(planes.get(p.ow).point, planes.get(q.ow).point);
        return s < -1e-9 * scale ? -1 : s > 1e-9 * scale ? 1 : 0;
      });
      const cv = etype.includes(-1), cc = etype.includes(1);
      const kind = cv && cc ? 'saddle' : cv ? 'convex' : cc ? 'concave' : 'flat';
      stats[kind]++;
      // The two lattice readings of the loop. 'maxmin': runs joined by convex (or flat) edges are
      // convex groups, and the surface is the union of their intersections. 'minmax': runs joined by
      // concave (or flat) edges are concave groups, and the surface is the intersection of their
      // unions. A vertex must lie inside (outside) every plane of its own groups and must not be
      // strictly inside (outside) any other group.
      const groupsFor = sgn => { // sgn = -1: group by convex edges; +1: by concave edges
        const g = new Int32Array(k).fill(-1); let start = etype.findIndex(e => e !== sgn && e !== 0);
        if (start < 0) return g.fill(0);
        let id = 0;
        for (let m = 1; m <= k; m++) { const i = (start + m) % k; g[i] = id; if (etype[i] !== sgn && etype[i] !== 0) id++; }
        return g;
      };
      const reading = sgn => {
        const g = groupsFor(sgn);
        return (x, tri3) => {
          const mine = new Set(tri3.map(i => g[i])), others = new Map();
          let cost = 0;
          for (let d = 0; d < k; d++) {
            if (tri3.includes(d) || tri3.some(i => seq[i].ow === seq[d].ow)) continue;
            const v = f(seq[d].ow, x);
            if (mine.has(g[d])) cost += Math.max(0, sgn < 0 ? v : -v); // inside (outside) my groups' planes
            else others.set(g[d], sgn < 0 ? Math.max(others.get(g[d]) ?? -Infinity, v) : Math.min(others.get(g[d]) ?? Infinity, v));
          }
          for (const ext of others.values()) cost += Math.max(0, sgn < 0 ? -ext : ext); // not strictly inside (outside) another group
          return cost;
        };
      };
      const vertexOf = (i, j, l) => {
        const os = [seq[i].ow, seq[j].ow, seq[l].ow];
        if (os[0] === os[1] || os[1] === os[2] || os[0] === os[2]) return null;
        const anc = [0, 0, 0], cs = [i, j, l].flatMap(m => [seq[m].enter, seq[m].leave]);
        for (const u of cs) for (let c = 0; c < 3; c++) anc[c] += pts[u][c] / cs.length;
        const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
        for (const a of os) { const { normal: n, point: t } = planes.get(a), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
          for (let p = 0; p < 3; p++) { r[p] += n[p] * c; for (let q = 0; q < 3; q++) A[p][q] += n[p] * n[q]; } }
        let forbid = 0;
        for (const [p, q] of [[i, j], [j, l], [i, l]]) if ((q - p) % k !== 1 && (p - q + k) % k !== 1 && loopEdges.has(pairKey(seq[p].ow, seq[q].ow))) forbid += FORBID;
        return { x: qefTruncated(A, r, anc, o.tau, trustRadius(anc, os, planes, o.trust)), anchor: anc, owners: os, forbid };
      };
      if (k > DP_MAX) { for (let l = 1; l + 1 < k; l++) { const t = vertexOf(0, l, l + 1); if (t) { t.patch = L.junctionOf; tris.push(t); } } continue; } // a junction of very many labels: fan
      const V = new Map(), vert = (i, l, j) => { const key = `${i},${l},${j}`; if (!V.has(key)) V.set(key, vertexOf(i, l, j)); return V.get(key); };
      // Minimum-cost triangulation of the polygon 0 .. k-1 (Klincsek's O(k^3) dynamic program), once
      // per reading. For a saddle this is the decider: a reading with at most two groups against at least
      // four for the other is taken (long runs of one convexity, such as the two sides of a crease, are
      // strong evidence); otherwise the cheaper reading wins.
      let best = null;
      const nCv = etype.filter(e => e < 0).length, nCc = etype.filter(e => e > 0).length; // groups: maxmin has nCc, minmax nCv
      const readings = !(cc && cv) ? [cc ? 1 : -1] : nCc <= 2 && nCv >= 4 ? [-1] : nCv <= 2 && nCc >= 4 ? [1] : [-1, 1];
      for (const sgn of readings) {
        const cost3 = reading(sgn);
        const C = Array.from({ length: k }, () => new Float64Array(k)), S = Array.from({ length: k }, () => new Int32Array(k).fill(-1));
        for (let len = 2; len < k; len++) for (let i = 0; i + len < k; i++) {
          const j = i + len; let bc = Infinity, bl = -1;
          for (let l = i + 1; l < j; l++) {
            const t = vert(i, l, j), c = C[i][l] + C[l][j] + (t ? t.forbid + cost3(t.x, [i, l, j]) : Infinity);
            if (c < bc || bl < 0) { bc = c; bl = l; }
          }
          C[i][j] = bc; S[i][j] = bl;
        }
        if (!best || C[0][k - 1] < best.cost) best = { cost: C[0][k - 1], S, sgn };
      }
      if (kind === 'saddle') stats[best.sgn < 0 ? 'saddleMaxMin' : 'saddleMinMax']++;
      const collect = (i, j) => { if (j - i < 2) return; const l = best.S[i][j], t = vert(i, l, j); if (t) tris.push(t); collect(i, l); collect(l, j); };
      collect(0, k - 1);
      if (L.junctionOf >= 0) for (let t = tri0; t < tris.length; t++) tris[t].patch = L.junctionOf;
    }

    // 4. Patches kept from the partition: flip their triangles toward the envelope of their planes
    //    (Lawson's algorithm). For triangles (a, b, c) and (a, c, d) sharing edge ac, the edge is
    //    right when plane d is on the envelope's side of P_a ∩ P_b ∩ P_c (on a quadric, the in-circle
    //    test in the metric Q). A flip needs a convex quad, may not create an edge that exists, and
    //    is made when it lowers the violation. Flat patches already have the Delaunay tie-break, and
    //    saddle patches keep it too (flips do not settle there).
    const edgeCount = new Map();
    const countEdges = (t, d) => { const [a, b, c] = t.owners; for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = pairKey(p, q); edgeCount.set(key, (edgeCount.get(key) || 0) + d); if (!edgeCount.get(key)) edgeCount.delete(key); } };
    tris.forEach(t => countEdges(t, 1));
    const ownerAnchor = new Map();
    tris.forEach(t => t.owners.forEach(a => { const s = ownerAnchor.get(a) || [0, 0, 0, 0]; for (let c = 0; c < 3; c++) s[c] += t.anchor[c]; s[3]++; ownerAnchor.set(a, s); }));
    const anchorOf3 = os => { const m = [0, 0, 0]; for (const a of os) { const s = ownerAnchor.get(a); for (let c = 0; c < 3; c++) m[c] += s[c] / s[3] / 3; } return m; };
    const convexQuad = (a, b, c, d) => {
      const N = [0, 0, 0]; for (const ow of [a, b, c, d]) { const n = planes.get(ow).normal; for (let i = 0; i < 3; i++) N[i] += n[i]; }
      const P = [a, b, c, d].map(ow => planes.get(ow).point);
      const cr = (p0, p1, p2) => { const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        return (u[1] * w[2] - u[2] * w[1]) * N[0] + (u[2] * w[0] - u[0] * w[2]) * N[1] + (u[0] * w[1] - u[1] * w[0]) * N[2]; };
      const sg = [cr(P[0], P[1], P[2]), cr(P[1], P[2], P[3]), cr(P[2], P[3], P[0]), cr(P[3], P[0], P[1])];
      return sg.every(x => x > 0) || sg.every(x => x < 0);
    };
    patches.forEach((P, pi) => {
      if (P.own || (P.kind !== 'convex' && P.kind !== 'concave')) return;
      const T = tris.map((t, ti) => t.patch === pi ? ti : -1).filter(ti => ti >= 0);
      if (T.length < 2) return;
      stats.flippedPatches++;
      const sg = P.kind === 'convex' ? 1 : -1, vi = v => Math.max(0, sg * v);
      const X = os => tripleVertex(os, anchorOf3(os));
      const onEdge = new Map(), add = ti => { const o3 = tris[ti].owners; for (let r = 0; r < 3; r++) { const key = pairKey(o3[r], o3[(r + 1) % 3]); if (!onEdge.has(key)) onEdge.set(key, new Set()); onEdge.get(key).add(ti); } };
      const del = ti => { const o3 = tris[ti].owners; for (let r = 0; r < 3; r++) onEdge.get(pairKey(o3[r], o3[(r + 1) % 3]))?.delete(ti); };
      T.forEach(add);
      const queue = [...onEdge.keys()].filter(key => !P.boundary.has(key));
      for (let guard = 0; queue.length && guard < 20 * T.length + 100; guard++) {
        const key = queue.pop(), ts = onEdge.get(key);
        if (!ts || ts.size !== 2 || P.boundary.has(key)) continue;
        const [t1, t2] = [...ts], [e0, e1] = key.split(',').map(Number), o1 = tris[t1].owners;
        const r = [0, 1, 2].find(i => { const p = o1[i], q = o1[(i + 2) % 3]; return (p === e0 && q === e1) || (p === e1 && q === e0); });
        if (r === undefined) continue;
        const a = o1[r], b = o1[(r + 1) % 3], c = o1[(r + 2) % 3], o2 = tris[t2].owners, s2 = o2.indexOf(a);
        if (s2 < 0 || o2[(s2 + 1) % 3] !== c) continue;
        const d = o2[(s2 + 2) % 3];
        if (b === d || edgeCount.has(pairKey(b, d)) || !convexQuad(a, b, c, d)) continue;
        const before = vi(f(d, X([a, b, c]))) + vi(f(b, X([a, c, d]))), after = vi(f(c, X([a, b, d]))) + vi(f(a, X([b, c, d])));
        if (!(after < before - 1e-12)) continue;
        del(t1); del(t2); countEdges(tris[t1], -1); countEdges(tris[t2], -1);
        for (const [ti, os] of [[t1, [a, b, d]], [t2, [b, c, d]]]) { const m = anchorOf3(os); tris[ti] = { owners: os, x: tripleVertex(os, m), anchor: m, patch: pi }; }
        add(t1); add(t2); countEdges(tris[t1], 1); countEdges(tris[t2], 1); stats.flips++;
        for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]]) { const e = pairKey(p, q); if (!P.boundary.has(e)) queue.push(e); }
      }
    });

    // 5. Vertices, clipped to the footprint. A triangle's vertex is the exact intersection of its
    //    three planes when that lies within the trust radius of its anchor (the trust factor times the
    //    distance to the farthest of its tangent points). Otherwise the vertex is replaced by a small
    //    chamfer: one point on each line P_a ∩ P_b, the point of that line nearest the anchor, joined
    //    by an extra face. Every tangent-plane face then stays exactly planar, except where two planes
    //    are so nearly parallel that their line is beyond the trust radius too: that point stays within
    //    it, on the pair's average plane (counted in pairsLimited).
    const verts = [], anchors = [], vertOwners = [], vid = tris.map(() => null), chamferPolys = [];
    const pairPoint = (p, q, m, rho) => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (const a of [p, q]) { const { normal: n, point: t } = planes.get(a), c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
        for (let i = 0; i < 3; i++) { r[i] += n[i] * c; for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j]; } }
      const y = qefTruncated(A, r, m, o.tau, rho);
      if (dist2(y, qefTruncated(A, r, m, o.tau)) > 1e-24) stats.pairsLimited++; // nearly parallel: on the pair's average plane
      return y;
    };
    tris.forEach((t, ti) => {
      const os = t.owners, m = t.anchor, A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (const a of os) { const { normal: n, point: tp } = planes.get(a), c = n[0] * tp[0] + n[1] * tp[1] + n[2] * tp[2];
        for (let i = 0; i < 3; i++) { r[i] += n[i] * c; for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j]; } }
      const x = qefTruncated(A, r, m, o.tau), rho = trustRadius(m, os, planes, o.trust);
      if (!o.chamfer) { vid[ti] = { all: verts.length }; verts.push(t.x); anchors.push(m); vertOwners.push(os); return; }
      if (Math.sqrt(dist2(x, m)) <= rho) { vid[ti] = { all: verts.length }; verts.push(x); anchors.push(m); vertOwners.push(os); return; }
      stats.chamfers++;
      const ids = {};
      for (let e = 0; e < 3; e++) { const p = os[e], q = os[(e + 1) % 3]; ids[pairKey(p, q)] = verts.length; verts.push(pairPoint(p, q, m, rho)); anchors.push(m); vertOwners.push([p, q]); }
      vid[ti] = { pair: ids };
      chamferPolys.push({ owner: -1, chamfer: true, normal: (() => { const n = [0, 0, 0]; for (const a of os) { const v = planes.get(a).normal; for (let c = 0; c < 3; c++) n[c] += v[c] / 3; } return n; })(),
        verts: [ids[pairKey(os[0], os[1])], ids[pairKey(os[1], os[2])], ids[pairKey(os[2], os[0])]], holes: [] });
    });
    // The vertices a triangle (a, b, c) contributes to a's face: entering from b, leaving toward c.
    const ringVerts = (ti, a) => {
      const v = vid[ti]; if (v.all !== undefined) return [v.all];
      const o3 = tris[ti].owners, r = o3.indexOf(a);
      return [v.pair[pairKey(a, o3[(r + 1) % 3])], v.pair[pairKey(a, o3[(r + 2) % 3])]];
    };

    // 6. Faces: the triangles around each owner. Every loop is counterclockwise seen from the + side
    //    and the dynamic programs keep loop order, so each triangle (a, b, c) is oriented; around a it
    //    says "after neighbor b comes c". Following that order gives consistently oriented faces.
    const triAnchor = tris.map(t => t.anchor);
    // Twins: the triangle with directed edge p -> q is glued to one with q -> p. Where the same faces
    // meet at two places there are two of each; they are paired by nearest anchors.
    const dir = new Map(); // "p,q" -> [triangle]
    tris.forEach((t, ti) => { for (let r = 0; r < 3; r++) { const key = `${t.owners[r]},${t.owners[(r + 1) % 3]}`; if (!dir.has(key)) dir.set(key, []); dir.get(key).push(ti); } });
    const twin = new Map(); // "triangle,p,q" -> triangle across that edge
    for (const [key, list] of dir) {
      const [p, q] = key.split(','), back = (dir.get(`${q},${p}`) || []).slice();
      if (p > q && dir.has(`${q},${p}`)) continue; // each undirected edge once
      const fwd = list.slice();
      while (fwd.length && back.length) {
        let bi = 0, bj = 0, bd = Infinity;
        fwd.forEach((t, i) => back.forEach((u, j) => { const d = dist2(triAnchor[t], triAnchor[u]); if (d < bd) { bd = d; bi = i; bj = j; } }));
        const t = fwd.splice(bi, 1)[0], u = back.splice(bj, 1)[0];
        twin.set(`${t},${p},${q}`, u); twin.set(`${u},${q},${p}`, t);
      }
    }
    stats.nonManifoldEdges = [...edgeCount.values()].filter(n => n !== 2).length;
    // Around owner a: triangle (a, b, c) is followed by the triangle across its edge c -> a, which
    // contains a -> c, i.e. is (a, c, d).
    const polys = []; stats.openFans = 0; stats.splitFans = 0;
    let agree = 0;
    const byOwner = new Map();
    tris.forEach((t, ti) => t.owners.forEach(a => { if (!byOwner.has(a)) byOwner.set(a, []); byOwner.get(a).push(ti); }));
    for (const [a, list] of byOwner) {
      const used = new Set(); let cycles = 0;
      for (const t0 of list) {
        if (used.has(t0)) continue;
        const ring = []; let t = t0, closed = false;
        while (t !== undefined && !used.has(t)) {
          used.add(t); ring.push(t);
          const o3 = tris[t].owners, r = o3.indexOf(a), c = o3[(r + 2) % 3];
          t = twin.get(`${t},${c},${a}`);
          if (t === t0) closed = true;
        }
        if (!closed) { // walk the other way to collect the whole open fan
          stats.openFans++;
          let u = t0;
          for (;;) { const o3 = tris[u].owners, r = o3.indexOf(a), b = o3[(r + 1) % 3], v = twin.get(`${u},${a},${b}`); if (v === undefined || used.has(v)) break; used.add(v); ring.unshift(v); u = v; }
        }
        const vs = ring.flatMap(ti => ringVerts(ti, a));
        if (vs.length < 3) continue;
        cycles++;
        const V = vs.map(k => verts[k]), nn = [0, 0, 0], n = planes.get(a).normal;
        V.forEach((p, i) => { const q = V[(i + 1) % V.length]; nn[0] += p[1] * q[2] - p[2] * q[1]; nn[1] += p[2] * q[0] - p[0] * q[2]; nn[2] += p[0] * q[1] - p[1] * q[0]; });
        agree += Math.sign(nn[0] * n[0] + nn[1] * n[1] + nn[2] * n[2]);
        polys.push({ owner: a, normal: n, verts: vs, holes: [] });
      }
      if (cycles > 1) stats.splitFans++;
    }
    polys.push(...chamferPolys);
    if (agree < 0) for (const P of polys) P.verts.reverse(); // face the + side
    stats.facelessOwners = [...planes.keys()].filter(a => !byOwner.has(a)).length;
    return { verts, anchors, vertOwners, polys, patchStats: stats };
  }

  // ---------- Approach 4: tangent balls, and merging steps into faces ----------
  //
  // Each owner a gets one ball tangent to P_a at t_a, center t_a + σ λ_a n_a, weight λ_a², sign σ, and
  // its tangent point (weight 0, sign −σ). Any ball tangent at t_a keeps the own face exactly in P_a. A
  // step between a's ball and b's tangent cell lies where f_a = (|x − t_a|² − |x − t_b|²) / (2 λ_a), so
  // large balls flatten the steps onto the planes. But a ball must not contain another tangent point,
  // or its cell takes over that point. So σ is the side with the larger empty ball (empty of the
  // other tangent points: the convex side of the surface, where the surface curves away from the
  // ball), and λ_a = min(cap, ρ × that ball's radius). The sample's sign is not used. See RECOVERY.md,
  // Approach 4.
  const BALL_DEFAULTS = { rho: 0.5, cap: 100 };
  function emptyBallRadii(planes) {
    const ks = [...planes.keys()], P = ks.map(k => planes.get(k)), out = new Map();
    P.forEach((Pa, ia) => {
      const t = Pa.point, n = Pa.normal; let up = Infinity, dn = Infinity;
      P.forEach((Pb, ib) => {
        if (ib === ia) return;
        const d = [Pb.point[0] - t[0], Pb.point[1] - t[1], Pb.point[2] - t[2]], r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (r2 < 1e-24) return; // the same point (an edge or corner shared by several tangent planes)
        const g = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]; // f_a(t_b)
        if (g > 1e-12 * Math.sqrt(r2)) up = Math.min(up, r2 / (2 * g)); else if (g < -1e-12 * Math.sqrt(r2)) dn = Math.min(dn, r2 / (-2 * g));
      });
      out.set(ks[ia], { up, dn });
    });
    return out;
  }
  // planes: owner -> { point, normal }. Returns the sites (balls first, then tangent points) with stable
  // lifts |p|² − w for computePowerDiagram, and per owner { side, lambda, up, dn }.
  function tangentBallSites(planes, opts) {
    const o = { ...BALL_DEFAULTS, ...opts }, R = emptyBallRadii(planes);
    const sites = [], weights = [], signs = [], owner = [], lifts = [], isTangent = [], balls = new Map();
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const [k, P] of planes) {
      const { up, dn } = R.get(k), side = up >= dn ? 1 : -1, lambda = Math.min(o.cap, o.rho * (side > 0 ? up : dn)), t = P.point, n = P.normal;
      balls.set(k, { side, lambda, up, dn });
      sites.push([t[0] + side * lambda * n[0], t[1] + side * lambda * n[1], t[2] + side * lambda * n[2]]);
      weights.push(lambda * lambda); signs.push(side); owner.push(k); isTangent.push(false); lifts.push(dot(t, t) + 2 * side * lambda * dot(t, n));
    }
    for (const [k, P] of planes) { sites.push(P.point); weights.push(0); signs.push(-balls.get(k).side); owner.push(k); isTangent.push(true); lifts.push(dot(P.point, P.point)); }
    return { sites, weights, signs, owner, lifts, isTangent, balls };
  }

  // Merge steps into faces: every step goes to the owner whose tangent plane it is nearer, so each
  // region is an own face plus the steps that (nearly) lie in its plane; the regions are cleaned up and
  // turned into polygons as in Contract contour regions, but keeping every vertex of the region
  // boundaries at its contour position (a vertex of the power diagram: nothing is invented). Faces are
  // then planar up to the step heights. Options:
  //   snap: move each vertex to min Σ f_a(x)² + snap |x − v|² over its regions' planes (0: off);
  //   gaps: make every face exactly planar instead: each face gets its own copies of its corners,
  //         projected onto its plane, and the gaps between neighbors are closed by gap faces (a quad per
  //         shared edge, a polygon per vertex shared by three or more faces), so it stays watertight.
  const MERGE_DEFAULTS = { snap: 0, gaps: false };
  function mergeSteps(sites, signs, owner, cells, planes, opts) {
    const o = { ...MERGE_DEFAULTS, ...opts };
    const r = recoverSurface(sites, signs, owner, cells, planes, 0, 0, Infinity, { label: 'plane', keepCells: true, snap: o.snap });
    const fAbs = (a, x) => { const P = planes.get(a), n = P.normal, t = P.point; return Math.abs(n[0] * (x[0] - t[0]) + n[1] * (x[1] - t[1]) + n[2] * (x[2] - t[2])); };
    let offPlane = 0;
    for (const P of r.polys) for (const L of [P.verts, ...P.holes]) for (const k of L) offPlane = Math.max(offPlane, fAbs(P.owner, r.verts[k]));
    const steps = r.contour.faces.filter(F => !F.green).length;
    r.mergeStats = { steps, ownFaces: r.contour.faces.length - steps, offPlane, gapWidth: 0, gapFaces: 0 };
    if (!o.gaps) return r;
    const g = planarWithGaps(r, planes);
    g.mergeStats = { ...r.mergeStats, gapWidth: g.gapWidth, gapFaces: g.polys.filter(P => P.gap).length };
    g.topo = r.topo; g.badOwners = r.badOwners;
    return g;
  }
  function planarWithGaps(r, planes) {
    const verts = [], copy = new Map(); // "poly,u" -> index of poly's own copy of vertex u
    const proj = (a, x) => { const P = planes.get(a), n = P.normal, d = n[0] * (x[0] - P.point[0]) + n[1] * (x[1] - P.point[1]) + n[2] * (x[2] - P.point[2]); return [x[0] - d * n[0], x[1] - d * n[1], x[2] - d * n[2]]; };
    const cp = (pi, u) => { const k = pi + ',' + u; if (!copy.has(k)) { copy.set(k, verts.length); verts.push(proj(r.polys[pi].owner, r.verts[u])); } return copy.get(k); };
    const polys = [], edgeOf = new Map(); // directed edge "u,v" -> poly
    r.polys.forEach((P, pi) => {
      for (const L of [P.verts, ...P.holes]) L.forEach((u, k) => edgeOf.set(u + ',' + L[(k + 1) % L.length], pi));
      polys.push({ owner: P.owner, normal: P.normal, verts: P.verts.map(u => cp(pi, u)), holes: P.holes.map(H => H.map(u => cp(pi, u))) });
    });
    const len = (a, b) => Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1], verts[a][2] - verts[b][2]);
    let gapWidth = 0;
    const next = new Map(); // around a vertex u: Q's copy -> P's copy, for P's edge u -> v whose twin is in Q
    for (const [e, pi] of edgeOf) {
      const [u, v] = e.split(',').map(Number), qi = edgeOf.get(v + ',' + u);
      if (qi === undefined || qi === pi) continue;
      if (pi < qi) { // the quad Pv -> Pu -> Qu -> Qv glues P's edge u -> v to Q's edge v -> u
        const Pu = cp(pi, u), Pv = cp(pi, v), Qu = cp(qi, u), Qv = cp(qi, v);
        gapWidth = Math.max(gapWidth, len(Pu, Qu), len(Pv, Qv));
        polys.push({ owner: -1, gap: true, verts: [Pv, Pu, Qu, Qv], holes: [] });
      }
      next.set(cp(qi, u), cp(pi, u));
    }
    const seen = new Set();
    for (const [a0] of next) { // a vertex shared by k >= 3 faces: the polygon of its k copies (k = 2 cancels)
      if (seen.has(a0)) continue;
      const cyc = []; let a = a0;
      while (a !== undefined && !seen.has(a)) { seen.add(a); cyc.push(a); a = next.get(a); }
      if (a === a0 && cyc.length >= 3) polys.push({ owner: -1, gap: true, verts: cyc, holes: [] });
    }
    for (const P of polys) if (P.gap) {
      const s = [0, 0, 0];
      P.verts.forEach((k, i) => { const p = verts[k], q = verts[P.verts[(i + 1) % P.verts.length]]; s[0] += p[1] * q[2] - p[2] * q[1]; s[1] += p[2] * q[0] - p[0] * q[2]; s[2] += p[0] * q[1] - p[1] * q[0]; });
      const l = Math.hypot(s[0], s[1], s[2]) || 1; P.normal = [s[0] / l, s[1] / l, s[2] / l];
    }
    return { verts, polys, gapWidth };
  }

  const api = { recoverSurface, triangulatePatches, PATCH_DEFAULTS, extendOwnFaces, mirroredSites, contourNeighbors, clipTangentPlanes, CLIP_DEFAULTS,
    tangentBallSites, emptyBallRadii, BALL_DEFAULTS, mergeSteps, MERGE_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recover = api;
})(this);
