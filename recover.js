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
  function recoverSurface(sites, signs, owner, cells, planes, lambda, tau = 0, trust = Infinity) {
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
    return { verts, anchors, vertOwners, polys, badOwners, nRegions: perLabel.size, topo };
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
  const PATCH_DEFAULTS = { tau: 1e-12, trust: 2 };
  const DP_MAX = 24; // longer loops, and patches with holes, are partitioned instead
  function triangulatePatches(sites, signs, owner, cells, planes, opts) {
    const o = { ...PATCH_DEFAULTS, ...opts };
    // 1. Contour faces from the + side, welded; own faces are green.
    const welder = makeWelder(), faces = [];
    cells.forEach((cf, i) => {
      if (signs[i] <= 0) return;
      for (const f of cf) {
        const j = f.label;
        if (j < 0 || signs[j] >= 0) continue;
        const a = owner[i], b = owner[j];
        if (!planes.get(a) || !planes.get(b)) continue;
        const vs = f.verts.map(p => welder.id(p)).filter((u, k, w) => u !== w[(k + 1) % w.length]);
        if (vs.length >= 3) faces.push({ owners: [a, b], green: a === b, vs });
      }
    });
    const pts = welder.pts, heFace = new Map();
    faces.forEach((F, fi) => F.vs.forEach((u, k) => heFace.set(`${u},${F.vs[(k + 1) % F.vs.length]}`, fi)));
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
    const loops = [], stats0 = { partitioned: 0 };
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
      // Owner sequence of each ring: the own face across each boundary edge, and at each boundary
      // vertex every own face passed when rotating around it outside the patch (own faces that touch
      // the patch only at a corner). Consecutive repeats are merged into one position.
      const seqs = rings.map(ring => {
        const items = [];
        ring.forEach((e, k) => {
          if (e.g !== undefined && faces[e.g].green) items.push({ ow: faces[e.g].owners[0], at: e.u, at2: e.v });
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
            for (const H of passed) if (faces[H].green) items.push({ ow: faces[H].owners[0], at: e.v, at2: e.v });
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
      }).filter(s => s.length >= 2);
      // A single loop of at most DP_MAX own faces is triangulated from its planes. Otherwise (a patch
      // with holes, such as a flat side of the box with its own faces as islands, or a long crease
      // strip) the patch is partitioned like Contract contour regions: each step goes to the nearest
      // tangent point among the faces around the patch, and its vertices are junctions of the labels.
      if (seqs.length === 1 && rings.length === 1 && seqs[0].length <= DP_MAX) { if (seqs[0].length >= 3) loops.push({ seq: seqs[0], patch: pi }); return; }
      const around = new Set(); rings.forEach(ring => ring.forEach(e => { if (e.g !== undefined && faces[e.g].green) around.add(faces[e.g].owners[0]); }));
      seqs.forEach(sq => sq.forEach(q => around.add(q.ow)));
      if (!around.size) return;
      stats0.partitioned++;
      for (const fi of P.faces) {
        const vs = faces[fi].vs, c = [0, 1, 2].map(i => vs.reduce((s, u) => s + pts[u][i], 0) / vs.length);
        let best = -1, bd = Infinity;
        for (const o of around) { const d = dist2(c, planes.get(o).point); if (d < bd) { bd = d; best = o; } }
        faces[fi].label = best;
      }
    });
    // Junctions: contour vertices around which every face is labeled (an own face, or a step of a
    // partitioned patch) and >= 3 labels meet.
    const label = F => F.green ? F.owners[0] : F.label;
    const incident = pts.map(() => []);
    faces.forEach((F, fi) => F.vs.forEach((u, k) => incident[u].push([fi, k])));
    incident.forEach((inc, v) => {
      if (inc.length < 3 || inc.some(([fi]) => label(faces[fi]) === undefined)) return;
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
      if (seq.length >= 3) loops.push({ seq: seq.reverse(), patch: -1 });
    });

    // 3. Triangulate each loop.
    const f = (a, x) => { const P = planes.get(a), n = P.normal, t = P.point; return n[0] * (x[0] - t[0]) + n[1] * (x[1] - t[1]) + n[2] * (x[2] - t[2]); };
    const stats = { patches: patches.length, loops: loops.length, junctions: loops.filter(L => L.patch < 0).length, byK: {}, convex: 0, concave: 0, saddle: 0, saddleMaxMin: 0, saddleMinMax: 0, flat: 0, ...stats0 };
    const tris = []; // { owners: [a, b, c], x, anchor }
    // Pairs already adjacent: consecutive faces on some loop. A diagonal between such a pair would
    // make them adjacent twice (a non-manifold edge), so it is avoided.
    const pairKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`, loopEdges = new Map();
    for (const L of loops) L.seq.forEach((p, i) => { const key = pairKey(p.ow, L.seq[(i + 1) % L.seq.length].ow); loopEdges.set(key, (loopEdges.get(key) || 0) + 1); });
    const FORBID = 1e6;
    for (const L of loops) {
      const seq = L.seq, k = seq.length;
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
      if (k > DP_MAX) { for (let l = 1; l + 1 < k; l++) { const t = vertexOf(0, l, l + 1); if (t) tris.push(t); } continue; } // a junction of many labels: fan
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
    }

    // 4. Faces: the triangles around each owner. Every loop is counterclockwise seen from the + side
    //    and the dynamic program keeps loop order, so each triangle (a, b, c) is oriented; around a it
    //    says "after neighbor b comes c". Following that order gives consistently oriented faces.
    const verts = tris.map(t => t.x), anchors = tris.map(t => t.anchor), vertOwners = tris.map(t => t.owners);
    const next = new Map(); // owner -> Map(b -> [[c, triangle]])
    tris.forEach((t, ti) => { for (let r = 0; r < 3; r++) {
      const a = t.owners[r], b = t.owners[(r + 1) % 3], c = t.owners[(r + 2) % 3];
      if (!next.has(a)) next.set(a, new Map());
      const m = next.get(a); if (!m.has(b)) m.set(b, []); m.get(b).push([c, ti]);
    } });
    const edgeUse = new Map();
    tris.forEach(t => { const [a, b, c] = t.owners; for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p < q ? `${p},${q}` : `${q},${p}`; edgeUse.set(key, (edgeUse.get(key) || 0) + 1); } });
    stats.nonManifoldEdges = [...edgeUse.values()].filter(n => n !== 2).length;
    const polys = []; stats.openFans = 0; stats.splitFans = 0;
    let agree = 0;
    for (const [a, m] of next) {
      const used = new Set(); let cycles = 0;
      const starts = [...m.keys()].sort((p, q) => { // start chains where nothing leads in, so open fans are walked whole
        const into = b => [...m.values()].some(l => l.some(([c, ti]) => c === b && !used.has(ti)));
        return into(p) - into(q); });
      for (const b0 of starts) {
        let b = b0; const ring = [];
        while (m.get(b)?.some(([, ti]) => !used.has(ti))) {
          // The same faces can meet at two places (two edges between a and b): continue with the
          // triangle nearest to the previous one on the contour.
          const cand = m.get(b).filter(([, t]) => !used.has(t)), last = ring.length ? anchors[ring[ring.length - 1]] : null;
          const [c, ti] = last && cand.length > 1 ? cand.reduce((p, q) => dist2(anchors[q[1]], last) < dist2(anchors[p[1]], last) ? q : p) : cand[0];
          used.add(ti); ring.push(ti); b = c;
        }
        if (!ring.length) continue;
        if (b !== b0) stats.openFans++;
        if (ring.length < 3) continue;
        cycles++;
        const V = ring.map(ti => verts[ti]), nn = [0, 0, 0], n = planes.get(a).normal;
        V.forEach((p, i) => { const q = V[(i + 1) % V.length]; nn[0] += p[1] * q[2] - p[2] * q[1]; nn[1] += p[2] * q[0] - p[0] * q[2]; nn[2] += p[0] * q[1] - p[1] * q[0]; });
        agree += Math.sign(nn[0] * n[0] + nn[1] * n[1] + nn[2] * n[2]);
        polys.push({ owner: a, normal: n, verts: ring, holes: [] });
      }
      if (cycles > 1) stats.splitFans++;
    }
    if (agree < 0) for (const P of polys) P.verts.reverse(); // face the + side
    stats.facelessOwners = [...planes.keys()].filter(a => !next.has(a)).length;
    return { verts, anchors, vertOwners, polys, patchStats: stats };
  }

  const api = { recoverSurface, triangulatePatches, PATCH_DEFAULTS, extendOwnFaces, mirroredSites, contourNeighbors, clipTangentPlanes, CLIP_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recover = api;
})(this);
