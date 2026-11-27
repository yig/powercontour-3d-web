# Recovering a surface from the power contour

**Goal.** From SDF samples we know, for each sample `p_a`, its tangent point `t_a` (the closest surface point) and the normal `n_a` there. The power contour of the samples and their tangent points is a closed surface, but it is lumpy and far more complex than the data warrants. Among its faces, the ones that contain a tangent point carry trustworthy information: a point and its tangent plane. We want a surface made *only* of such facets: one planar polygon per tangent plane, containing its tangent point, with neighboring polygons sharing edges. This note explains the structure of the contour that makes this possible, five ways we tried to get there, how their outputs compare, and which ideas in them are worth keeping.

| | method | one-line idea | code |
|---|---|---|---|
| 0 | the power contour | the baseline: faces between `+` and `−` cells | `powerdiagram.js` |
| 1 | Contract contour regions | give every other face to a tangent point; intersect planes where regions meet | `recoverSurface` |
| 2 | Extend own faces | grow each tangent-plane face until it meets its neighbors' planes | `extendOwnFaces` |
| 3 | Triangulate step patches | remove each patch of non-tangent faces by triangulating the loop of faces around it, using the planes to choose | `triangulatePatches` |
| 4 | Tangent balls + Merge steps into faces | change the generators so the other faces almost lie in the planes, then merge them in | `tangentBallSites`, `mergeSteps` |
| 5 | Collapse and flip | repair Approach 3's connectivity with plane-only tests | `triangulatePatches` (option `rank`) |
| — | Clip tangent planes | clip each plane by its neighbors' planes (an earlier method; see `ARCHITECTURE.md`) | `clipTangentPlanes` |

Reproducing: the numbers come from `node figures/compare.js [n] [random|band]`, the 2D figures from `node figures/make2d.js`, the 3D figures from `bash figures/shoot3d.sh` (headless Chrome; the fandisk needs `../../code-release/examples/fandisk.obj`). The earlier, piecemeal version of this note, with every experiment log, is `RECOVERY.md` at commit `a9b3cf2`.

## 1. Background

### 1.1 The data and the sites

For each sample `p_a` with SDF value `d_a ≠ 0`:

- the tangent point `t_a` is its closest surface point, and `n_a = (p_a − t_a) / d_a` is the outward unit normal there;
- the tangent plane is `P_a = { x : f_a(x) = 0 }`, with `f_a(x) = n_a · (x − t_a)`;
- the sample is a site with weight `d_a²` (a sphere of radius `|d_a|` touching the surface at `t_a`) and sign `sign(d_a)`;
- the tangent point is a site with weight 0 and the opposite sign.

The trusted data are `t_a`, `n_a` and the sign. Both sites of a sample have that sample as their *owner*.

### 1.2 The power contour (the baseline)

The power contour is the set of faces between a `+` cell and a `−` cell. It is closed and watertight by construction. Its faces are of two kinds.

**Own faces lie exactly in the tangent planes.** For `p = t + d n`, the power difference of a sample and its tangent point is

```
π_p(x) − π_t(x) = |x − p|² − d² − |x − t|² = −2 d · f(x),
```

so their bisector is the tangent plane. This holds for every sphere tangent to `P_a` at `t_a`, whatever its radius or side. The two cells of owner `a` form a *super cell* `C_a`, and the face between them, the **own face** `F_a = P_a ∩ C_a`, is a convex polygon in the tangent plane that contains `t_a`. There is exactly one per tangent point. These are the "good" facets.

**Steps are everything else.** Every other contour face lies on a wall between two super cells, between the lines where `P_a` and `P_b` cross that wall. A step exists because neighboring tangent planes do not meet on the wall. Generically **own faces never share an edge**: an edge of `F_a` has a third cell from another owner, so a step lies across it. (The sphere is the exception: by symmetry the planes meet exactly on the bisectors.)

![One outside sample p, its tangent point t, the circle of radius d about p touching the surface at t, and the normal n. Their two cells, outlined, form the super cell; the own face is the part of the tangent line inside it.](figures/fig-setup.svg)

*2D: one sample `p` (circle of radius `d`) and its tangent point `t`. Their two cells together (outlined) are the super cell; the boundary between them, the own face, lies in the tangent line.*

![The 2D power diagram of 70 samples and their tangent points. Almost the whole contour is own faces; steps are visible only at the two concave creases, and the inset magnifies a step on a smooth part 63 times.](figures/fig-structure.svg)

