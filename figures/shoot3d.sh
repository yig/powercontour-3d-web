#!/bin/bash
# 3D illustrations for RECOVERY.md: `bash figures/shoot3d.sh` writes figures/*.png.
# Each shot opens a copy of index.html with the panel hidden and the controls set from the URL
# hash, in headless Chrome. Needs Google Chrome; macOS path below. ONLY=regex shoots only the
# matching names. The fandisk shots read the mesh from $FANDISK (skipped if it does not exist).
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
    if (id === 'cam') { camera.position.set(...v); continue; }
    if (id === 'obj') continue;
    const el = $(id); if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  $('panel').style.display = 'none';
  if (cfg.obj) { // an OBJ file next to the page's copy: read it synchronously (file:// allows XHR here)
    const x = new XMLHttpRequest(); x.open('GET', cfg.obj, false); x.send(); loadOBJ(x.responseText, cfg.obj);
  } else { showObjRow(); compute(); }
  buildTransparent(); applyVisuals();
}
'''
open(sys.argv[1], 'w').write(s[:i] + hook + s[i:])
PY
shot() { # name width height json
  if [ -n "$ONLY" ] && ! [[ "$1" =~ $ONLY ]]; then return; fi
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
# Collapse and flip (RECOVERY.md, Approach 5): the torus as above, a capped cylinder and the fandisk,
# near-surface samples.
shot torus-collapse 480 400 "{$REC, \"shape\": \"torus\", \"recMethod\": \"collapse\"}"
NEAR="$REC, \"sampling\": \"band\", \"cam\": [1.6, -2.2, 1.9]"
shot cylinder-patches 480 400 "{$NEAR, \"shape\": \"cylinder\", \"recMethod\": \"patches\"}"
shot cylinder-collapse 480 400 "{$NEAR, \"shape\": \"cylinder\", \"recMethod\": \"collapse\"}"
FANDISK="${FANDISK:-../../code-release/examples/fandisk.obj}"
if [ -f "$FANDISK" ]; then
  command cp -f "$FANDISK" .fandisk.obj
  FAN="$REC, \"sampling\": \"band\", \"obj\": \".fandisk.obj\", \"cam\": [-1.7, -2.0, 1.5]"
  shot fandisk-regions 480 400 "{$FAN, \"recMethod\": \"regions\"}"
  shot fandisk-patches 480 400 "{$FAN, \"recMethod\": \"patches\"}"
  shot fandisk-collapse 480 400 "{$FAN, \"recMethod\": \"collapse\"}"
  command rm -f .fandisk.obj
fi
rm -f "$TMP"
