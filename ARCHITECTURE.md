# Architecture

A static web page that shows the 3D *power contour* of points sampling a signed distance field (SDF).
There is no build step and no network access needed: open `index.html` from disk.
Everything is loaded as classic `<script>` tags, because browsers refuse to load ES modules from `file://` pages.

## Files

| File | Role |
|---|---|
| `powerdiagram.js` | Pure geometry: the 3D power diagram. No three.js. Runs in the browser (global `PowerDiagram`) and in Node (`require`). |
| `figures/` | Illustrations for `RECOVERY.md`. `make2d.js` (Node) computes the 2D analog — a 2D power diagram of samples and tangent points on a union of two ellipses, contour regions, trust-region placement — and writes SVGs. `shoot3d.sh` screenshots the viewer in headless Chrome, with the controls set through a hook injected into a temporary copy of `index.html`. |
| `shapes.js` | The test shapes: exact `sdf(p)` and analytic `closest(p)`. No three.js. Browser global `Shapes`, Node `require`. `index.html` adds the overlay meshes. `Shapes.fromOBJ(text, size)` makes a shape from a triangle mesh: OBJ parsing with vertex welding, normalization to [−size, size], a median-split BVH for the exact closest point (Ericson's point–triangle test), and the sign from the angle-weighted pseudonormal of the closest face, edge or vertex (Bærentzen & Aanæs 2005). It also returns `positions` and `triangles` for the overlay. |
| `recover.js` | Pure geometry: recovers a surface by intersecting tangent planes, using the power contour's connectivity. No three.js. Browser global `Recover`, Node `require`. |
| `index.html` | UI and rendering: SDFs, sampling, building sites, three.js scene, controls. All code is in one inline `<script type="module">`, which uses the global `THREE`. |
| `vendor/three.js`, `vendor/OrbitControls.js` | three.js r170, converted from its ES modules into classic scripts that define `window.THREE` and `THREE.OrbitControls`. Generated; do not edit. |
| `vendor/update-three.mjs` | Regenerates the files above from jsdelivr: `node vendor/update-three.mjs [version]`. It stops with an error if a three.js version no longer has the single-file, import-free form it expects. |
| `RECOVERY.md` | The structure of the contour of samples plus tangent points, the two contraction methods, and the choice of sphere scale and `tau`. |
| `AGENTS.md` | The original spec. |

## Math

- Each site `i` has a position `p_i`, a weight `w_i` and a sign `s_i ∈ {+1, −1}`.
- The power distance is `pow_i(x) = |x − p_i|² − w_i`. The cell of `i` is where `pow_i` is the smallest.
- **Input sites** ("Sampled points", on by default) are sample points `p` with SDF value `d`. They get `w = d²`, so each is a sphere of radius `|d|`, and sign `s = sign(d)` (zero counts as +).
- **Tangent sites** ("Tangent points", off by default) are one per sample point with `d ≠ 0`, computed whether or not the input sites are included. Each sits at the sample's closest surface point `t = closest(p)` (analytic, `shapes.js`); its normal is `(p − t)/d`, the SDF gradient. It gets `w = 0` and the opposite sign, `−sign(d)`. A tangent site lies on its own sample's sphere (power 0 for both) and, for an exact SDF, outside every other sphere. So when both kinds are on, tangent cells sit between almost all `+` and `−` input cells. A face between a sample and its **own** tangent site contains that tangent site. A face between a sample and **another** sample's tangent site, or between two tangent sites, is only a wall of the tangent cell and is usually far from the tangent point. Torus, 300 random samples: 26 sample–sample, 300 own, 1364 other, 19 tangent–tangent faces.
- The **power contour** is every cell face shared by a `+` cell and a `−` cell. Faces on the bounding box are not part of it.

## Power diagram (`powerdiagram.js`)

`computePowerDiagram(sites, weights, lo, hi)` builds each cell on its own:

1. Start from the bounding box `[lo, hi]` as a convex polyhedron: a list of faces `{verts, label}`, where box faces have `label = −1`.
2. Clip against the half-space `2(p_j − p_i)·x ≤ |p_j|² − |p_i|² + w_i − w_j` for every other site `j`. The new face gets `label = j`.
   - Sites are processed in order of increasing `|p_j − p_i|² − w_j`, so the cell shrinks early.
   - `clip` returns the cell unchanged when every vertex is inside. This cheap test rejects most planes.
   - A cell that ends up empty (common in power diagrams) returns `[]`.
   - Sites at the same position: the larger weight wins; ties go to the lower index.
3. Drop faces with near-zero area.

`clip` runs Sutherland–Hodgman on each face. It closes the hole with a cap polygon: the crossing points, de-duplicated and sorted by angle around their centroid in the plane. The tolerances are an absolute `1e-10` (inside/outside) and `1e-9` (merging points), chosen for a domain of size about 1.

Cost: O(n²) plane tests overall, which takes about 0.3 s for 1200 sites in Node. Each face is stored in both of its cells, without shared vertices.

## Surface recovery (`recover.js`)

See also `RECOVERY.md`, which explains the structure and the contraction methods in more depth, with experiments.

### Structure: one face per tangent point, plus steps

- **Super cells.** Sample `a` and its tangent point `t_a` together occupy a *super cell* `C_a` (the union of their two power cells). Inside `C_a` the boundary between the two cells is where their powers are equal, the tangent plane `P_a`, so the own face is exactly `F_a = P_a ∩ C_a`. Every other contour face lies on a wall between two super cells: a *step*, where the neighboring planes do not meet on the wall. Own faces never share an edge with each other (a corner of `F_a` has two cells of `a` and one each of two other owners), except in degenerate cases such as a sphere, where neighboring tangent planes meet exactly on the bisector.
- **Eliminating the steps** means extending every own face in its plane until it meets its neighbors' planes. In the regular (dual) triangulation this is collapsing the edge between each sample and its tangent point; the result is a valid surface where the collapses satisfy the link condition, which fat steps (from big sample spheres) violate.
- **Sphere scale `s`** ("Sphere scale" slider). Moving each sample toward its tangent point, `p(s) = t + s(p − t)` with weight `(s d)²`, keeps its sphere tangent at `t`, so the own face stays exactly in `P_a` for every `s`: only the steps change. As `s → 0` the super cells become the Voronoi cells of the tangent points and the steps become thin. The data (`t_a`, `n_a`, signs) is unchanged. Torus, 1500 uniform samples, owner pairs not at exactly 2 collapsed vertices: 3483 at `s = 1`, 203 at `s = 0.01`.
- **Vertices are exact plane intersections** (`qefTruncated`): where three faces meet, `P_a ∩ P_b ∩ P_c`; with exact tangent data there is no noise to regularize. Only (nearly) dependent planes need care: eigenvalues of `Σ n nᵀ` below `tau · max` are dropped and the vertex keeps its contour position in those directions (coplanar flat faces; nearly coplanar normals, as along the torus's top and bottom circles, where exact intersections otherwise fly off by up to 12 units). "Dependent planes, log₁₀" sets `tau` (default 10⁻²).

### Methods

- **Contract contour regions** (`recoverSurface`, default): each step face is absorbed by one of its two own faces (the one with the nearer tangent point), so the regions tile the contour and neighboring faces share vertices by construction; vertices where ≥ 3 regions meet are plane intersections. Most robust topology.
- **Extend own faces** (`extendOwnFaces`): no assignment of steps at all. Each own face's boundary gives its neighbors in order (each edge borders a step toward one neighbor `b`; a switch from `b` to `c` becomes the vertex `P_a ∩ P_b ∩ P_c`). Faces can disagree near four-owner junctions (flips); those are merged into one vertex ("Merge flipped junctions"). Leaves more cracks than the partition.

Results, `s = 0.1`, `tau = 10⁻²` (rays from outside to an interior point that cross no face; areas vs true 8.88 / 6.91):

| | torus, 1500 uniform | two spheres, 1500 uniform | torus, 1500 near surface |
|---|---|---|---|
| Contract contour regions | 0/400 rays, area 9.03, 26 vertices off > 0.02 | 0/400 (crease 0/600), area 6.95, max error 0.032 | 0 rays, 0 open edges, 0 off, area 8.96 |
| Extend own faces | 2/400, area 8.99, 22 off | 0/400 (crease 0/600), area 6.99 | 0 rays, area 8.96 |
| either at `s = 1` | 50/400 rays (extend) | — | — |

### Contract contour regions (details)

`recoverSurface(sites, signs, owner, cells, planes, lambda, tau)` builds a polygon mesh with one face per sample, lying in that sample's tangent plane. The power contour supplies the connectivity.

- **Why the planes:** the face between sample `p_i` and its own tangent site `t_i` lies in the radical plane of sphere `i` and the point `t_i`. Since `t_i` is on that sphere, this is the sphere's tangent plane at `t_i`, which for an exact SDF is the surface's tangent plane. The face always exists and contains `t_i`: there both sites have power 0, and every other site has positive power.
- **Owners:** every site has an owner, the sample it comes from (`data.owner`). Green faces (own faces) never meet three at a vertex, so they cannot give plane intersections by themselves; the other contour faces fill the gaps between them.
- **Algorithm:**
  1. Weld the contour vertices (each cell computes its own copy) and partition the contour faces into one *region* per owner. A green face belongs to its owner. Any other face belongs to whichever of its two owners has the nearer tangent point (measured from the face centroid).
  2. Clean up so that every region is one connected piece: a stray component cut off from the region's green face goes to the face's other owner, or else to its most common neighboring region. A region enclosed by a single other region is merged into it. (Without this, about 1% of regions are not discs.)
  3. Output vertices are the contour vertices where ≥ 3 regions meet, placed where those regions' tangent planes meet (`qefTruncated`, above). With `tau = 0` the older placement is used: `Σ (n_k·(x − t_k))² + λ|x − v|²` with `λ = REC_LAMBDA = 0.01`, which pulls vertices off the planes toward the contour vertex `v`.
  4. Each region's polygon is its boundary loop on the contour (a chain of half-edges whose twin is in another region), keeping only the output vertices on it. A region whose boundary is not a single simple loop, or that has fewer than 3 output vertices, is reported in `badOwners` and leaves a hole.
- **Why a partition:** an earlier version gave every non-green face to *both* of its owners. Regions then overlap, and on the torus or box an owner pair could share 3 to 20 vertices instead of 2, so there was no valid mesh.
- **Results**, 1500 samples, `|sdf|` at the vertices:
  - Box: about 10× more accurate than the contour vertices; edges and corners come out sharp.
  - Torus: closed mesh (χ = 0), no gain in accuracy.
  - Two spheres, "Near surface" sampling: crease vertices are 0.008 from the crease circle (median), against 0.05 for the contour.
- **Requires** both sampled and tangent points.

### Clipped tangent planes (`clipTangentPlanes`)

The second method ("Clip tangent planes") uses only the tangent data (`t_i`, `n_i`, and the sign of each tangent point's sample) and works with the samples as given.

- **Connectivity from mirrored pairs** (`mirroredSites`, `contourNeighbors`): each tangent point becomes two sites `t ± δn` (`δ = MIRROR_DELTA = 1e-3`, weight 0, signs + and −). Their bisector is exactly the tangent plane, and the pair's cells together are `t`'s Voronoi cell. So their power contour is each tangent plane clipped to its Voronoi cell, plus thin "step" faces on the Voronoi faces between neighbors where the planes do not meet: the zero set of Hoppe et al.'s nearest-tangent-plane distance. Tangent points whose pieces meet at a contour vertex are neighbors (a restricted Delaunay neighborhood). The "Mirrored pairs" site checkbox shows this contour.
- **Faces:** each face is its tangent plane `P_i`, clipped by the half-spaces of its neighbors' planes (2D clipping in `P_i`). Keep the side of `P_j` containing `t_i` (`f_j ≤ 0` where the surface is locally convex, `f_j ≥ 0` where concave, `f_j(x) = n_j·(x − t_j)`). Neighbors whose normals are within `PARALLEL_DEG = 10°` are split by their Voronoi bisector instead.
- **Corners and edges need no detection.** A tangent point on a box edge or corner lies exactly (to `EXACT = 1e-12`, rounding) on the face planes around it. When `t_i` is exactly on `P_j`, the side is decided by the samples' signs: outside samples see a convex feature. Two points each exactly on the other's plane (two points on one edge) are also split by their Voronoi bisector, since their planes share a line and never separate them along it. With only this, the planes from the flat faces cut each other along the edges and the edge and corner points' faces collapse (box, near-surface sampling: 18 vertices off by > 0.02, area 6.91 vs 6.64).
- **Curved creases (optional, thresholds).** On the two-sphere crease, the interior samples' tangent points lie on the neighboring sphere planes only up to curvature, so the "side containing `t_i`" rule picks the convex side of a concave groove and makes spikes. "Detect curved creases" (`features`, off by default) uses `featureTies`: `t_i` is on a feature shared with neighbor `j` if their normals turn faster than `j`'s patch curvature `κ_j` allows (`θ > turnFactor·κ_j r + marginDeg`) and `|f_j(t_i)| ≤ onPlaneFactor·κ_j r²`; then the sample's sign decides, the point is clipped by its two-ring (`ring2`), and two such points are split by their bisector. Two spheres, near-surface sampling: 9 vertices off by > 0.02 with it, 34 without.
- **Union across concave creases.** Locally the surface is not one envelope: across the two-sphere groove it is `min(max(left planes), max(right planes))`. So a face must be above at least one plane from the other side, not all of them; intersecting all constraints carved see-through holes along the groove. Concave constraints are therefore combined by union (`concaveUnion`): the face is the overlapping convex pieces `C ∩ H_j`, where `C` intersects the convex and bisector constraints. A pair is convex only if each point is below the other's plane (`mutualConvex`); a mixed pair (typical across a concave crease from far away) only joins the union. Rays from outside to an interior point that cross no face (two spheres, 300 uniform samples, 600 rays through the crease band): 150 intersecting everything, 60 with the union, 13 with both. At 1500 uniform samples the mutual test is worse (41 vs 23), so both are checkboxes.
- **Concave creases are starved of tangent points.** On the two-sphere groove, closest points of outside samples avoid the crease (the exterior medial axis, the plane x = 0, meets the surface there), and inside samples near it land exactly on the crease circle (0.33% of uniform samples). Within 0.16 of the crease the tangent-point density is 1–5% of the average, so both methods bridge the groove with planes from 0.15–0.3 away.
- Options are sliders in the viewer and re-clip without recomputing the diagrams. "Clip all faces by two-ring" (`ring2All`) fixes the box and torus outliers but over-clips smooth surfaces (torus area 6.2 vs 8.9).
- Faces share no vertices; the result is a polygon soup, not a mesh. 

## Viewer (`index.html`)

- **Domain** is `[−B, B]³` with `B = 1.5`, used both for sampling and for the diagram's bounding box.
- **`shapes`** maps a name to `{ sdf(p), closest(p), meshes() }`. `shapes.obj` is filled in by `loadOBJ(text, name)` from the file picker or a drop on the page; choosing "OBJ file…" before any mesh is loaded shows the Load row (and tries to open the picker, which Safari blocks), and `compute()` keeps the previous scene until a mesh arrives. `meshes()` returns three.js geometry for the optional true-surface overlay. To add a shape, add one entry here and one `<option>`.
- **Sampling** (`samplePoints`) is uniform random, jittered grid, regular grid, or near surface (uniform random, keeping points with `|d| < BAND = 0.1`), using the seeded PRNG `mulberry32`. The regular grid gets a jitter of about 1e-6 to avoid degenerate cases. Near-surface sampling puts the point budget where the surface is; the two-sphere crease is only recovered well with it.
- **Two-sphere SDF:** `min(dL, dR)` is exact outside the union but not inside. Inside, the nearest surface point may be on the crease circle, or on the exposed cap of a sphere, so the SDF computes those distances. With the plain `min`, tangent points of interior samples landed on sphere parts buried inside the other sphere.
- **Pipeline:** `compute()` samples points, builds the sites, runs `computePowerDiagram`, stores everything in `data`, then calls `rebuildAll()`. Changing shape, sampling, point count, seed or either site checkbox recomputes. With both off there are no sites and nothing is drawn.
- **Scene objects** (in `groups`):
  - `merged`: one `Mesh` holding **both** the input spheres (radius `√w`; tangent sites have radius 0 and are skipped) and the contour faces, built by `buildTransparent`. Each face is emitted once, from its `+` side. Each object (one sphere, or one contour face) owns a contiguous range of unshared vertices. The color attribute is RGBA: its alpha is the sphere or contour opacity, written by `applyVisuals`. A `cullBack` vertex attribute, used by a shader patch in `onBeforeCompile`, hides the back faces of spheres only; the contour stays two-sided.
  - `centers`: small opaque instanced dots; tangent sites are drawn smaller and lighter.
  - `edges`: `LineSegments` of the face outlines.
  - `surface`: the overlay of the true surface.
  - `recovered`: the recovered surface (`buildRecovered`), for the method chosen under "Recovered surface". With "Clip tangent planes", faces of corner, edge and crease points are orange. Opaque, so it is drawn before the transparent mesh, writes depth and needs no sorting. Its polygon outlines are dark; hole edges (a directed edge whose reverse is in no polygon) are red.
- **`applyVisuals()`** handles every display-only control: opacities, visibility, the slice plane and the slider readouts. These controls never recompute the diagram.
- **Transparency and depth order.** `sortTransparent()` runs from the render loop whenever the camera *position* changes, and permutes object ranges in `merged`'s index buffer so everything is drawn back to front:
  - The sort key is the eye's power distance to the sites, `π_k = |e − p_k|² − w_k`. Along any ray from the eye, power cells are crossed in increasing `π`. On the ray, each site's power distance minus the shared `t²` is a straight line in `t`; the ray is in the cell whose line is lowest, and lines become lowest in order of increasing value at `t = 0` (Edelsbrunner's acyclicity theorem).
  - Sphere `k` gets key `π_k`. A face between `i` and `j` gets `max(π_i, π_j)`, so it is drawn right after its farther cell; on ties the sphere is drawn first. Objects are drawn in decreasing key order.
  - This is exact among contour faces, and exact for the part of each sphere inside its own cell. A red and a blue sphere never intersect, because their radii are distances to the surface, so no sphere crosses the contour. A sphere's parts outside its own cell lie inside other spheres of the same color, where order errors are nearly invisible: same color, same opacity.
  - Hiding a group (opacity 0) drops its objects from the index buffer.
  - `forceSinglePass` is needed: otherwise three.js draws transparent DoubleSide meshes as all back faces, then all front faces, which breaks the order. `depthWrite` is off unless everything drawn is fully opaque.
  - **Edges** are opaque and write depth. The transparent mesh therefore covers edges behind it, and edges in front of it stay crisp; `polygonOffset` resolves edges that lie on the contour itself.
  - The true-surface overlay is a separate transparent object drawn after `merged` (`renderOrder` 2), so it is not sorted with it.
- **Colors:** `+` is red, `−` is blue, the contour is gold. With *Face color: By face type*, `buildTransparent` classifies each face with `faceType` (using `data.owner`, the sample index each site comes from) and colors it from `FACE_TYPES`. It also fills the `#faceLegend` legend with counts.

## Testing and conventions

- Test the geometry in Node with `require('./powerdiagram.js')`. Useful checks:
  - Cell volumes sum to the box volume.
  - Every face `i→j` has a matching face `j→i`.
  - A random point's lowest-power site has a non-empty cell.
  - Contour vertices have small `|sdf|`.
  - Along rays from the eye, cells and contour faces appear in increasing power distance `π`.
  - The page script runs in Node against the real `vendor/three.js` if `document`, `window`, `WebGLRenderer` and `OrbitControls` are stubbed.
- Issues are tracked with git-bug (`git bug bug`).
