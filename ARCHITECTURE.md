# Architecture

A static web page that shows the 3D *power contour* of points sampling a signed distance field (SDF).
There is no build step. `index.html` loads three.js from jsdelivr, so it needs internet access.
To run it, open `index.html`, or run `python3 -m http.server` here and browse to `http://localhost:8000`.

## Files

| File | Role |
|---|---|
| `powerdiagram.js` | Pure geometry: the 3D power diagram. No three.js. Runs in the browser (global `PowerDiagram`) and in Node (`require`). |
| `index.html` | UI and rendering: SDFs, sampling, building sites, three.js scene, controls. All code is in one inline `<script type="module">`. |
| `AGENTS.md` | The original spec. |

## Math

- Each site `i` has a position `p_i`, a weight `w_i` and a sign `s_i ∈ {+1, −1}`.
- The power distance is `pow_i(x) = |x − p_i|² − w_i`. The cell of `i` is where `pow_i` is the smallest.
- **Input sites** are sample points `p` with SDF value `d`. They get `w = d²`, so each is a sphere of radius `|d|`, and sign `s = sign(d)` (zero counts as +).
- **Tangent sites** are optional, one per input site with `d ≠ 0`. Each sits at `p − d·∇d`, the closest point on the surface; `∇d` is found by central differences and normalized. It gets `w = 0` and the opposite sign, `−sign(d)`.
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

## Viewer (`index.html`)

- **Domain** is `[−B, B]³` with `B = 1.5`, used both for sampling and for the diagram's bounding box.
- **`shapes`** maps a name to `{ sdf(p), meshes() }`. `meshes()` returns three.js geometry for the optional true-surface overlay. To add a shape, add one entry here and one `<option>`.
- **Sampling** (`samplePoints`) is uniform random, jittered grid or regular grid, using the seeded PRNG `mulberry32`. The regular grid gets a jitter of about 1e-6 to avoid degenerate cases.
- **Pipeline:** `compute()` samples points, builds the sites, runs `computePowerDiagram`, stores everything in `data`, then calls `rebuildAll()`. Changing shape, sampling, point count, seed or the tangent checkbox recomputes.
- **Scene objects** (in `groups`):
  - `spheres`: an `InstancedMesh` of radius `√w`, with `depthWrite` off.
  - `centers`: small instanced dots; tangent sites are drawn smaller and lighter.
  - `contour`: one triangle-fan `BufferGeometry` with per-vertex color, built by `buildContour`. Each face is emitted once, from its `+` side.
  - `edges`: `LineSegments` of the face outlines.
  - `surface`: the overlay of the true surface.
- **`applyVisuals()`** handles every display-only control: opacities, visibility, the slice plane and the slider readouts. These controls never recompute the diagram. Contour `depthWrite` is on only when its opacity is ≥ 0.99, and `polygonOffset` keeps the edges drawn on top.
- **Colors:** `+` is red, `−` is blue, the contour is gold. Faces touching a tangent site turn green when the tint option is on.

## Testing and conventions

- Test the geometry in Node with `require('./powerdiagram.js')`. Useful checks:
  - Cell volumes sum to the box volume.
  - Every face `i→j` has a matching face `j→i`.
  - A random point's lowest-power site has a non-empty cell.
  - Contour vertices have small `|sdf|`.
- Issues are tracked with git-bug (`git bug bug`).
