# Power contour viewer

An interactive 3D viewer for the *power contour* of points sampling a signed distance field (SDF).

**Live:** https://yig.github.io/powercontour-3d-web/

Each sample point `p` with SDF value `d` becomes a weighted site: a sphere of radius `|d|`, signed by `d`. The viewer computes the power diagram of these sites, clipped to the box `[−1.5, 1.5]³`. The **power contour** is the set of faces between a positive cell and a negative cell, and it approximates the zero level set.

You can also add one **tangent point** per sample: the closest point on the surface, with weight 0 and the opposite sign. This pulls the contour much closer to the true surface. The sampled points and the tangent points can each be switched on or off, so you can also look at the diagram of the tangent points alone.

## Recovered surface

*Contract contour regions* (and its variant *Extend own faces*; see [RECOVERY.md](RECOVERY.md)) builds a polygon mesh with one face per sample, lying in its tangent plane. The power contour supplies the connectivity. The face between a sample and its own tangent point lies in that tangent plane. Every other contour face is given to the nearer of its two samples, and the resulting regions on the contour become the faces of the new mesh. Each vertex is where three or more tangent planes meet, so sharp edges and corners (the box, the two-sphere crease) come out sharp. Red outlines mark holes, where a region is not a disc. Set *Sphere scale* to about 0.1 for recovery: it shrinks each sample's sphere toward its tangent point, which leaves every own face exactly in its tangent plane but makes the other faces thin, so they collapse cleanly.

*Merge steps into faces* is meant for **tangent balls** (check *Tangent balls instead of sample spheres*): each sample's sphere is replaced by a ball tangent at its tangent point, on the convex side, as large as possible without containing another tangent point. The other contour faces then nearly lie in the tangent planes, so each is merged into the face of the nearer plane, and the cells' own vertices are kept: no plane intersections, so no far vertices. It is the most accurate method on smooth and developable shapes (try *Cylinder*), but its faces are planar only up to the merged steps. See [RECOVERY.md](RECOVERY.md), Approach 4.

*Clip tangent planes* uses only the tangent points: it finds neighbors with the power diagram of mirrored pairs `t ± δn` (check *Mirrored pairs* to see that contour), then clips each tangent plane by its neighbors' half-spaces. Corners and edges come out with no feature detection: the face planes cut each other there, and tangent points on corners and edges (orange) get tiny faces. Curved creases can optionally be detected with thresholds (sliders). See `ARCHITECTURE.md`.

## Running

There is no build step and no network access needed. Open `index.html` directly in a browser. three.js is in `vendor/`. To update it, run `node vendor/update-three.mjs [version]`.

## Controls

Every control has a **?** button in the panel that shows the same explanation as below.

