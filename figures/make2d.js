// 2D illustrations for RECOVERY.md: `node figures/make2d.js` writes figures/*.svg.
// Everything is computed, in 2D: the power diagram of samples and tangent points of a curve with a
// concave crease (the union of two ellipses), its contour, and the contour-region contraction with
// trust-region vertex placement. In 2D a "plane" is a line and a "face" is a segment.
'use strict';
const fs = require('fs'), path = require('path');
const OUT = __dirname;

// ---------- Shape: union of two ellipses ----------
const ELL = [{ c: [-0.42, 0.0], a: 0.78, b: 0.52 }, { c: [0.5, 0.08], a: 0.5, b: 0.68 }];
const g = (e, p) => ((p[0] - e.c[0]) / e.a) ** 2 + ((p[1] - e.c[1]) / e.b) ** 2 - 1;
const inside = p => ELL.some(e => g(e, p) < 0);
// The boundary as polylines: each ellipse's arc outside the other, with its ends refined onto the crease.
const ARCS = ELL.map((e, i) => {
  const o = ELL[1 - i], N = 20000, at = u => [e.c[0] + e.a * Math.cos(u), e.c[1] + e.b * Math.sin(u)];
  const us = Array.from({ length: N }, (_, k) => 2 * Math.PI * k / N), out = us.map(u => g(o, at(u)) >= 0);
  const s = out.findIndex((v, k) => v && !out[(k + N - 1) % N]); // first kept parameter after the gap
  const crease = (u0, u1) => { for (let it = 0; it < 60; it++) { const m = (u0 + u1) / 2; (g(o, at(m)) >= 0) === (g(o, at(u0)) >= 0) ? u0 = m : u1 = m; } return at((u0 + u1) / 2); };
  const pts = [crease(us[s] - 2 * Math.PI / N, us[s])];
  let k = s; while (out[k % N]) { pts.push(at(us[k % N] + (k >= N ? 2 * Math.PI : 0))); k++; }
  pts.push(crease(us[(k - 1) % N], us[(k - 1) % N] + 2 * Math.PI / N));
  return pts;
});
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function closest(p) {
  let best = null, bd = Infinity;
  for (const arc of ARCS) for (let k = 0; k + 1 < arc.length; k++) {
    const a = arc[k], ab = sub(arc[k + 1], a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    const q = [a[0] + t * ab[0], a[1] + t * ab[1]], d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
const sdf = p => (inside(p) ? -1 : 1) * dist(p, closest(p));

// ---------- Samples ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const BOX = [[-1.6, -1.25], [1.6, 1.25]];
function samples(n, seed) {
  const r = mulberry32(seed), pts = [];
  while (pts.length < n) { const p = [BOX[0][0] + (BOX[1][0] - BOX[0][0]) * r(), BOX[0][1] + (BOX[1][1] - BOX[0][1]) * r()]; if (Math.abs(sdf(p)) > 0.01) pts.push(p); }
  return pts.map(p => { const d = sdf(p), t = closest(p); return { p, d, t, n: [(p[0] - t[0]) / d, (p[1] - t[1]) / d] }; });
}

// ---------- 2D power diagram by half-plane clipping; each edge remembers its neighbor site ----------
function powerDiagram(sites) { // sites: {x, w}
  const B = [[BOX[0][0], BOX[0][1]], [BOX[1][0], BOX[0][1]], [BOX[1][0], BOX[1][1]], [BOX[0][0], BOX[1][1]]];
  return sites.map((si, i) => {
    let poly = B.map(v => ({ v, nb: -1 })); // nb: neighbor across the edge from this vertex to the next
    sites.forEach((sj, j) => {
      if (j === i || !poly.length) return;
      const a = [2 * (sj.x[0] - si.x[0]), 2 * (sj.x[1] - si.x[1])], c = dot(sj.x, sj.x) - dot(si.x, si.x) - sj.w + si.w;
      const f = v => dot(a, v) - c, out = [];
      poly.forEach((P, k) => {
        const Q = poly[(k + 1) % poly.length], fp = f(P.v), fq = f(Q.v);
        if (fp <= 0) out.push(P);
        if ((fp <= 0) !== (fq <= 0)) {
          const t = fp / (fp - fq), x = [P.v[0] + t * (Q.v[0] - P.v[0]), P.v[1] + t * (Q.v[1] - P.v[1])];
          // Leaving: from x the boundary follows the bisector with j. Entering: x -> Q is the rest of P's edge.
          out.push({ v: x, nb: fp <= 0 ? j : P.nb });
        }
      });
      poly = out;
    });
    return poly;
  });
}

// ---------- Build the setup for a sphere scale s ----------
function setup(S, s) {
  const sites = [];
  S.forEach((q, k) => sites.push({ x: [q.t[0] + s * (q.p[0] - q.t[0]), q.t[1] + s * (q.p[1] - q.t[1])], w: (s * q.d) ** 2, sign: Math.sign(q.d), owner: k, tan: false }));
  S.forEach((q, k) => sites.push({ x: q.t, w: 0, sign: -Math.sign(q.d), owner: k, tan: true }));
  const cells = powerDiagram(sites);
  const edges = []; // contour edges, from the + side
  cells.forEach((poly, i) => {
    if (sites[i].sign < 0) return;
    poly.forEach((P, k) => {
      const j = P.nb; if (j < 0 || sites[j].sign > 0) return;
      const a = P.v, b = poly[(k + 1) % poly.length].v; if (dist(a, b) < 1e-12) return;
      const own = sites[i].owner === sites[j].owner;
      edges.push({ a, b, i, j, k, own, owners: [sites[i].owner, sites[j].owner] });
    });
  });
  return { sites, cells, edges };
}

// ---------- Contract contour regions, in 2D ----------
function eig2(A) { // symmetric 2x2
  const [[a, b], [, c]] = A, m = (a + c) / 2, r = Math.hypot((a - c) / 2, b), l1 = m + r, l2 = m - r;
  const v1 = Math.abs(b) > 1e-300 ? [l1 - c, b] : (a >= c ? [1, 0] : [0, 1]), n1 = Math.hypot(...v1), u1 = [v1[0] / n1, v1[1] / n1];
  return [[l1, u1], [l2, [-u1[1], u1[0]]]];
}
function place(m, owners, S, tau, trust) { // the 2D qefTruncated with the trust region
  const A = [[0, 0], [0, 0]], r = [0, 0];
  for (const o of owners) { const { n, t } = S[o], nt = dot(n, t); for (let i = 0; i < 2; i++) { r[i] += n[i] * nt; for (let j = 0; j < 2; j++) A[i][j] += n[i] * n[j]; } }
  const rho = trust * Math.max(...owners.map(o => dist(m, S[o].t))), E = eig2(A), lmax = E[0][0];
  const res = [r[0] - dot(A[0], m), r[1] - dot(A[1], m)], x = m.slice(); let d2 = 0, kept = 0;
  for (const [l, u] of E) {
    if (l <= tau * lmax) break;
    const c = dot(u, res) / l; if (d2 + c * c > rho * rho) break;
    d2 += c * c; x[0] += c * u[0]; x[1] += c * u[1]; kept++;
  }
  return { x, kept, rho };
}
function contract(S, edges, trust = 2, tau = 1e-12) {
  const key = v => `${v[0].toFixed(9)},${v[1].toFixed(9)}`;
  const label = e => e.own ? e.owners[0] : (dist(mid(e), S[e.owners[0]].t) <= dist(mid(e), S[e.owners[1]].t) ? e.owners[0] : e.owners[1]);
  const mid = e => [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  const from = new Map(); edges.forEach(e => from.set(key(e.a), e));
  const used = new Set(), loops = [];
  for (const e0 of edges) {
    if (used.has(e0)) continue;
    const loop = []; let e = e0;
    while (e && !used.has(e)) { used.add(e); loop.push(e); e = from.get(key(e.b)); }
    loops.push(loop);
  }
  const polys = [];
  for (const loop of loops) {
    const L = loop.map(label), n = loop.length, start = L.findIndex((l, k) => l !== L[(k + n - 1) % n]);
    if (start < 0) { polys.push({ loop, labels: L, verts: [] }); continue; } // one region only: no vertices
    const verts = [];
    for (let k = 0; k < n; k++) {
      const kk = (start + k) % n, prev = L[(kk + n - 1) % n];
      if (L[kk] !== prev) verts.push({ m: loop[kk].a, owners: [prev, L[kk]], ...place(loop[kk].a, [prev, L[kk]], S, tau, trust) });
    }
    polys.push({ loop, labels: L, verts });
  }
  return polys;
}

// ---------- Extend own faces, in 2D ----------
// Each own face (a segment of owner a) ends at a contour vertex where a third cell meets a's two. Its
// owner b names the neighbor, and the face is extended along its line to where it meets b's line: the
// vertex keyed by the pair {a, b}. Shared if b's face also names a; otherwise each end is open (a crack).
function extendOwn(S, st, trust = 2, tau = 1e-12) {
  const ends = new Map(), faces = []; // pair key -> [{owner, m}]
  for (const e of st.edges) {
    if (!e.own) continue;
    const poly = st.cells[e.i], n = poly.length, a = e.owners[0];
    const nb = [poly[(e.k + n - 1) % n].nb, poly[(e.k + 1) % n].nb]; // the third cell at each end
    const f = { owner: a, keys: [] };
    [e.a, e.b].forEach((m, t) => {
      const b = nb[t] < 0 ? -1 : st.sites[nb[t]].owner;
      if (b < 0 || b === a) { f.keys.push(null); return; }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ owner: a, m }); f.keys.push(key);
    });
    faces.push(f);
  }
  const verts = new Map();
  for (const [key, list] of ends) {
    const owners = key.split(',').map(Number), m = [0, 1].map(c => list.reduce((s, q) => s + q.m[c], 0) / list.length);
    verts.set(key, { ...place(m, owners, S, tau, trust), shared: new Set(list.map(q => q.owner)).size === 2 });
  }
  return { faces: faces.filter(f => f.keys.every(k => k)).map(f => ({ owner: f.owner, ends: f.keys.map(k => verts.get(k)) })), verts: [...verts.values()] };
}

// The chain rule: along each contour loop, delete the steps between consecutive own faces a and c,
// and join a and c at P_a ∩ P_c, anchored at the middle of the deleted chain. Global, so symmetric.
function extendChain(S, st, trust = 2, tau = 1e-12) {
  const key = v => `${v[0].toFixed(9)},${v[1].toFixed(9)}`, from = new Map();
  st.edges.forEach(e => from.set(key(e.a), e));
  const used = new Set(), faces = [], verts = [];
  for (const e0 of st.edges) {
    if (used.has(e0)) continue;
    const loop = []; let e = e0;
    while (e && !used.has(e)) { used.add(e); loop.push(e); e = from.get(key(e.b)); }
    const own = loop.map((e, k) => e.own ? k : -1).filter(k => k >= 0);
    if (own.length < 2) continue; // a loop with fewer than two tangent points: nothing to join
    const vs = own.map((k, i) => { // the vertex after own face k: join it to the next own face
      const k2 = own[(i + 1) % own.length], n = loop.length, chain = [];
      for (let j = (k + 1) % n; j !== k2; j = (j + 1) % n) chain.push(loop[j]);
      const pts = chain.length ? chain.flatMap(c => [c.a, c.b]) : [loop[k].b], m = [0, 1].map(c => pts.reduce((s, q) => s + q[c], 0) / pts.length);
      return { ...place(m, [loop[k].owners[0], loop[k2].owners[0]], S, tau, trust), shared: true };
    });
    own.forEach((k, i) => faces.push({ owner: loop[k].owners[0], ends: [vs[(i + own.length - 1) % own.length], vs[i]] }));
    verts.push(...vs);
  }
  return { faces, verts };
}

// ---------- SVG ----------
const PX = 170;
function svg(view, body, w) {
  const [[x0, y0], [x1, y1]] = view, W = w || Math.round((x1 - x0) * PX), sc = W / (x1 - x0), H = Math.round((y1 - y0) * sc);
  return { W, H, sc, X: x => ((x - x0) * sc).toFixed(2), Y: y => ((y1 - y) * sc).toFixed(2), wrap: inner => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="13">\n<rect width="${W}" height="${H}" fill="white"/>\n<defs><clipPath id="c"><rect width="${W}" height="${H}"/></clipPath>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>\n<g clip-path="url(#c)">\n${inner}\n</g>\n</svg>\n` };
}
const COL = { plus: '#f6d3cd', minus: '#cfdcf5', plusT: '#fbeae6', minusT: '#e9eff9', own: '#d9a400', step: '#c0392b', curve: '#555', samp: { 1: '#d0503f', [-1]: '#3d6fc7' } };
function pathOf(c, pts, close) { return 'M' + pts.map(v => `${c.X(v[0])},${c.Y(v[1])}`).join(' L') + (close ? ' Z' : ''); }
function drawCurve(c, extra = '') { return ARCS.map(a => `<path d="${pathOf(c, a.filter((_, k) => k % 40 === 0 || k === a.length - 1))}" fill="none" stroke="${COL.curve}" stroke-width="1.3" stroke-dasharray="5 3" ${extra}/>`).join('\n'); }
function drawDiagram(c, st, opts = {}) {
  const out = [];
  st.cells.forEach((poly, i) => {
    if (!poly.length) return;
    const s = st.sites[i], fill = s.sign > 0 ? (s.tan ? COL.plusT : COL.plus) : (s.tan ? COL.minusT : COL.minus);
    out.push(`<path d="${pathOf(c, poly.map(P => P.v), true)}" fill="${fill}" stroke="#9aa" stroke-width="0.5"/>`);
  });
  if (opts.curve !== false) out.push(drawCurve(c));
  if (opts.contour !== false) for (const e of st.edges) out.push(`<line x1="${c.X(e.a[0])}" y1="${c.Y(e.a[1])}" x2="${c.X(e.b[0])}" y2="${c.Y(e.b[1])}" stroke="${e.own ? COL.own : COL.step}" stroke-width="${e.own ? 3.2 : 2}" stroke-linecap="round"/>`);
  if (opts.sites !== false) st.sites.forEach(s => out.push(s.tan
    ? `<circle cx="${c.X(s.x[0])}" cy="${c.Y(s.x[1])}" r="2.2" fill="#222"/>`
    : `<circle cx="${c.X(s.x[0])}" cy="${c.Y(s.x[1])}" r="3" fill="${COL.samp[s.sign]}" stroke="white" stroke-width="0.8"/>`));
  return out.join('\n');
}
function legend(c, items, x = 10, y = 18) {
  return items.map(([kind, color, text], k) => {
    const yy = y + k * 19, sw = kind === 'line' ? `<line x1="${x}" y1="${yy - 4}" x2="${x + 22}" y2="${yy - 4}" stroke="${color}" stroke-width="3"/>`
      : kind === 'dash' ? `<line x1="${x}" y1="${yy - 4}" x2="${x + 22}" y2="${yy - 4}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 3"/>`
      : kind === 'box' ? `<rect x="${x + 4}" y="${yy - 11}" width="14" height="12" fill="${color}" stroke="#9aa" stroke-width="0.5"/>`
      : `<circle cx="${x + 11}" cy="${yy - 4}" r="${kind === 'dot' ? 2.5 : 3.5}" fill="${color}"/>`;
    return `${sw}<text x="${x + 28}" y="${yy}" fill="#222">${text}</text>`;
  }).join('\n');
}
const panel = (c, text) => `<rect x="0" y="0" width="${c.W}" height="24" fill="white" fill-opacity="0.85"/><text x="${c.W / 2}" y="17" text-anchor="middle" font-weight="bold" fill="#222">${text}</text>`;
function hstack(svgs, gap = 12) { // place SVG strings side by side
  const dims = svgs.map(s => s.match(/width="(\d+)" height="(\d+)"/).slice(1).map(Number));
  const W = dims.reduce((a, d) => a + d[0], 0) + gap * (svgs.length - 1), H = Math.max(...dims.map(d => d[1]));
  let x = 0, body = '';
  svgs.forEach((s, k) => {
    const inner = s.slice(s.indexOf('>') + 1, s.lastIndexOf('</svg>')).replace(/id="(c|arr)"/g, `id="$1${k}"`).replace(/url\(#(c|arr)\)/g, `url(#$1${k})`);
    body += `<g transform="translate(${x},0)">${inner}</g>\n`; x += dims[k][0] + gap;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="13"><rect width="${W}" height="${H}" fill="white"/>\n${body}</svg>\n`;
}
const write = (name, s) => { fs.writeFileSync(path.join(OUT, name), s); console.log('wrote', name); };

// ---------- Figures ----------
const S = samples(70, 3);
const full = [[-1.45, -1.05], [1.45, 1.1]];

// 1. Setup: one sample, its tangent point, its circle and the bisector, zoomed out of the real diagram.
{
  const st = setup(S, 1);
  // The outside sample whose super cell (its two cells) has the largest area, with its circle in the box.
  const area = poly => poly.reduce((a, P, k) => { const Q = poly[(k + 1) % poly.length].v; return a + (P.v[0] * Q[1] - Q[0] * P.v[1]) / 2; }, 0);
  const sc = S.map((q, o) => st.cells.reduce((a, poly, i) => a + (st.sites[i].owner === o ? area(poly) : 0), 0));
  const closed = o => st.cells.every((poly, i) => st.sites[i].owner !== o || poly.every(P => P.nb >= 0));
  const fits = (q, o) => q.d > 0 && closed(o) && Math.abs(q.p[1]) + q.d < BOX[1][1] - 0.05 && Math.abs(q.p[0]) + q.d < BOX[1][0] - 0.05;
  const k = S.reduce((b, q, i) => fits(q, i) && (b < 0 || sc[i] > sc[b]) ? i : b, -1), q = S[k];
  const pts = st.cells.flatMap((poly, i) => st.sites[i].owner === k ? poly.map(P => P.v) : []).concat([[q.p[0] - q.d, q.p[1] - q.d], [q.p[0] + q.d, q.p[1] + q.d]]);
  const lo = [0, 1].map(a => Math.min(...pts.map(v => v[a])) - 0.12), hi = [0, 1].map(a => Math.max(...pts.map(v => v[a])) + 0.12);
  const view = [lo, hi], c = svg(view, '', 560);
  const tan = [-q.n[1], q.n[0]], L = 3, P0 = [q.t[0] - L * tan[0], q.t[1] - L * tan[1]], P1 = [q.t[0] + L * tan[0], q.t[1] + L * tan[1]];
  const body = [
    drawDiagram(c, st, { contour: false }),
    // the two cells of owner k (its super cell) outlined
    ...st.cells.map((poly, i) => st.sites[i].owner === k ? `<path d="${pathOf(c, poly.map(P => P.v), true)}" fill="none" stroke="#222" stroke-width="1.6"/>` : ''),
    `<line x1="${c.X(P0[0])}" y1="${c.Y(P0[1])}" x2="${c.X(P1[0])}" y2="${c.Y(P1[1])}" stroke="${COL.own}" stroke-width="1" stroke-dasharray="2 3"/>`,
    ...st.edges.filter(e => e.own && e.owners[0] === k).map(e => `<line x1="${c.X(e.a[0])}" y1="${c.Y(e.a[1])}" x2="${c.X(e.b[0])}" y2="${c.Y(e.b[1])}" stroke="${COL.own}" stroke-width="4" stroke-linecap="round"/>`),
    `<circle cx="${c.X(q.p[0])}" cy="${c.Y(q.p[1])}" r="${(q.d * c.sc).toFixed(2)}" fill="none" stroke="${COL.samp[1]}" stroke-width="1.3"/>`,
    `<line x1="${c.X(q.t[0])}" y1="${c.Y(q.t[1])}" x2="${c.X(q.p[0])}" y2="${c.Y(q.p[1])}" stroke="#333" stroke-width="1.2" marker-end="url(#arr)"/>`,
    `<circle cx="${c.X(q.p[0])}" cy="${c.Y(q.p[1])}" r="4.5" fill="${COL.samp[1]}" stroke="white"/>`,
    `<circle cx="${c.X(q.t[0])}" cy="${c.Y(q.t[1])}" r="4" fill="#222"/>`,
    `<text x="${+c.X(q.p[0]) + 8}" y="${+c.Y(q.p[1]) - 6}" fill="#222">p (weight d², sign +)</text>`,
    `<text x="${+c.X(q.t[0]) + 8}" y="${+c.Y(q.t[1]) + 16}" fill="#222">t (weight 0, sign −)</text>`,
    `<text x="${+c.X((q.p[0] + q.t[0]) / 2) + 6}" y="${c.Y((q.p[1] + q.t[1]) / 2)}" fill="#222">n</text>`,
    `<rect x="4" y="${c.H - 66}" width="300" height="62" fill="white" fill-opacity="0.85"/>` + legend(c, [['line', COL.own, 'own face F = P ∩ C (in the tangent line P)'], ['line', '#222', 'super cell C: the cells of p and t'], ['dash', COL.curve, 'true surface']], 10, c.H - 50),
  ];
  write('fig-setup.svg', c.wrap(body.join('\n')));
}

// 2. Structure: the whole diagram, own faces vs steps.
{
  const st = setup(S, 1), c = svg(full, '', 760);
  // Inset: zoom on the longest step away from the creases (the crease points are the arcs' ends).
  const creases = ARCS.flatMap(a => [a[0], a[a.length - 1]]), mid = e => [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  const e0 = st.edges.filter(e => !e.own && Math.min(...creases.map(q => dist(q, mid(e)))) > 0.3).sort((e, f) => dist(f.a, f.b) - dist(e.a, e.b))[0];
  const zc = mid(e0), zr = 3 * dist(e0.a, e0.b), zv = [[zc[0] - zr, zc[1] - zr], [zc[0] + zr, zc[1] + zr]], z = svg(zv, '', 250);
  const inset = z.wrap(drawDiagram(z, st) + panel(z, 'zoom ×' + Math.round(z.sc / c.sc))).replace(/id="(c|arr)"/g, 'id="$1z"').replace(/url\(#(c|arr)\)/g, 'url(#$1z)');
  const zbox = `<rect x="${c.X(zv[0][0])}" y="${c.Y(zv[1][1])}" width="${(2 * zr * c.sc).toFixed(1)}" height="${(2 * zr * c.sc).toFixed(1)}" fill="none" stroke="#222" stroke-width="1.2"/>`;
  const ix = c.W - 256, iy = c.H - 256;
  const insetG = `<g transform="translate(${ix},${iy})">${inset.slice(inset.indexOf('>') + 1, inset.lastIndexOf('</svg>'))}<rect width="250" height="250" fill="none" stroke="#222" stroke-width="1.5"/></g>`;
  const legBg = `<rect x="4" y="2" width="250" height="160" fill="white" fill-opacity="0.85"/>`;
  write('fig-structure.svg', c.wrap(drawDiagram(c, st) + '\n' + zbox + insetG + legBg + legend(c, [
    ['line', COL.own, 'own face: in a tangent line'], ['line', COL.step, 'step: wall between two super cells'],
    ['dot', '#222', 'tangent point'], ['circ', COL.samp[1], 'sample, d &gt; 0'], ['circ', COL.samp[-1], 'sample, d &lt; 0'],
    ['box', COL.plus, '+ cell'], ['box', COL.minus, '− cell'], ['dash', COL.curve, 'true surface']])));
  const own = st.edges.filter(e => e.own).length; console.log(`  s=1: ${own} own faces of ${S.length}, ${st.edges.length - own} steps`);
}

// 3. Sphere scale: s = 1 vs s = 0.1 (same own faces, thinner steps).
{
  const view = [[-1.25, -0.85], [1.15, 0.95]], parts = [1, 0.1].map(s => {
    const st = setup(S, s), c = svg(view, '', 470);
    return c.wrap(drawDiagram(c, st) + '\n' + panel(c, `sphere scale s = ${s}`));
  });
  write('fig-sphere-scale.svg', hstack(parts));
}

// 4. Contract contour regions: regions colored per owner, then the recovered polygon.
{
  const view = [[-1.25, -0.85], [1.15, 0.95]], st = setup(S, 0.1), polys = contract(S, st.edges);
  const hue = o => `hsl(${(o * 137.508) % 360}, 70%, 45%)`;
  const c1 = svg(view, '', 470), c2 = svg(view, '', 470);
  const a = [drawCurve(c1),
    ...st.edges.map(e => { const p = polys.find(P => P.loop.includes(e)), l = p.labels[p.loop.indexOf(e)];
      return `<line x1="${c1.X(e.a[0])}" y1="${c1.Y(e.a[1])}" x2="${c1.X(e.b[0])}" y2="${c1.Y(e.b[1])}" stroke="${hue(l)}" stroke-width="${e.own ? 4 : 2}" stroke-linecap="round"/>`; }),
    ...S.map((q, o) => `<circle cx="${c1.X(q.t[0])}" cy="${c1.Y(q.t[1])}" r="2.6" fill="${hue(o)}" stroke="#222" stroke-width="0.6"/>`),
    panel(c1, '1. one region per tangent point'),
  ];
  const b = [drawCurve(c2),
    ...st.edges.map(e => `<line x1="${c2.X(e.a[0])}" y1="${c2.Y(e.a[1])}" x2="${c2.X(e.b[0])}" y2="${c2.Y(e.b[1])}" stroke="#bbb" stroke-width="1.5"/>`),
    ...polys.filter(P => P.verts.length).map(P => `<path d="${pathOf(c2, P.verts.map(v => v.x), true)}" fill="none" stroke="#1a7f4b" stroke-width="2.2" stroke-linejoin="round"/>`),
    ...polys.flatMap(P => P.verts.map(v => `<circle cx="${c2.X(v.x[0])}" cy="${c2.Y(v.x[1])}" r="2.6" fill="${v.kept === 2 ? '#1a7f4b' : '#e67e22'}"/>`)),
    ...S.map(q => `<circle cx="${c2.X(q.t[0])}" cy="${c2.Y(q.t[1])}" r="1.8" fill="#222"/>`),
    panel(c2, '2. vertices where tangent lines meet'),
    legend(c2, [['line', '#bbb', 'contour (s = 0.1)'], ['line', '#1a7f4b', 'recovered'], ['circ', '#1a7f4b', 'exact intersection'], ...(polys.some(P => P.verts.some(v => v.kept < 2)) ? [['circ', '#e67e22', 'limited by trust region']] : [])], 10, c2.H - 62),
  ];
  write('fig-contract.svg', hstack([c1.wrap(a.join('\n')), c2.wrap(b.join('\n'))]));
  const vs = polys.flatMap(P => P.verts); console.log(`  contract: ${polys.length} loops, ${vs.length} vertices, ${vs.filter(v => v.kept < 2).length} limited, max |sdf| ${Math.max(...vs.map(v => Math.abs(sdf(v.x)))).toFixed(4)}`);
}

// 4b. Extend own faces, s = 0.1: neighbors from the third cell at each end (as extendOwnFaces in 3D)
//     vs. from the next own face along the contour (the chain rule).
{
  const view = [[-1.25, -0.85], [1.15, 0.95]], st = setup(S, 0.1);
  const runs = [['local rule (third cell at each end)', extendOwn(S, st)], ['chain rule (next own face along the contour)', extendChain(S, st)]].map(([title, r]) => ({ title, sv: 0.1, st, r }));
  const anyLimited = runs.some(({ r }) => r.verts.some(v => v.shared && v.kept < 2));
  const parts = runs.map(({ title, sv, st, r }) => {
    const c = svg(view, '', 470);
    const open = r.verts.filter(v => !v.shared).length, err = Math.max(...r.verts.map(v => Math.abs(sdf(v.x))));
    console.log(`  extend ${title.split(' ')[0]}: ${r.faces.length} faces, ${r.verts.length} vertices, ${open} open ends, max |sdf| ${err.toFixed(4)}`);
    const body = [drawCurve(c),
      ...st.edges.map(e => `<line x1="${c.X(e.a[0])}" y1="${c.Y(e.a[1])}" x2="${c.X(e.b[0])}" y2="${c.Y(e.b[1])}" stroke="#bbb" stroke-width="1.5"/>`),
      ...r.faces.map(f => `<line x1="${c.X(f.ends[0].x[0])}" y1="${c.Y(f.ends[0].x[1])}" x2="${c.X(f.ends[1].x[0])}" y2="${c.Y(f.ends[1].x[1])}" stroke="#1a7f4b" stroke-width="2.2" stroke-linecap="round"/>`),
      ...r.verts.map(v => `<circle cx="${c.X(v.x[0])}" cy="${c.Y(v.x[1])}" r="${v.shared ? 2.6 : 4}" fill="${!v.shared ? COL.step : v.kept === 2 ? '#1a7f4b' : '#e67e22'}"/>`),
      ...S.map(q => `<circle cx="${c.X(q.t[0])}" cy="${c.Y(q.t[1])}" r="1.8" fill="#222"/>`),
      panel(c, `${title}: ${open} open end${open === 1 ? '' : 's'}`)];
    if (title.startsWith('chain')) body.push(legend(c, [['line', '#bbb', 'contour'], ['line', '#1a7f4b', 'extended own faces'], ['circ', '#1a7f4b', 'shared vertex'],
      ...(anyLimited ? [['circ', '#e67e22', 'limited by trust region']] : []), ['circ', COL.step, 'open end: seen by one face only']], 70, 120));
    return c.wrap(body.join('\n'));
  });
  write('fig-extend.svg', hstack(parts));
}

// 5. Far intersections: near an inflection (zero curvature) two neighboring tangent lines meet far away.
{
  const cu = x => 0.45 * x ** 3, du = x => 1.35 * x ** 2, view = [[-1.0, -0.95], [2.9, 1.15]], c = svg(view, '', 760);
  const T = [-0.42, 0.47].map(x => ({ t: [x, cu(x)], n: (([a, b]) => { const l = Math.hypot(a, b); return [a / l, b / l]; })([-du(x), 1]) }));
  const m = [0.03, 0.09], Sx = T.map(q => ({ ...q })), far = place(m, [0, 1], Sx, 1e-12, Infinity), lim = place(m, [0, 1], Sx, 1e-12, 2);
  const curve = Array.from({ length: 200 }, (_, k) => { const x = -1 + 2.2 * k / 199; return [x, cu(x)]; });
  const line = q => { const d = [-q.n[1], q.n[0]]; return [[q.t[0] - 4 * d[0], q.t[1] - 4 * d[1]], [q.t[0] + 4 * d[0], q.t[1] + 4 * d[1]]]; };
  const body = [
    `<path d="${pathOf(c, curve)}" fill="none" stroke="${COL.curve}" stroke-width="1.5" stroke-dasharray="5 3"/>`,
    ...T.map(q => { const [a, b] = line(q); return `<line x1="${c.X(a[0])}" y1="${c.Y(a[1])}" x2="${c.X(b[0])}" y2="${c.Y(b[1])}" stroke="${COL.own}" stroke-width="1.6"/>`; }),
    `<circle cx="${c.X(m[0])}" cy="${c.Y(m[1])}" r="${(lim.rho * c.sc).toFixed(1)}" fill="#1a7f4b" fill-opacity="0.07" stroke="#1a7f4b" stroke-dasharray="4 3"/>`,
    ...T.map(q => `<circle cx="${c.X(q.t[0])}" cy="${c.Y(q.t[1])}" r="4" fill="#222"/>`),
    `<circle cx="${c.X(m[0])}" cy="${c.Y(m[1])}" r="4" fill="#888"/><text x="${+c.X(m[0]) - 8}" y="${+c.Y(m[1]) - 10}" fill="#222" text-anchor="end">contour vertex m</text>`,
    `<circle cx="${c.X(far.x[0])}" cy="${c.Y(far.x[1])}" r="5" fill="${COL.step}"/><text x="${+c.X(far.x[0]) - 8}" y="${+c.Y(far.x[1]) - 10}" fill="${COL.step}" text-anchor="end">exact intersection: valid, but far</text>`,
    `<circle cx="${c.X(lim.x[0])}" cy="${c.Y(lim.x[1])}" r="5" fill="#e67e22"/><text x="${+c.X(lim.x[0]) + 10}" y="${+c.Y(lim.x[1]) + 20}" fill="#e67e22">placed vertex: moved along the best-determined direction only</text>`,
    `<text x="${c.X(m[0])}" y="${+c.Y(m[1] + lim.rho) + 18}" fill="#1a7f4b" text-anchor="middle">trust region: 2 × distance to the farther tangent point</text>`,
    `<text x="${c.X(0.75)}" y="${c.Y(0.45)}" fill="${COL.curve}">surface with an inflection (zero curvature)</text>`,
  ];
  write('fig-far-intersection.svg', c.wrap(body.join('\n')));
  console.log(`  far: intersection at ${far.x.map(v => v.toFixed(2))}, ${dist(far.x, m).toFixed(2)} from m; trust radius ${lim.rho.toFixed(2)}`);
}
