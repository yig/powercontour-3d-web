# Power contour viewer

An interactive 3D viewer for the *power contour* of points sampling a signed distance field (SDF).

Each sample point `p` with SDF value `d` becomes a weighted site: a sphere of radius `|d|`, signed by `d`. The viewer computes the power diagram of these sites, clipped to the box `[−1.5, 1.5]³`. The **power contour** is the set of faces between a positive cell and a negative cell, and it approximates the zero level set.

You can also add one **tangent point** per sample: the closest point on the surface, with weight 0 and the opposite sign. This pulls the contour much closer to the true surface.

## Running

There is no build step and no network access needed. Open `index.html` directly in a browser. three.js is in `vendor/`. To update it, run `node vendor/update-three.mjs [version]`.

## Controls

| Group | Control | Effect |
|---|---|---|
| Input | Shape | Sphere, box, torus, or a union of two spheres |
| | Sampling, Points, Seed | Uniform random, jittered grid, or regular grid; number of samples; random seed |
| | Add tangent points | Adds one tangent point per sample |
| Input spheres | Opacity, Show centers | Transparency of the `\|d\|` spheres (0 hides them); dots at the site positions |
| Power contour | Opacity, Show edges | Transparency of the contour; face outlines on or off |
| | Tint faces touching tangent points | Draws those faces in green |
| Reference | True surface | Opacity of the exact surface (0 hides it) |
| | Slice, Slice z | Hides everything above a horizontal plane, so you can see inside |
| | Show bounding box | Outline of the domain |

Red means `d > 0`, blue means `d < 0`, and the contour is gold. Drag to orbit, scroll to zoom, and right-drag to pan. The stats panel shows the number of sites, empty cells, contour faces, contour area and compute time.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): code structure, the math, and the clipping algorithm.
- [AGENTS.md](AGENTS.md): the original spec.
- Issues are tracked with [git-bug](https://github.com/git-bug/git-bug): `git bug bug`.
