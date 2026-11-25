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
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Shapes;
  else root.Shapes = Shapes;
})(this);
