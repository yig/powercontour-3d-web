I want to visualize the power contour in 3D of a special setup. Given points sampling an SDF, compute the power diagram of the points using the absolute distance as the power value. The power contour is the faces separating cells belonging to positive and negative distance values. Also add, with a check box, the ability to add a paired "tangent point" for each input point. The tangent point is the closest point on the object to the input point; it has value 0 and opposite sign.

The viewer should allow me to vary the transparency of the input spheres and the transparency of the power contour itself and whether its edges are visible.

Make this run in in the web.

Document the architecture in a file. Commit to git after milestones. Use git bug for issues.
