# Recovering a surface from the power contour

This note describes the structure of the power contour of samples plus tangent points, and two ways to turn it into a surface with one face per tangent point: *Contract contour regions* and *Extend own faces*. Code: `recover.js` (`recoverSurface`, `extendOwnFaces`, `qefTruncated`). A third method, *Clip tangent planes*, is described in `ARCHITECTURE.md`.

## Setup

For each sample `p_a` with SDF value `d_a ≠ 0`:

- the **tangent point** `t_a` is its closest surface point, and `n_a = (p_a − t_a) / d_a` is the outward unit normal there (the SDF gradient);
- the **tangent plane** is `P_a = { x : f_a(x) = 0 }` with `f_a(x) = n_a · (x − t_a)`;
- the sample is a site with weight `d_a²` (a sphere of radius `|d_a|` that touches the surface at `t_a`) and sign `sign(d_a)`;
- the tangent point is a site with weight 0 and the opposite sign.

The trusted data are `t_a`, `n_a`, and the sign of `d_a`. The power contour is the set of faces between a `+` cell and a `−` cell. Each site has an *owner*: the sample it comes from.

## Structure

**1. The bisector of a sample and its tangent point is the tangent plane.** With `p = t + d n`:

```
π_p(x) − π_t(x) = |x − p|² − d² − |x − t|² = −2 d · n·(x − t) = −2 d · f(x).
```

This holds for any sphere tangent to `P_a` at `t_a`, whatever its radius. That is what makes the sphere scale below possible.

**2. Super cells and own faces.** The two cells of owner `a` together form a *super cell* `C_a`. Inside `C_a`, the boundary between them is exactly where their powers are equal, which is `P_a`. So the **own face** is

```
F_a = P_a ∩ C_a,
```

a convex polygon lying exactly in the tangent plane. There is exactly one per tangent point, and it contains `t_a`: at `t_a` both sites have power 0, and every other site has positive power (for an exact SDF, `t_a` is outside every other sample's sphere).

**3. Steps.** Every other contour face lies on a wall between two super cells `C_a` and `C_b`. On the wall, `P_a` and `P_b` cut two different lines; the step is the region between them (a double wedge with its apex where the line `P_a ∩ P_b` crosses the wall). Steps exist because neighboring tangent planes do not meet on the wall.

**4. Own faces never share an edge** (generically). A corner of `F_a` is a power-diagram vertex with four cells, two of which belong to `a`, so it touches at most three owners. An edge of `F_a` has a third cell from another owner, so across it is a step. The exception is a degenerate configuration: on a sphere, by symmetry, `P_a ∩ P_b` lies exactly in the bisector, so there are no steps and the contour already is the tangent-plane polyhedron.

**5. The goal.** Eliminate the steps: extend each own face in its plane until it meets its neighbors' planes. The result has one face per tangent point, edges on the lines `P_a ∩ P_b`, and vertices at the points `P_a ∩ P_b ∩ P_c`. Equivalently, move the walls between super cells so they contain the lines `P_a ∩ P_b`. Then the function `F(x) = f_{a(x)}(x)`, where `a(x)` is the super cell containing `x`, becomes continuous, and its zero set is watertight.

**6. The dual view.** In the regular (weighted Delaunay) triangulation, contour faces are edges between a `+` site and a `−` site. Eliminating the steps means collapsing the edge between each sample and its tangent point. An edge collapse keeps a valid surface only when the link condition holds. Wide steps, which touch several different owners along their length, violate it. They come from large sample spheres, whose cells reach far.

## Sphere scale `s`

Move each sample toward its tangent point and shrink its sphere so it stays tangent there:

```
p_a(s) = t_a + s (p_a − t_a),   weight (s d_a)².
```

By (1), the own face of every tangent point is unchanged for every `s`; only the steps change. The data `t_a`, `n_a`, `sign(d_a)` are untouched. Since `π_{p(s)}(x) − π_t(x) = −2 s d f(x)`, the super cells converge as `s → 0` to the Voronoi cells of the tangent points, each split by its tangent plane. The steps become thin: their height is set by how far neighboring planes miss each other on the Voronoi bisector, about `κh²` for curvature `κ` and spacing `h`.

## Approach 1: Contract contour regions (`recoverSurface`)

Each step is given to one of its two owners, so the contour is partitioned into one region per tangent point.

1. Weld the contour's vertices (each cell computes its own copy). Label each own face with its owner. Label each step with whichever of its two owners has the nearer tangent point (measured from the face's centroid).
2. Clean up so each region is one connected piece containing its own face. A stray component goes to its other owner, or else to its most common neighboring region. A region enclosed by a single other region is merged into it.
3. Output vertices: contour vertices where three or more regions meet, placed where those regions' tangent planes meet (see *Vertex placement*).
4. Output faces: each region's boundary loop on the contour, keeping only the output vertices on it. A region whose boundary is not one simple loop, or has fewer than three output vertices, leaves a hole (reported as a non-disc region).