*2D: own faces (gold) joined by steps (red). In 2D the steps on smooth parts are tiny (inset, ×63); the visible ones are at concave creases.*

![The torus contour in 3D, sliced at z = 0, colored by face type: green own faces, purple steps, a few gold sample–sample faces.](figures/torus-contour.png)

*3D, torus, 300 samples, sliced: own faces (green) and steps (purple, gold). In 3D steps take a visible share of the contour.*

The contour is the "lumpy surface": it has up to 6 times as many faces as there are tangent points (torus 8964 for 1500), and on shapes with flat or developable parts its steps reach far out (the spikes in the first column of the comparison in §3). On the box with 1500 near-surface samples its vertices are up to 1.0 off the surface and its area is 9.75 against 6.64.

### 1.3 The target, and its dual

Eliminate the steps: extend each own face in its plane until it meets its neighbors' planes. The result has one face per tangent point, edges on the lines `P_a ∩ P_b`, and vertices at the points `P_a ∩ P_b ∩ P_c`.

It is easiest to think about in the **dual**: one dual vertex per facet (per tangent point), one dual edge per pair of adjacent facets, one dual triangle per output vertex. A choice of *connectivity* is a triangulation of the tangent points; given it, the *geometry* is determined: every vertex is the intersection of its three planes. All five methods are different ways to choose this triangulation (explicitly or implicitly) and to cope with triangles whose three planes do not meet nearby.

In the power diagram's own dual (the weighted Delaunay triangulation), eliminating steps means collapsing the edge between each sample and its tangent point. Edge collapses keep a manifold only under the link condition, which wide steps violate; this is why simply "collapsing" is not enough.

### 1.4 Sphere scale `s`

Move each sample toward its tangent point and shrink its sphere so it stays tangent: `p_a(s) = t_a + s (p_a − t_a)`, weight `(s d_a)²`. By §1.2 the own faces do not change; only the steps do. As `s → 0` the super cells become the Voronoi cells of the tangent points, each split by its plane, and steps thin to about `κh²` (curvature × spacing²). `s = 0.1` is the default for Approaches 1–3 and 5. Very small `s` runs into the absolute tolerance `1e-10` of `powerdiagram.js` (the plane is resolved only to about `1e-10 / (2 s |d|)`).

![The same samples at sphere scale 1 and 0.1. The own faces are identical; the cells around them change, and the steps at the creases change length.](figures/fig-sphere-scale.svg)

*Sphere scale in 2D: identical own faces at `s = 1` and `s = 0.1`; only the cells and steps change.*

### 1.5 Placing a vertex: far intersections and the trust region

Approaches 1, 2, 3 and 5 place each vertex where its faces' planes meet (`qefTruncated`: least squares on `Σ (n_k · x − n_k · t_k)²` about the contour vertex). With exact data, three independent planes meet at one exact point. The trouble is that this point can be very far away: three tangent planes 0.1 apart, with normals within 12° of each other but nearly coplanar, meet 600 units away. This is not round-off (the points satisfy their planes to `10⁻¹²`); the planes are simply not valid that far out. It happens where neighboring normals vary in one direction only: cylinders, cones, the torus's top and bottom circles (`K = 0`).

The underlying cause is combinatorial: the contour's adjacency is isotropic (Voronoi-like), while the arrangement of the planes is anisotropic there (long faces along the flat direction). The contour names a triple of faces that are not neighbors in the planes' arrangement.

Two guards exist:

- **Dependent planes `tau`**: drop directions whose eigenvalue in `Σ n nᵀ` is below `tau × λ_max`. `10⁻¹²` (default) only removes exact degeneracies, such as coplanar box faces. `10⁻²` would remove the far points, but also the exact corners of the box.
- **Trust radius**: a vertex may move at most `trust × (distance to the farthest of its tangent points)` from its contour position (default `trust = 2`). Within it, the exact intersection is used; beyond it, the nearest point on the line of the two best-determined planes, or on their average plane.

![Near an inflection, the tangent lines at two neighboring points are nearly parallel and meet far away. The trust region excludes that intersection.](figures/fig-far-intersection.svg)

| exact intersections, no trust region | `tau = 10⁻²` | exact + trust 2 (default) |
|---|---|---|
| ![Torus with exact intersections: long spikes.](figures/torus-exact.png) | ![Torus with tau = 1e-2: no spikes.](figures/torus-tau.png) | ![Torus with exact intersections in a trust region: no spikes.](figures/torus-trust.png) |

