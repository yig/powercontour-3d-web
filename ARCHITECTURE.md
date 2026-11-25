# Architecture

A static web page that shows the 3D *power contour* of points sampling a signed distance field (SDF).
There is no build step and no network access needed: open `index.html` from disk.
Everything is loaded as classic `<script>` tags, because browsers refuse to load ES modules from `file://` pages.

## Files

| File | Role |
|---|---|
| `powerdiagram.js` | Pure geometry: the 3D power diagram. No three.js. Runs in the browser (global `PowerDiagram`) and in Node (`require`). |
| `recover.js` | Pure geometry: recovers a surface by intersecting tangent planes, using the power contour's connectivity. No three.js. Browser global `Recover`, Node `require`. |
| `index.html` | UI and rendering: SDFs, sampling, building sites, three.js scene, controls. All code is in one inline `<script type="module">`, which uses the global `THREE`. |
| `vendor/three.js`, `vendor/OrbitControls.js` | three.js r170, converted from its ES modules into classic scripts that define `window.THREE` and `THREE.OrbitControls`. Generated; do not edit. |
| `vendor/update-three.mjs` | Regenerates the files above from jsdelivr: `node vendor/update-three.mjs [version]`. It stops with an error if a three.js version no longer has the single-file, import-free form it expects. |
| `AGENTS.md` | The original spec. |

## Math

- Each site `i` has a position `p_i`, a weight `w_i` and a sign `s_i ∈ {+1, −1}`.
- The power distance is `pow_i(x) = |x − p_i|² − w_i`. The cell of `i` is where `pow_i` is the smallest.
- **Input sites** ("Sampled points", on by default) are sample points `p` with SDF value `d`. They get `w = d²`, so each is a sphere of radius `|d|`, and sign `s = sign(d)` (zero counts as +).
- **Tangent sites** ("Tangent points", off by default) are one per sample point with `d ≠ 0`, computed whether or not the input sites are included. Each sits at `p − d·∇d`, the closest point on the surface; `∇d` is found by central differences and normalized. It gets `w = 0` and the opposite sign, `−sign(d)`. A tangent site lies on its own sample's sphere (power 0 for both) and, for an exact SDF, outside every other sphere. So when both kinds are on, tangent cells sit between almost all `+` and `−` input cells. A face between a sample and its **own** tangent site contains that tangent site. A face between a sample and **another** sample's tangent site, or between two tangent sites, is only a wall of the tangent cell and is usually far from the tangent point. Torus, 300 random samples: 26 sample–sample, 300 own, 1364 other, 19 tangent–tangent faces.
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

`recoverSurface(sites, signs, owner, cells, planes, lambda)` builds a polygon mesh with one face per sample, lying in that sample's tangent plane. The power contour supplies the connectivity.

- **Why the planes:** the face between sample `p_i` and its own tangent site `t_i` lies in the radical plane of sphere `i` and the point `t_i`. Since `t_i` is on that sphere, this is the sphere's tangent plane at `t_i`, which for an exact SDF is the surface's tangent plane. The face always exists and contains `t_i`: there both sites have power 0, and every other site has positive power.
- **Owners:** every site has an owner, the sample it comes from (`data.owner`). Green faces (own faces) never meet three at a vertex, so they cannot give plane intersections by themselves; the other contour faces fill the gaps between them.
- **Algorithm:**
  1. Weld the contour vertices (each cell computes its own copy) and partition the contour faces into one *region* per owner. A green face belongs to its owner. Any other face belongs to whichever of its two owners has the nearer tangent point (measured from the face centroid).
  2. Clean up so that every region is one connected piece: a stray component cut off from the region's green face goes to the face's other owner, or else to its most common neighboring region. A region enclosed by a single other region is merged into it. (Without this, about 1% of regions are not discs.)
  3. Output vertices are the contour vertices where ≥ 3 regions meet. Each is placed by least squares on the tangent planes of those regions, `Σ (n_k·(x − t_k))² + λ|x − v|²`, where `v` is the contour vertex. `λ` (`REC_LAMBDA = 0.01`) keeps nearly parallel planes well-posed.
  4. Each region's polygon is its boundary loop on the contour (a chain of half-edges whose twin is in another region), keeping only the output vertices on it. A region whose boundary is not a single simple loop, or that has fewer than 3 output vertices, is reported in `badOwners` and leaves a hole.
- **Why a partition:** an earlier version gave every non-green face to *both* of its owners. Regions then overlap, and on the torus or box an owner pair could share 3 to 20 vertices instead of 2, so there was no valid mesh.
- **Results**, 1500 samples, `|sdf|` at the vertices:
  - Box: about 10× more accurate than the contour vertices; edges and corners come out sharp.
  - Torus: closed mesh (χ = 0), no gain in accuracy.
  - Two spheres, "Near surface" sampling: crease vertices are 0.008 from the crease circle (median), against 0.05 for the contour.
- **Requires** both sampled and tangent points.

## Viewer (`index.html`)

- **Domain** is `[−B, B]³` with `B = 1.5`, used both for sampling and for the diagram's bounding box.
- **`shapes`** maps a name to `{ sdf(p), meshes() }`. `meshes()` returns three.js geometry for the optional true-surface overlay. To add a shape, add one entry here and one `<option>`.
- **Sampling** (`samplePoints`) is uniform random, jittered grid, regular grid, or near surface (uniform random, keeping points with `|d| < BAND = 0.1`), using the seeded PRNG `mulberry32`. The regular grid gets a jitter of about 1e-6 to avoid degenerate cases. Near-surface sampling puts the point budget where the surface is; the two-sphere crease is only recovered well with it.
- **Two-sphere SDF:** `min(dL, dR)` is exact outside the union but not inside. Inside, the nearest surface point may be on the crease circle, or on the exposed cap of a sphere, so the SDF computes those distances. With the plain `min`, tangent points of interior samples landed on sphere parts buried inside the other sphere.
- **Pipeline:** `compute()` samples points, builds the sites, runs `computePowerDiagram`, stores everything in `data`, then calls `rebuildAll()`. Changing shape, sampling, point count, seed or either site checkbox recomputes. With both off there are no sites and nothing is drawn.
- **Scene objects** (in `groups`):
  - `merged`: one `Mesh` holding **both** the input spheres (radius `√w`; tangent sites have radius 0 and are skipped) and the contour faces, built by `buildTransparent`. Each face is emitted once, from its `+` side. Each object (one sphere, or one contour face) owns a contiguous range of unshared vertices. The color attribute is RGBA: its alpha is the sphere or contour opacity, written by `applyVisuals`. A `cullBack` vertex attribute, used by a shader patch in `onBeforeCompile`, hides the back faces of spheres only; the contour stays two-sided.
  - `centers`: small opaque instanced dots; tangent sites are drawn smaller and lighter.
  - `edges`: `LineSegments` of the face outlines.
  - `surface`: the overlay of the true surface.
  - `recovered`: the recovered surface (`buildRecovered`), when "Intersect tangent planes" is on. Opaque, so it is drawn before the transparent mesh, writes depth and needs no sorting. Its polygon outlines are dark; hole edges (a directed edge whose reverse is in no polygon) are red.
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
