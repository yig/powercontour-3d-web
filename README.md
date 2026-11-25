# Power contour viewer

An interactive 3D viewer for the *power contour* of points sampling a signed distance field (SDF).

**Live:** https://yig.github.io/powercontour-3d-web/

Each sample point `p` with SDF value `d` becomes a weighted site: a sphere of radius `|d|`, signed by `d`. The viewer computes the power diagram of these sites, clipped to the box `[−1.5, 1.5]³`. The **power contour** is the set of faces between a positive cell and a negative cell, and it approximates the zero level set.

You can also add one **tangent point** per sample: the closest point on the surface, with weight 0 and the opposite sign. This pulls the contour much closer to the true surface. The sampled points and the tangent points can each be switched on or off, so you can also look at the diagram of the tangent points alone.

## Recovered surface

*Contract contour regions* (and its variant *Extend own faces*; see [RECOVERY.md](RECOVERY.md)) builds a polygon mesh with one face per sample, lying in its tangent plane. The power contour supplies the connectivity. The face between a sample and its own tangent point lies in that tangent plane. Every other contour face is given to the nearer of its two samples, and the resulting regions on the contour become the faces of the new mesh. Each vertex is where three or more tangent planes meet, so sharp edges and corners (the box, the two-sphere crease) come out sharp. Red outlines mark holes, where a region is not a disc. Set *Sphere scale* to about 0.1 for recovery: it shrinks each sample's sphere toward its tangent point, which leaves every own face exactly in its tangent plane but makes the other faces thin, so they collapse cleanly.

*Clip tangent planes* uses only the tangent points: it finds neighbors with the power diagram of mirrored pairs `t ± δn` (check *Mirrored pairs* to see that contour), then clips each tangent plane by its neighbors' half-spaces. Corners and edges come out with no feature detection: the face planes cut each other there, and tangent points on corners and edges (orange) get tiny faces. Curved creases can optionally be detected with thresholds (sliders). See `ARCHITECTURE.md`.

## Running

There is no build step and no network access needed. Open `index.html` directly in a browser. three.js is in `vendor/`. To update it, run `node vendor/update-three.mjs [version]`.

## Controls

Every control has a **?** button in the panel that shows the same explanation as below.