*Torus, 1500 uniform samples, Contract contour regions. Left: vertices fly up to 615 units away (area 41.9 against 8.88). Middle and right: the far points are gone; only the trust region also keeps the box exact.*

A useful fact for choosing triangles: on a surface locally `z = ½ xᵀQx`, three tangent planes meet above the `Q`-circumcenter of their tangent points, at height error `−½ R_Q²`, and `det(n_a, n_b, n_c) = 2K · area`. So the best triangulation on a convex or concave patch is the Delaunay triangulation in the metric `Q`, and near `K = 0` every triangle is ill-conditioned, whatever the triangulation.

## 2. The methods

### Approach 1: Contract contour regions (`recoverSurface`)

**Idea.** Paint the contour: every own face gets its owner's color, and every step gets the color of whichever of its two owners has the nearer tangent point. Each color is then one region per tangent point, and the regions tile the contour. Shrink each region to a polygon whose corners are where three or more regions meet, placed where those regions' planes meet.

**Details.** After welding, a cleanup makes each region one connected piece containing its own face (stray components go to their other owner or their most common neighbor; enclosed regions merge). Regions that are not discs still become faces: split regions give one face per piece, pinched regions a weakly simple polygon, regions with own faces inside an annulus a face with a hole, and pieces with fewer than three junctions collapse to an edge. So no region is dropped and the result is closed by construction.

The nearest-tangent-point rule makes the regions the restricted Voronoi cells of the tangent points, and their junctions the restricted Delaunay triangles: the connectivity is *isotropic*. That is the natural tie-break on flat parts and robust everywhere, but wrong where the planes' arrangement is anisotropic.

![Left: the contour at s = 0.1 colored by region. Right: the recovered polygon follows the true curve including both creases.](figures/fig-contract.svg)

*2D: each contour edge colored by its region (left); one vertex where neighboring regions meet, at the intersection of their tangent lines (right).*

### Approach 2: Extend own faces (`extendOwnFaces`)

**Idea.** The most literal version of the goal: leave steps unassigned, and let each own face grow in its plane. Walk around `F_a`; each edge faces a step toward some neighbor `b` (the owner of the third cell there), and a run of edges toward `b` becomes part of the line `P_a ∩ P_b`. Where the neighbor changes from `b` to `c`, place the vertex `P_a ∩ P_b ∩ P_c`, keyed by the triple `{a, b, c}` so that faces `b` and `c` find it too. Where four owners meet nearly at one point and faces disagree about the diagonal, incomplete triples sharing two owners are merged ("Merge flipped junctions").

**What it teaches.** Each face reads its neighbors locally, so the neighbor relation is not symmetric: `a` names `b` while `b` names `c`, and the unmatched ends are cracks. In 2D, reading neighbors from the contour's connectivity instead ("join consecutive own faces along the contour", the chain rule) is crack-free. In 3D the chain rule needs a decision about which own faces become adjacent across a patch of steps, which is what Approaches 1 and 3 supply. Connectivity must be decided once, on a shared structure, not per face.

![Extend own faces in 2D: neighbors read locally leave cracks; joining consecutive own faces along the contour is closed.](figures/fig-extend.svg)

### Approach 3: Triangulate step patches (`triangulatePatches`)

**Idea.** Keep every own face exactly. Because own faces often touch at corners, the steps form many small connected *step patches*, each surrounded by a loop of own faces `a_1 … a_k`. Removing a patch means making some of those faces adjacent: that is a triangulation of the `k`-gon of faces, `k − 2` triangles, each a vertex `P_a ∩ P_b ∩ P_c`. Choose the triangulation from the **planes**, not from distances between tangent points.