Because the regions tile the contour, neighboring faces share their boundary and vertices by construction, so cracks only appear at non-disc regions. The nearest-tangent-point rule already imposes Voronoi locality on the regions, which is why this method depends little on `s`.

## Approach 2: Extend own faces (`extendOwnFaces`)

Steps are not assigned to anyone; each own face is extended from its own boundary.

1. Walk around `F_a`. Each edge borders a step toward one neighbor `b`: the owner of the third cell at that edge.
2. A run of edges facing the same `b` becomes part of the line `P_a ∩ P_b`.
3. A switch from neighbor `b` to neighbor `c` happens at a corner whose four cells are two of `a`'s, one of `b`'s and one of `c`'s. It becomes the vertex `P_a ∩ P_b ∩ P_c`, keyed by the triple `{a, b, c}` and so shared with faces `b` and `c` if they see the same triple.
4. *Flips.* Where four owners meet nearly at one point, the faces can disagree about which diagonal is an edge, so a triple is seen by fewer than its three faces. Incomplete triples linked by sharing two owners are merged into one vertex where all of their planes meet, if they involve at most four owners ("Merge flipped junctions"). Other disagreements leave cracks.

This is the most literal form of "one face per tangent point, eliminate the rest", but because each face decides its neighbors alone, it leaves more cracks than the partition. It depends strongly on `s`: large spheres make wide steps, whose far ends are seen differently by different faces.

## Vertex placement (`qefTruncated`)

A vertex shared by regions or faces `a, b, c, …` minimizes `Σ (n_k·x − n_k·t_k)²`. With exact tangent data there is no noise, so the minimizer is the exact intersection of the planes when they are independent. When the planes are dependent (coplanar faces of the box: `Σ n nᵀ` has rank 1; nearly coplanar normals), there is no unique intersection. Writing `A = Σ n nᵀ`, eigenvalues of `A` below `tau · λ_max` are dropped, and the vertex keeps its contour position `m` in those directions: `x = m + A⁺_τ (r − A m)`. The viewer's "Dependent planes, log₁₀" slider sets `tau` (default `10⁻²`).

For two planes at angle `θ`, the eigenvalue ratio is `tan²(θ/2)`, so `tau = 10⁻²` means planes closer than about 11° are treated as one plane.

## Is there an ideal `s` and `tau`?

Both theory and experiments. Experiments: 1500 uniform random samples, seed 1; "see-through" counts rays from outside to an interior point that cross no face (out of 400); true areas are torus 8.88, two spheres 6.91, box 6.64.

### Sphere scale: it depends on the method

**Theory.** By (1), `s` changes only the steps, and `s → 0` gives the Voronoi cells of the tangent points: the restricted-Delaunay neighborhood that surface reconstruction theory works with. Larger `s` lets far samples' big spheres make wide steps. Two things limit how far toward 0 to go:

- *Numerical precision.* `powerdiagram.js` decides inside/outside with an absolute tolerance of `1e-10` on `2(p_j − p_i)·x − c`, and for a sample and its own tangent point `|p_j − p_i| = s|d|`. So the tangent plane is resolved only to about `1e-10 / (2 s |d|)`, which grows as `1/s`. A tolerance relative to `|p_j − p_i|` would push this floor lower.
- *Ties in the partition.* As `s → 0`, each step lies on the Voronoi bisector of its two owners, so the partition's rule (give the step to the owner with the nearer tangent point) becomes a tie, decided by rounding. Extend own faces has no such rule.

**Experiments.** Contract contour regions, `tau = 10⁻²`:

