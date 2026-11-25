# Power contour viewer

An interactive 3D viewer for the *power contour* of points sampling a signed distance field (SDF).

**Live:** https://yig.github.io/powercontour-3d-web/

Each sample point `p` with SDF value `d` becomes a weighted site: a sphere of radius `|d|`, signed by `d`. The viewer computes the power diagram of these sites, clipped to the box `[−1.5, 1.5]³`. The **power contour** is the set of faces between a positive cell and a negative cell, and it approximates the zero level set.

You can also add one **tangent point** per sample: the closest point on the surface, with weight 0 and the opposite sign. This pulls the contour much closer to the true surface. The sampled points and the tangent points can each be switched on or off, so you can also look at the diagram of the tangent points alone.

## Recovered surface

*Intersect tangent planes* builds a polygon mesh with one face per sample, lying in its tangent plane. The power contour supplies the connectivity. The face between a sample and its own tangent point lies in that tangent plane. Every other contour face is given to the nearer of its two samples, and the resulting regions on the contour become the faces of the new mesh. Each vertex is where three or more tangent planes meet, so sharp edges and corners (the box, the two-sphere crease) come out sharp. Red outlines mark holes, where a region is not a disc. See `ARCHITECTURE.md`.

## Running

There is no build step and no network access needed. Open `index.html` directly in a browser. three.js is in `vendor/`. To update it, run `node vendor/update-three.mjs [version]`.

## Controls

| Group | Control | Effect |
|---|---|---|
| Input | Shape | Sphere, box, torus, or a union of two spheres |
| | Sampling, Points, Seed | Uniform random, jittered grid, regular grid, or near the surface (`\|d\| < 0.1`); number of samples; random seed |
| | Sampled points, Tangent points | Which sites go into the power diagram: the samples, their tangent points, or both |
| Input spheres | Opacity, Show centers | Transparency of the `\|d\|` spheres (0 hides them); dots at the site positions |
| Power contour | Opacity, Show edges | Transparency of the contour; face outlines on or off |
| | Face color | *Uniform* (gold), or *By face type*: colors each face by the two sites it separates, with a legend and counts. The types are sample–sample (gold), sample–own tangent (green), sample–other tangent (purple) and tangent–tangent (white). Only a green face contains its tangent point; the others are walls of a tangent cell, often far from the point |
| Recovered surface | Intersect tangent planes | Shows the recovered surface (needs sampled and tangent points) |
| Reference | True surface | Opacity of the exact surface (0 hides it) |
| | Slice, Slice z | Hides everything above a horizontal plane, so you can see inside |
| | Show bounding box | Outline of the domain |

Red means `d > 0`, blue means `d < 0`, and the contour is gold. Drag to orbit, scroll to zoom, and right-drag to pan. The stats panel shows the number of sites, empty cells, contour faces, contour area and compute time.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): code structure, the math, and the clipping algorithm.
- [AGENTS.md](AGENTS.md): the original spec.
- Issues are tracked with [git-bug](https://github.com/git-bug/git-bug): `git bug bug`.