**The planes' criterion.** Whether a loop edge is convex or concave is read from the data alone: `f_a(t_b) + f_b(t_a) < 0` is convex (each tangent point below the other's plane), `> 0` concave. Where all edges are convex, the surface is locally the boundary of the intersection of half-spaces `f ≤ 0` (an envelope); all concave, of their union. An envelope of planes is itself a power diagram (Aurenhammer), so the right triangulation is a regular triangulation of the planes: on a quadric, the Delaunay triangulation in the metric `Q`. On saddles, where convex and concave edges alternate, the surface is a lattice (max–min) polyhedron of its planes (Ovchinnikov): grouping faces by convex runs gives one reading, by concave runs the other, and for `k = 4` the two readings are exactly the two diagonals, the same ambiguity as the marching-cubes saddle (resolved here by comparing the two readings' costs, plus a rule preferring the coarser grouping).

**Algorithm.** (1) Start from Approach 1's painted contour. (2) Each single-loop patch with up to 24 faces is triangulated by the `O(k³)` minimum-cost polygon triangulation dynamic program (Klincsek), the cost of a triangle being how far its vertex violates the reading. (3) Patches with two loops are stitched (Fuchs, Kedem and Uselton). (4) Larger patches keep Approach 1's partition, flipped toward the envelope where convex or concave; on a flat side of the box every plane is the same, and the Delaunay tie-break of the partition is the right answer. (5) A vertex beyond the trust radius becomes a small *chamfer* (one point on each line `P_a ∩ P_b`, plus an extra face), so that every tangent-plane face stays exactly planar. (6) Faces are the duals: the cycle of triangles around each own face.

**Limits.** Near `K = 0` (torus top circle, cylinders) the triangles still name non-neighbors in the planes' arrangement, and chamfers (310 on the uniform torus, 553 on the near-surface fandisk) only hide them.

### Approach 4: Tangent balls and Merge steps into faces (`tangentBallSites`, `mergeSteps`)

**Idea.** Instead of removing steps afterwards, change the generators so that steps nearly vanish, then keep the diagram's own vertices: no plane is ever intersected, so no vertex can fly off.

**Any tangent ball keeps the own face.** Replace sample `a`'s sphere by a ball of radius `λ` tangent to `P_a` at `t_a` on either side. By §1.2 the own face is unchanged. A step between `a`'s ball and `b`'s tangent cell then lies at height

```
f_a(x) = (|x − t_a|² − |x − t_b|²) / (2λ_a)
```

above `P_a`: steps flatten onto the planes like `1/λ`. But a ball may not contain another tangent point (it would steal that point's cell), so `λ_a` is bounded by the largest empty ball tangent at `t_a` on that side, a discrete medial ball computed from the tangent points alone (cf. the power crust's poles). Put each ball on the side with the larger empty ball, radius `min(cap, ρ r_a)` (`ρ = 0.5`, cap 100). On convex, concave, flat and developable parts the balls are huge and the steps nearly vanish; on saddles both empty balls are `≤ 1/κ` and steps stay `O(κh²)`.

**No generator gets the planes exactly.** On `L = P_a ∩ P_b`, any site tangent at `t_a` has power `|x − t_a|²` (plus a constant), so the wall between `a` and `b` meets `L` at a single point, whatever radii, sides or weights are chosen. Exact containment would require moving the tangent sites within their planes ("virtual tangent points"), which is overdetermined two to one. Some post-processing is always needed.

**Merging.** Give each step to the owner whose plane it is nearer, clean up as in Approach 1, and output each region's boundary with *all* its vertices at their contour positions. Watertight and with no far vertices, but faces are planar only up to the merged step heights, and there are 2–6 times as many vertices. Options: *Snap* (pull vertices toward their planes) or *gap faces* (exactly planar faces, plus faces filling the gaps).

**Anisotropy for free.** On a cylinder, the faces become strips along the rulings, the envelope's structure, which no other method builds. The strips are ragged and end after a few spacings because each is assembled from steps of different heights.

![The torus contour with tangent balls, sliced at z = 0, colored by face type.](figures/torus-balls-contour.png)

*Torus, 300 samples, tangent balls: on the outer (convex) half the steps lie almost in the planes of the own faces next to them; on the inner (saddle) half they are visible.*

![2D: the contour with sample spheres at s = 0.1, with balls on the sample's side, and with balls on the empty side.](figures/fig-balls.svg)

### Approach 5: Collapse and flip (`triangulatePatches`, option `rank`)

**Idea.** Keep Approach 3's dual triangulation but repair it with tests that use only the planes, before placing any vertex.

1. **Collapse** dual edges whose two planes coincide (normals and offsets equal to `10⁻⁷`), when the link condition holds. A facet may then own several tangent points: the box's flat sides become a few faces. Its trust radius uses the nearest of them.
2. **Envelope flips without triple points.** Write planes as `h_a = (n_a, −n_a · t_a)`. Then `f_d(x_abc) = D4(a,b,c,d) / D3(a,b,c)`, with `D4 = det[h_a; h_b; h_c; h_d]` and `D3 = det[n_a; n_b; n_c]`. In an all-convex or all-concave quad, edge `ac` is on the envelope iff `κ σ D4(a,b,c,d) ≥ 0` (`κ = ∓1` for convex/concave, `σ` the orientation of the Gauss image). This is an in-sphere test in plane coordinates: it needs no triple point and holds when `x_abc` is at infinity. Four strip planes of a cylinder have `D4 = 0`, a tie.
3. **Mixed-quad flips.** In quads with both edge types, flip when it lowers a cost of *far vertices* (beyond the trust radius) and *inverted edges*: each dual edge `p–q` puts its two vertices on the line `P_p ∩ P_q`, and walking around face `p` the edge must run along `±(n_p × n_q)` according to its type; a negative signed length is a fold. In an all-convex quad this inversion test is the envelope test, so this generalizes it to mixed edges. Each flip lowers the total cost, so it terminates.

**Limits.** On a cylinder every quad of four strips is a tie, so local flips grow strips only one or two rows from the caps; a ladder of strips would need a direct construction. Naive alternatives failed: flipping to maximize `|det|` gives planes that meet, but as non-neighbors (cylinder: 0.012 → 0.251), and applying the far-plus-inversion cost to tie quads destroys the cylinder.

### Clip tangent planes (`clipTangentPlanes`)

An earlier method that uses only `t`, `n` and signs: neighbors come from a diagram of mirrored pairs `t ± δn`, and each tangent plane is clipped by its neighbors' half-spaces (unions across concave creases). Every face is exactly planar and contains its tangent point, but faces share no vertices: the result is a polygon soup, with gaps, overlaps and, on the fandisk, large spurious faces. It shows the opposite trade-off from Approach 4: perfect facets, no shared edges.

## 3. Comparison

All runs: seed 1, `s = 0.1`, exact `tau`, trust 2; Approach 4 uses tangent balls (`ρ = 0.5`, cap 100), the others sample spheres. "Near-surface" samples have `|d| < 0.1`; "uniform" fill the domain `[−1.5, 1.5]³`.

### 3.1 Visual

![Five shapes (rows) by the power contour with sample spheres and with tangent balls, and the five recovery methods (columns).](figures/comparison.png)

*1500 near-surface samples. Columns 1–2: the raw contour, green own faces and purple steps. Columns 3–7: recovered surfaces; red edges are hole edges, orange faces chamfers. The individual shots are `figures/cmp-<shape>-<method>.png`.*

What to look for:

- **The raw contour** with sample spheres has spikes wherever steps reach far (box, cylinder, fandisk). With tangent balls it is already close to the surface everywhere; its purple steps are thin slivers.
- **Contract** and **Triangulate** look alike: isotropic, Voronoi-like faces everywhere, including on the flat box sides and the cylinder. Triangulate's spike under the box is a far corner vertex.
- **Extend** shows its red cracks along the box and cylinder edges and around the fandisk.
- **Merge** is the only method with long strips on the cylinder side; its box is clean, but its faces, although many, are not quite planar.
- **Collapse and flip** is the only method whose facets are as large as the data allows: the box has a handful of faces, the cylinder's cap two, the fandisk's flat top one. Its cylinder side remains isotropic.

### 3.2 Numerical

**Accuracy**: largest distance of a vertex from the true surface / number of vertices farther than 0.02. 1500 near-surface samples:

| | torus | two spheres | box | cylinder | fandisk |
|---|---|---|---|---|---|
| power contour, `s = 0.1` | 0.023 | 0.448 | 1.000 | 1.053 | 0.675 |
| power contour, tangent balls | 0.016 | 0.013 | `2·10⁻⁴` | 0.001 | 0.103 |
| 1. Contract contour regions | 0.033 / 24 | 0.056 / 8 | 0.042 / 3 | 0.066 / 7 | 0.101 / 48 |
| 2. Extend own faces | 0.033 / 24 | 0.067 / 6 | 0.042 / 3 | 0.065 / 7 | 0.579 / 80 |
| 3. Triangulate step patches | 0.035 / 2 | 0.127 / 18 | 0.198 / 11 | 0.030 / 2 | 0.154 / 82 |
| 4. Merge steps (tangent balls) | **0.016 / 0** | **0.013 / 0** | `2·10⁻⁴` / 0 | **0.001 / 0** | **0.096** / 210 |
| 5. Collapse and flip | 0.028 / 1 | 0.061 / 8 | **exact / 0** | 0.006 / 0 | 0.173 / **40** |
| Clip tangent planes | 0.190 / 206 | 0.405 / 139 | 0.156 / 15 | 0.099 / 41 | 1.392 / 1731 |

Same, 1500 uniform samples (the far samples' big spheres make wider steps):

| | torus | two spheres | box | cylinder | fandisk |
|---|---|---|---|---|---|
| power contour, `s = 0.1` | 0.083 | 0.379 | 0.106 | 0.101 | 0.251 |
| power contour, tangent balls | 0.041 | 0.039 | `3·10⁻⁴` | 0.002 | 0.178 |
| 1. Contract contour regions | 0.076 / 64 | 0.067 / **27** | **exact / 0** | 0.022 / 2 | 0.299 / 131 |
| 2. Extend own faces | 0.076 / 51 | 0.179 / 30 | `3·10⁻⁵` / 0 | 0.023 / 1 | 0.326 / 118 |
| 3. Triangulate step patches | 0.055 / 14 | 0.163 / 37 | exact / 0 | 0.012 / 0 | 0.307 / 214 |
| 4. Merge steps (tangent balls) | 0.041 / 33 | **0.039** / 50 | `3·10⁻⁴` / 0 | **0.002 / 0** | **0.135** / 344 |
| 5. Collapse and flip | **0.025 / 5** | 0.116 / 38 | exact / 0 | 0.012 / 0 | 0.307 / **101** |
| Clip tangent planes | 0.273 / 276 | 0.370 / 135 | 0.190 / 57 | 0.374 / 235 | 1.182 / 2191 |

**Structure**, 1500 near-surface samples: vertices; hole edges (directed edges with no reversed twin); off-plane (largest distance of a facet's vertex from its own tangent plane); area (true: torus 8.88, two spheres 6.91, box 6.64, cylinder 5.97, fandisk 8.82). The contour row gives its face count and the share of its area in own faces.

| | torus | two spheres | box | cylinder | fandisk |
|---|---|---|---|---|---|
| contour, `s = 0.1`: faces, own area, area | 8964, 95%, 9.39 | 1748, 93%, 7.60 | 2613, 77%, 9.75 | 7233, 85%, 7.43 | 6213, 73%, 13.81 |
| contour, tangent balls | 8508, 68%, 8.95 | 1772, 98%, 6.97 | 2643, 90%, 6.64 | 9577, 44%, 5.97 | 6130, 79%, 9.25 |
| 1. Contract | 3000, 0, 0.013, 9.01 | 2996, 0, 0.011, 7.00 | 2996, 0, 0, 6.64 | 2995, 3, 0.006, 5.98 | 2998, 0, 0.092, 8.98 |
| 2. Extend | 2964, 11, 0.015, 9.01 | 2990, 103, 0.012, 7.02 | 2933, 246, 0, 6.65 | 2938, 116, 0.006, 5.99 | 2944, 517, 0.148, 9.29 |
| 3. Triangulate | 3458, 0, 0, 9.05 | 3038, 0, 0.012, 7.01 | 2996, 0, 0, 6.67 | 3000, 0, 0.005, 5.98 | 4104, 0, 0.128, 9.47 |
| 4. Merge | 8981, 0, 0.030, 8.93 | 3220, 0, 0.025, 6.96 | 3974, 0, `10⁻⁴`, 6.64 | 9949, 3, 0.045, 5.97 | 7376, 0, 0.125, 8.93 |
| 5. Collapse and flip | 3088, 0, 0, 9.02 | 3000, 0, 0, 7.04 | **338**, 0, 0, 6.64 | **2258**, 0, 0.005, 5.98 | **2378**, 0, 0.070, 9.31 |

Triangulate and Collapse and flip also output chamfer faces: 229 and 44 on the torus, 553 and 206 on the fandisk. Collapse and flip has 154 facets on the box (ideal: 6) and 1120 on the cylinder (1500 tangent points).

**Sparse samples** (300 near-surface): largest error. Merge 0.053 / 0.090 / `9·10⁻⁴` / 0.005 / 0.158 (torus, two spheres, box, cylinder, fandisk); Collapse and flip 0.173 / 0.090 / 0.203 / 0.026 / 0.223; Contract 0.159 / 0.090 / 0.245 / 0.105 / 0.508; Triangulate 0.111 / 0.192 / 0.203 / 0.078 / 0.510; Extend fails on the box, cylinder and fandisk (errors above 1).

### 3.3 Reading the comparison

- **The raw contour with tangent balls is already a good surface** (errors of `10⁻³` on the box and cylinder), only too complex and not made of tangent facets. Merge inherits its accuracy.
- **Plane intersections are exact where the connectivity is right and wrong where it is not.** The methods that intersect planes (1, 2, 3, 5) are exact (Extend: `3·10⁻⁵`) on the box with uniform samples, but their errors on smooth and developable parts are governed by triples that are not neighbors in the planes' arrangement, hidden by the trust region and chamfers.
- **Collapse and flip has the fewest bad vertices among the plane-intersection methods** on almost every case and is the only one that reduces the face count toward what the planes require. Its worst vertices on the fandisk (0.173) are exact intersections of independent planes within the trust radius: the trust radius is a weak test of validity.
- **Merge is the most accurate** but pays in planarity (off-plane up to 0.045 on the cylinder, 0.125 on the fandisk), vertex count (up to 3–4× on the torus and cylinder), and saddles (its steps do not flatten there).
- **Extend own faces** is rarely better and has cracks everywhere; **Clip tangent planes** has perfect facets but no shared edges.
- **The fandisk is hard for everyone**: features closer together than a few sample spacings bound the tangent balls (a quarter are smaller than 0.18, about two spacings), and they make the plane-intersection methods name wrong triples.

## 4. Parameters

In the viewer, "Recommended settings on method change" (on by default) applies these defaults when the method changes. The plane-intersection methods share one preset, including Extend own faces: smaller `s` reduces its hole edges somewhat (torus, near-surface: 11 at 0.1, 6 at 0.03), but at `s ≤ 0.03` the near-surface box and cylinder get vertices more than 1.0 off.

| parameter | used by | default | effect |
|---|---|---|---|
| sphere scale `s` | 1, 2, 3, 5 | 0.1 | Changes only the steps. Extend wants `s → 0` (open edges on the torus: 1328 at `s = 1`, 84 at 0.1); Contract and Triangulate are best at 0.1–1; below about 0.01 the absolute tolerance and nearest-tangent ties add hole edges. |
| dependent planes `tau` | 1, 2, 3, 5 | `10⁻¹²` | Exact: keeps the box exact. `10⁻²` improves smooth shapes (Triangulate on the torus: 14 → 9 off) but rounds sharp corners (box: 16 off). The window `(κh)² ≪ tau ≪ tan²(θ_feature/2)` has no universal setting. |
| trust radius | 1, 2, 3, 5 | 2 | Required with exact `tau`: without it the torus reaches 13.8 (Triangulate) or 615 (Contract). 1 cuts box corners (59 off); 4 lets more extrapolation error in. |
| ball size `ρ`, cap | 4 | 0.5, 100 | Steps shrink like `1/cap` on convex parts (median step `9·10⁻⁶` at cap 100 against `4·10⁻³` for Voronoi). `ρ < 1` keeps other tangent points strictly outside the balls. |
| chamfer, stitch | 3, 5 | on | Chamfers make facets exactly planar (off-plane `10⁻¹³` instead of 0.008 on the torus) at the cost of extra faces. |
| snap, gap faces | 4 | off | Snap halves the off-plane distance; gap faces make facets planar but expose gaps as wide as the steps. |

## 5. What to keep

Back to the goal: facets on tangent planes, each containing its tangent point, tiling the shape and sharing edges. Each approach contributes one clean idea, about either connectivity or geometry.

**Geometry is free once connectivity is right.** If each facet lies exactly in its plane and every vertex is shared by three facets, every vertex is forced to be `P_a ∩ P_b ∩ P_c`: there is nothing left to optimize. So vertex optimization has room only where the model is relaxed: soft planarity (Merge's snap), vertices shared by more than three facets (least squares), or merged facets. **The real problem is choosing the dual triangulation**, and a good triangulation is one whose triple points are near, whose edges are not inverted, and whose facets contain their tangent points.

The best parts of each method:

- **The power contour, sphere scale and tangent balls: exact seed facets.** The bisector of any sphere tangent at `t_a` and `t_a` itself is `P_a`, so every diagram of this kind contains, for free, a polygon in each tangent plane containing its tangent point. Everything else is "steps".
- **Contract contour regions: always a valid tiling.** Painting the contour by nearest tangent point gives a partition that is closed by construction, with a complete set of topology cases. It is the right fallback and the right tie-break where planes coincide, and a safe starting triangulation, but it is isotropic.
- **Extend own faces: a negative result worth stating.** Adjacency must be decided once, on a shared structure (a partition or a dual triangulation); per-face decisions leave cracks.
- **Triangulate step patches: the planes decide the connectivity.** Convex and concave edges are read from data alone (`f_a(t_b) + f_b(t_a)`); envelopes are regular triangulations of the planes; saddles are lattice (max–min) polyhedra with a two-way decider. Step patches localize the decision into small polygon triangulation problems that a dynamic program solves exactly.
- **Tangent balls: the right connectivity on developable and flat parts, from the diagram itself.** Large empty tangent balls flatten steps like `1/λ`, so the diagram's regions follow the envelope, including strips along rulings that no plane-intersection method builds. The impossibility result (no generator puts `P_a ∩ P_b` in the walls) explains why a combinatorial step is always needed after the diagram.
- **Collapse and flip: plane-only predicates.** The `4 × 4` determinant `D4` decides envelope flips without computing a triple point and works at infinity; the signed length of an edge along `P_p ∩ P_q` detects folds; coplanar facets merge, so a facet can own many tangent points. These are the local validity tests that a connectivity search needs.
- **Vertex placement: a validity guard, not a fix.** The trust region and the `Q`-circumcenter analysis explain far vertices as wrong combinatorics.

**Toward a tiling by tangent-plane facets**, the pieces combine naturally, and the following are untried:

1. **Tangent-ball connectivity with plane geometry.** Merge gets the connectivity right on convex, concave, flat and developable parts but its geometry is off-plane; Collapse and flip gets exactly planar geometry but inherits isotropic connectivity. Take the adjacency of Merge's regions as the dual triangulation, place vertices at triple points, and then apply Collapse and flip. Strip–strip–strip junctions (three parallel planes) would still need collapsing into longer strips.
2. **Containment as a test.** For a convex edge `a–b`, facet `a` lies where `f_b ≤ 0`, so `t_a` is on the right side of that edge iff `f_b(t_a) ≤ 0`; for a concave edge, iff `f_b(t_a) ≥ 0`. A pair with `f_a(t_b)` and `f_b(t_a)` of opposite signs therefore cannot share an edge with both tangent points inside their facets. This is a data-only, per-edge admissibility test, and none of the methods uses it yet; it could join the flip cost or veto edges.
3. **Anisotropic Delaunay of the tangent points.** Estimate `Q` (the second fundamental form) from neighboring normals and build the Delaunay triangulation in that metric. By the `Q`-circumcenter identity it minimizes the vertex error on definite patches, and where `Q` degenerates (developable parts) it yields the strip ladder directly.
4. **Global search over triangulations.** Local flips stall on ties (cylinder) and on mixed quads (saddles). A global objective over the dual triangulation (far vertices + inverted edges + containment), searched by annealing or seeded from several starts (partition, tangent-ball regions), would not stall at the first local minimum.
5. **The samples' empty spheres as a constraint.** No surface point lies inside a sample's sphere `B(p, |d|)`, so a vertex inside one is at least that deep off the surface. On the near-surface fandisk this test catches 16 of 67 bad vertices with 2 false alarms in 2791, without knowing the surface.
6. **Soft optimization after connectivity is fixed.** Minimize `Σ f_a(x)²` over each facet's vertices plus hinge penalties for containment and edge orientation, with a small pull toward the contour vertices. This is where the "optimize polygon vertices" idea belongs: at vertices of degree four or more and where planes are nearly dependent.

## References

F. Aurenhammer, Power diagrams: properties, algorithms and applications, *SIAM J. Computing* 16(1), 1987. N. Amenta, S. Choi and R. K. Kolluri, The power crust, *ACM Symposium on Solid Modeling and Applications*, 2001. H. Fuchs, Z. M. Kedem and S. P. Uselton, Optimal surface reconstruction from planar contours, *Communications of the ACM* 20(10), 1977. G. T. Klincsek, Minimal triangulations of polygonal domains, *Annals of Discrete Mathematics* 9, 1980. G. M. Nielson and B. Hamann, The asymptotic decider: resolving the ambiguity in marching cubes, *IEEE Visualization*, 1991. S. Ovchinnikov, Max-min representation of piecewise linear functions, *Beiträge zur Algebra und Geometrie* 43(1), 2002.