| `s` | 1 | 0.1 | 0.01 | 10⁻³ | 10⁻⁴ | 10⁻⁵ | 10⁻⁶ |
|---|---|---|---|---|---|---|---|
| torus: open edges | 0 | 8 | 13 | 20 | 100 | 670 | 2066 |
| torus: see-through | 0 | 0 | 1 | 1 | 2 | 27 | 113 |
| two spheres: open edges | 0 | 0 | 0 | 51 | 299 | 1288 | 1319 |
| two spheres: see-through | 0 | 0 | 0 | 3 | 22 | 162 | 329 |

With 300 samples the partition prefers smaller `s`: hole edges at `s = 1` vs `0.1` are 14 vs 0 on the two spheres and 18 vs 0 on the box.

Extend own faces depends on `s` much more strongly. On the torus it has 50 see-through rays and 1328 open edges at `s = 1`, against 2 and 84 at `s = 0.1`, and 0 and 15 at `s = 0.01`. Collapsing each owner's two sites into one is valid where every owner pair ends up at exactly two vertices; on the torus, the number of pairs that do not drops from 3483 at `s = 1` to 203 at `s = 0.01`.

So the ideal is the limit `s → 0` for Extend own faces, as far as the arithmetic allows (about `0.01` with the current tolerance). Contract contour regions is less sensitive and does best around `s = 0.1–1`, degrading slowly below that because of the ties. `s = 0.1` is a good setting for both.

### Dependent planes: not a precision parameter

**Theory.** An exact intersection of three exact tangent planes is the right vertex only if those three faces really are adjacent in the arrangement of the planes. The contour's adjacency is isotropic (Voronoi-like). The plane arrangement's is not: on saddles, and near curves of zero Gaussian curvature such as the torus's top and bottom circles, neighboring normals lie nearly on one great circle, and the true intersection of three neighboring planes can be far away. Where the two disagree, the exact intersection is a spike. On smooth parts, three neighboring normals differ by about `κh`, so the eigenvalue ratio of `Σ n nᵀ` is of order `(κh)²` times a small shape factor. At real features (box edges and corners, the two-sphere crease at 110°) it is of order 1. So `tau` is a threshold between curvature-scale and feature-scale normal changes: it should satisfy roughly `(κh)² ≪ tau ≪ tan²(θ_feature / 2)`. That window widens as sampling gets denser, but at a fixed density there is no setting that is right "up to numerical precision".

**Experiments.** Contract contour regions, `s = 0.1`:

| | `tau = 10⁻¹²` (exact) | `tau = 10⁻²` |
|---|---|---|
| torus: vertices off by > 0.02 | 277, max 615 | 26, max 0.08 |
| torus: area | 41.9 | 9.03 |
| two spheres: max error, area | 1.24, 8.83 | 0.032, 6.95 |
| box: vertices off by > 0.02, area | 0, 6.64 (exact) | 16, 6.68 |

The box wants exact intersections (its planes are exactly coplanar or exactly orthogonal), the curved shapes do not.

The eigenvalue ratios confirm that there is no clean threshold on smooth parts. With exact intersections, the torus vertices that fly off have ratios with median `6·10⁻⁶` but up to `4·10⁻²`, while the good ones have median `1.6·10⁻⁴`. On the two spheres, the bad ones (median `5·10⁻³`) are better conditioned than the good ones (`6.6·10⁻⁴`). So the remaining outliers are combinatorial, not numerical, and `tau = 10⁻²` works by switching plane intersection off on nearly all smooth parts (where the contour vertex is as accurate, both errors being `O(κh²)`) and keeping it at features.

A principled replacement for `tau` would take the combinatorics from the plane arrangement itself near each vertex (which faces the local envelope of the planes makes adjacent), instead of from the contour.

## Results

1500 samples, `s = 0.1`, `tau = 10⁻²`:

| | torus, uniform | two spheres, uniform | torus, near surface |
|---|---|---|---|
| Contract contour regions | see-through 0, area 9.03, 26 vertices off > 0.02 | see-through 0 (and 0 of 600 through the crease band), area 6.95, max error 0.032 | see-through 0, 0 open edges, 0 off, area 8.96 |
| Extend own faces | see-through 2, area 8.99, 22 off | see-through 0 (0 of 600 through the crease), area 6.99 | see-through 0, area 8.96 |

## Open problems

- Non-disc regions (partition) and cracks (extension) at sparse sampling.
- Outliers where the contour's adjacency does not match the plane arrangement (see above).
- The absolute tolerance in `powerdiagram.js` limits how small `s` can be.
