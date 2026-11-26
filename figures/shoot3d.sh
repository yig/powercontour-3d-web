#!/bin/bash
# 3D illustrations for RECOVERY.md: `bash figures/shoot3d.sh` writes figures/*.png.
# Each shot opens a copy of index.html with the panel hidden and the controls set from the URL
# hash, in headless Chrome. Needs Google Chrome; macOS path below.
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP=.shoot3d.html
python3 - "$TMP" <<'PY'
import sys
s = open('index.html').read()
i = s.rindex('</script>')
hook = r'''
// Screenshot hook (figures/shoot3d.sh): set controls from the hash, hide the panel, recompute.
{
  const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  for (const [id, v] of Object.entries(cfg)) {
    if (id === 'cam' || id === 'obj') { if (id === 'cam') camera.position.set(...v); continue; }
    const el = $(id); if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  $('panel').style.display = 'none';
  // "obj": a file URL of a mesh to load (needs --allow-file-access-from-files); loadOBJ recomputes.
  if (cfg.obj) fetch(cfg.obj).then(r => r.text()).then(t => { loadOBJ(t, 'mesh'); buildTransparent(); applyVisuals(); });
  else { showObjRow(); compute(); buildTransparent(); applyVisuals(); }
}
'''
open(sys.argv[1], 'w').write(s[:i] + hook + s[i:])
PY
shot() { # name width height json
  "$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --allow-file-access-from-files \
    --hide-scrollbars --force-device-scale-factor=1 --window-size=$2,$3 --virtual-time-budget=120000 \
    --screenshot="figures/$1.png" "file://$PWD/$TMP#$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$4")" 2>/dev/null
  echo "wrote figures/$1.png"
}
BASE='"sampled": true, "tangent": true, "centers": false, "sphOp": 0, "bbox": false, "seed": 1, "sampling": "random", "cam": [1.9, -2.5, 1.8]'
REC="$BASE, \"pcOp\": 0, \"pcEdges\": false, \"recMethod\": \"regions\", \"sScale\": 0.1, \"npts\": 1500"

# The contour by face type: own faces (in tangent planes) and steps. Sliced to show the inside.
shot torus-contour 640 480 "{$BASE, \"shape\": \"torus\", \"npts\": 300, \"sScale\": 1, \"pcColorBy\": \"type\", \"pcOp\": 1, \"slice\": true, \"sliceZ\": 0}"
# Vertex placement on the torus: exact intersections, the old eigenvalue cutoff, the trust region.
shot torus-exact 480 400 "{$REC, \"shape\": \"torus\", \"eTau\": -12, \"eTrust\": 10}"
shot torus-tau 480 400 "{$REC, \"shape\": \"torus\", \"eTau\": -2, \"eTrust\": 10}"
shot torus-trust 480 400 "{$REC, \"shape\": \"torus\", \"eTau\": -12, \"eTrust\": 2}"
# The default on shapes with sharp features.
shot box-trust 480 400 "{$REC, \"shape\": \"box\"}"
shot twospheres-trust 480 400 "{$REC, \"shape\": \"twospheres\", \"cam\": [0.6, -2.4, 1.6]}"
# Triangulate step patches, same settings.
shot torus-patches 480 400 "{$REC, \"shape\": \"torus\", \"recMethod\": \"patches\"}"
shot box-patches 480 400 "{$REC, \"shape\": \"box\", \"recMethod\": \"patches\"}"
shot twospheres-patches 480 400 "{$REC, \"shape\": \"twospheres\", \"recMethod\": \"patches\", \"cam\": [0.6, -2.4, 1.6]}"
# Approach 4: tangent balls and Merge steps into faces. The contour by face type (compare torus-contour),
# then the merged surfaces with the default settings above (compare the trust and patches shots).
BALLS="$REC, \"balls\": true, \"recMethod\": \"merge\""
shot torus-balls-contour 640 480 "{$BASE, \"shape\": \"torus\", \"npts\": 300, \"balls\": true, \"pcColorBy\": \"type\", \"pcOp\": 1, \"slice\": true, \"sliceZ\": 0}"
shot torus-merge 480 400 "{$BALLS, \"shape\": \"torus\"}"
shot twospheres-merge 480 400 "{$BALLS, \"shape\": \"twospheres\", \"cam\": [0.6, -2.4, 1.6]}"
shot box-merge 480 400 "{$BALLS, \"shape\": \"box\", \"sampling\": \"band\"}"
# A developable surface: the capped cylinder, near-surface samples.
CYLS="\"shape\": \"cylinder\", \"sampling\": \"band\", \"cam\": [1.6, -2.2, 1.5]"
shot cylinder-patches 480 400 "{$REC, $CYLS, \"recMethod\": \"patches\"}"
shot cylinder-merge 480 400 "{$BALLS, $CYLS}"
# The fandisk (a CAD model: planes, cylinders, cones), near-surface samples, if the mesh is available.
FANDISK="${FANDISK:-$PWD/../../code-release/examples/fandisk.obj}"
if [ -f "$FANDISK" ]; then
  FAN="\"obj\": \"file://$FANDISK\", \"sampling\": \"band\", \"cam\": [1.7, -2.2, 1.6]"
  shot fandisk-patches 480 400 "{$REC, $FAN, \"recMethod\": \"patches\"}"
  shot fandisk-merge 480 400 "{$BALLS, $FAN}"
fi
rm -f "$TMP"