| Group | Control | Effect |
|---|---|---|
| Input | Shape | The surface: a sphere, a box, a torus, a capped cylinder (developable side, flat caps), the union of two spheres (which has a concave crease where they meet), or a triangle mesh from an OBJ file. Each has an exact SDF and closest point (`shapes.js`). |
| | Mesh: Load… | Shown for "OBJ file…". Until a mesh is loaded the previous scene stays. Loads a `.obj` (you can also drop one onto the page). It is centered and scaled so its longest side spans [−1, 1]. Polygons are fan-triangulated and duplicate vertices merged. The distance is exact for the triangles; the sign uses angle-weighted pseudonormals, so the mesh should be closed and consistently oriented. |
| | Sampling | How sample points are placed in the box `[−1.5, 1.5]³`: uniform random, a jittered or regular grid, or uniform random keeping only points with `\|d\| < 0.1`. |
| | Points | Number of sample points. The power diagram costs O(n²): 1500 points take a couple of seconds. |
| | Seed | Random seed for the sampling. |
| | Sampled points | Put each sample into the power diagram: a site with weight `d²`, i.e. a sphere of radius `\|d\|` that touches the surface at its closest point, signed by `d`. |
| | Sphere scale | Moves each sample toward its tangent point, `p → t + s(p − t)`, and shrinks its sphere to radius `s\|d\|` so it stays tangent there. The face between a sample and its own tangent point stays exactly in the tangent plane for every `s`; only the other faces change, getting thinner as `s → 0`. About 0.1 is good for surface recovery. |
| | Tangent balls instead of sample spheres | Replace each sample's sphere by a ball tangent to the surface at the tangent point, on the side where the largest ball empty of other tangent points is bigger (the convex side; the sample's sign is not used), with radius ρ × that empty radius, at most the cap. The face between a ball and its own tangent point stays exactly in the tangent plane. The other faces (steps) lie within `(\|x − t_a\|² − \|x − t_b\|²) / 2λ` of a tangent plane, so big balls flatten them onto the planes on convex, concave and developable parts; on saddles the empty balls are small and steps stay. Balls bigger than the domain are not drawn. See [RECOVERY.md](RECOVERY.md), Approach 4. |
| | Ball size ρ | Tangent balls: the ball radius as a fraction of the largest empty ball on its side. Below 1 so that the ball never touches another tangent point; 0.5 is the default. |
| | Ball cap, log₁₀ | Tangent balls: the largest ball radius, 10^value. Where the surface is flat or convex the empty ball is unbounded; steps there shrink like 1/cap. 2 (radius 100) is the default; much larger loses precision. |
| | Tangent points | Add each sample's closest surface point as a site with weight 0 and the opposite sign. The face between a sample and its own tangent point lies exactly in the tangent plane. |
| | Mirrored pairs | For each tangent point `t` with normal `n`, add the pair `t + δn` (outside) and `t − δn` (inside), `δ = 0.001`. Their contour is each tangent plane clipped to `t`'s Voronoi cell, plus thin steps between neighbors. |
| Input spheres | Opacity | Opacity of the sample spheres (radius `√weight`). 0 hides them. |
| | Show centers | Dots at the site positions. Tangent points are smaller and lighter. |
| Power contour | Opacity | Opacity of the power contour: the faces between a `+` cell and a `−` cell. 0 hides it. |
| | Show edges | Outline the contour faces. |
| | Face color | Uniform gold, or color each face by the kinds of sites it separates, with a legend and counts. Green faces (a sample and its own tangent point) lie exactly in the tangent plane; the others are steps between them. |
| Recovered surface | Method | Build a surface whose faces lie in the tangent planes. *Contract contour regions*: give each other contour face to one of its two own faces, and intersect the tangent planes where regions meet. *Extend own faces*: extend each own face from its own boundary, without assigning the other faces. *Triangulate step patches*: remove each connected patch of other faces by triangulating the loop of own faces around it; the triangulation comes from the tangent planes (their envelope where the loop is convex or concave, a decider on saddles). *Merge steps into faces*: give each other contour face to the owner whose tangent plane it is nearer, and keep every vertex of the resulting regions at its contour position (a vertex of the power diagram, never a plane intersection). Meant for *Tangent balls*, where the steps nearly lie in the planes; faces are then planar up to the step heights (see RECOVERY.md, Approach 4). *Ball connectivity, plane vertices* (Approach 6): the regions of Merge steps into faces, on *Tangent balls*, as connectivity, with vertices where the planes meet, then Collapse and flip; the best plane-faced results on cylinders, the fandisk and the horse (see RECOVERY.md, Approach 6). *Collapse and flip*: Triangulate step patches, then merge faces whose planes coincide, flip toward the planes' envelope where four faces are all convex or all concave (a test with the 4 × 4 determinant of the planes, valid even when three planes meet at infinity), and in quads with convex and concave edges flip where it pulls vertices into the trust radius and un-inverts edges (see RECOVERY.md, Approach 5). These six need sampled + tangent points only. *Clip tangent planes*: clip each tangent plane by its neighbors' planes (any sites). See [RECOVERY.md](RECOVERY.md). |
| | Recommended settings on method change | On by default. When the method changes, set the controls it uses to their recommended values: sampled + tangent points, *Sphere scale* 0.1, *Dependent planes* −12 and *Trust radius* 2 for Contract, Extend, Triangulate and Collapse and flip (with their checkboxes on); *Tangent balls* with ρ 0.5 and cap 10² for Merge steps into faces; the default clip options for Clip tangent planes. Uncheck it to keep your own settings when switching. See [RECOVERY.md](RECOVERY.md), Parameters. |
| | Keep tangent points inside faces when flipping | *Triangulate step patches*, *Collapse and flip*, *Ball connectivity, plane vertices*: do not flip to an edge between two faces whose tangent points would end up on the wrong side of it (`f_a(t_b)` and `f_b(t_a)` of opposite signs). See [RECOVERY.md](RECOVERY.md), §2, Refinements. |
| | Flip toward curvature-metric Delaunay | Same methods: before vertex placement, flip toward the Delaunay triangulation in a curvature metric estimated from neighboring normals, which makes faces long along flat directions (cylinder rulings). Sharp features are left alone. |
| | Soft vertices (least squares, no chamfers) | Same methods: place each vertex by least squares on its faces' planes with a small pull toward its trust-limited position, instead of chamfers. |
| | Snap vertices toward their planes | *Merge steps into faces*: move each vertex to the point that minimizes the squared distances to its faces' tangent planes plus 0.1 × its squared distance to its contour position. Faces get flatter; vertices move by about the step height. |
| | Exactly planar faces, with gap faces | *Merge steps into faces*: give every face its own copies of its corners, projected onto its tangent plane, so it is exactly planar; then close the gaps between neighbors with orange gap faces (one per shared edge, one per vertex shared by three or more faces). Watertight; the gaps are as wide as the steps. |
| | Dependent planes, log₁₀ | Planes count as dependent (e.g. coplanar faces of the box) when eigenvalues of `Σ n nᵀ` fall below `10^value` × the largest; the vertex then keeps its contour position in those directions. With the trust radius on, this only needs to catch exact degeneracies: −12 is numerical precision. Without it (trust at 10 = off), about −2 is needed to stop nearly dependent planes from sending vertices far away. |
| | Trust radius × spacing | A tangent plane is only accurate within about one sample spacing of its tangent point. A vertex may move at most this many spacings (the distance from its contour position to the farthest of its tangent points) away from its contour position: it is the exact intersection of its planes if that is near, else the nearest point on the line where the two best-determined planes meet, else on one plane. 2 keeps box corners exact and removes far-away vertices on curved shapes. 10 = off. |
| | Chamfer far vertices | *Triangulate step patches* and *Collapse and flip*: where three tangent planes meet beyond the trust radius, replace that vertex by a small orange chamfer face with one point on each line where two of the planes meet. Every tangent-plane face then stays exactly planar. Off: the vertex is pulled back within the trust radius instead, off some of its planes. |
| | Stitch two-loop patches | *Triangulate step patches* and *Collapse and flip*: a patch of steps with two boundary loops (a ring, or an own face as an island inside it) is triangulated by stitching the two loops with the planes' envelope cost. Off: such patches keep the nearest-tangent-point partition. |
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

- [RECOVERY.md](RECOVERY.md): the structure of the contour (own faces and steps), the ways to turn it into one face per tangent point (including tangent balls, Approach 4), and the choice of sphere scale and dependent-plane threshold.
- [ARCHITECTURE.md](ARCHITECTURE.md): code structure, the math, and the clipping algorithm.
- [AGENTS.md](AGENTS.md): the original spec.
- Issues are tracked with [git-bug](https://github.com/git-bug/git-bug): `git bug bug`.