| Group | Control | Effect |
|---|---|---|
| Input | Shape | The surface: a sphere, a box, a torus, or the union of two spheres (which has a concave crease where they meet). Each has an exact SDF and closest point (`shapes.js`). |
| | Sampling | How sample points are placed in the box `[−1.5, 1.5]³`: uniform random, a jittered or regular grid, or uniform random keeping only points with `\|d\| < 0.1`. |
| | Points | Number of sample points. The power diagram costs O(n²): 1500 points take a couple of seconds. |
| | Seed | Random seed for the sampling. |
| | Sampled points | Put each sample into the power diagram: a site with weight `d²`, i.e. a sphere of radius `\|d\|` that touches the surface at its closest point, signed by `d`. |
| | Sphere scale | Moves each sample toward its tangent point, `p → t + s(p − t)`, and shrinks its sphere to radius `s\|d\|` so it stays tangent there. The face between a sample and its own tangent point stays exactly in the tangent plane for every `s`; only the other faces change, getting thinner as `s → 0`. About 0.1 is good for surface recovery. |
| | Tangent points | Add each sample's closest surface point as a site with weight 0 and the opposite sign. The face between a sample and its own tangent point lies exactly in the tangent plane. |
| | Mirrored pairs | For each tangent point `t` with normal `n`, add the pair `t + δn` (outside) and `t − δn` (inside), `δ = 0.001`. Their contour is each tangent plane clipped to `t`'s Voronoi cell, plus thin steps between neighbors. |
| Input spheres | Opacity | Opacity of the sample spheres (radius `√weight`). 0 hides them. |
| | Show centers | Dots at the site positions. Tangent points are smaller and lighter. |
| Power contour | Opacity | Opacity of the power contour: the faces between a `+` cell and a `−` cell. 0 hides it. |
| | Show edges | Outline the contour faces. |
| | Face color | Uniform gold, or color each face by the kinds of sites it separates, with a legend and counts. Green faces (a sample and its own tangent point) lie exactly in the tangent plane; the others are steps between them. |
| Recovered surface | Method | Build a surface whose faces lie in the tangent planes. *Contract contour regions*: give each other contour face to one of its two own faces, and intersect the tangent planes where regions meet. *Extend own faces*: extend each own face from its own boundary, without assigning the other faces. Both need sampled + tangent points only. *Clip tangent planes*: clip each tangent plane by its neighbors' planes (any sites). See [RECOVERY.md](RECOVERY.md). |
| | Dependent planes, log₁₀ | Planes count as dependent (e.g. coplanar faces of the box) when eigenvalues of `Σ n nᵀ` fall below `10^value` × the largest; the vertex then keeps its contour position in those directions. With the trust radius on, this only needs to catch exact degeneracies: −12 is numerical precision. Without it (trust at 10 = off), about −2 is needed to stop nearly dependent planes from sending vertices far away. |
| | Trust radius × spacing | A tangent plane is only accurate within about one sample spacing of its tangent point. A vertex may move at most this many spacings (the distance from its contour position to the farthest of its tangent points) away from its contour position: it is the exact intersection of its planes if that is near, else the nearest point on the line where the two best-determined planes meet, else on one plane. 2 keeps box corners exact and removes far-away vertices on curved shapes. 10 = off. |
| | Merge flipped junctions | *Extend own faces*: where four owners meet at nearly one point and their faces disagree about which diagonal is an edge, merge the junction into one vertex where all four planes meet. Off: such junctions leave cracks. |
| | Parallel (°) | *Clip tangent planes*: neighbors whose normals differ by less than this angle are split by their Voronoi bisector instead of by the line where their planes meet. |
| | Concave neighbors: union | *Clip*: across a concave crease a face must be above at least one plane from the other side, not all of them, so concave constraints are combined by union (overlapping pieces). |
| | Convex only if mutually below | *Clip*: a neighbor pair counts as convex only if each tangent point is below the other's plane; mixed pairs only join the union. |
| | Clip all faces by two-ring | *Clip*: clip every face by its neighbors' neighbors too. Removes outliers but over-clips smooth surfaces. |
| | Detect curved creases | *Clip*: detect points on curved creases with the thresholds below. Off by default: corners and edges between flat faces need no detection. |
| | Similar (°) | Crease detection: neighbors with normals within this angle count toward a patch's curvature `κ`. |
| | Turn × κr | Crease detection: a pair is a feature pair if its normals turn by more than this × `κr` plus the margin below (`r`: distance between the tangent points). |
| | Turn + (°) | Crease detection: extra angle added to the turn threshold above. |
| | On plane × κr² | Crease detection: a tangent point is on the feature if it is within this × `κr²` of the neighbor's plane. |
| | Feature points: clip by two-ring | *Clip*: clip detected feature points by their neighbors' neighbors too. |
| | Split points on one feature | *Clip*: split two points on the same feature (or exactly on each other's planes) by their Voronoi bisector, since their planes never separate them along the feature. |
| Reference | True surface | Opacity of the exact surface, for comparison. 0 hides it. |
| | Slice | Hide everything above the horizontal plane at *Slice z*, to look inside. |
| | Slice z | Height of the slice plane. |
| | Show bounding box | Outline of the domain `[−1.5, 1.5]³`. |

Red means `d > 0`, blue means `d < 0`, and the contour is gold. The recovered surface is blue-gray; with *Clip tangent planes*, faces of corner, edge and crease points are orange, and with the other methods red outlines mark holes. Drag to orbit, scroll to zoom, and right-drag to pan. The stats panel shows the number of sites, empty cells, contour faces, contour area, the recovered surface's faces and holes, and compute time.

## More

- [RECOVERY.md](RECOVERY.md): the structure of the contour (own faces and steps), the two ways to contract it to one face per tangent point, and the choice of sphere scale and dependent-plane threshold.
- [ARCHITECTURE.md](ARCHITECTURE.md): code structure, the math, and the clipping algorithm.
- [AGENTS.md](AGENTS.md): the original spec.
- Issues are tracked with [git-bug](https://github.com/git-bug/git-bug): `git bug bug`.
