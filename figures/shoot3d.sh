#!/bin/bash
# 3D illustrations for RECOVERY.md: `bash figures/shoot3d.sh` writes figures/*.png.
# Each shot opens a copy of index.html with the panel hidden and the controls set from the URL
# hash, in headless Chrome. Needs Google Chrome; macOS path below. ONLY=regex shoots only the
# matching names.
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
# Tangent balls: the contour by face type (compare torus-contour).
shot torus-balls-contour 640 480 "{$BASE, \"shape\": \"torus\", \"npts\": 300, \"balls\": true, \"pcColorBy\": \"type\", \"pcOp\": 1, \"slice\": true, \"sliceZ\": 0}"
# The comparison grid of RECOVERY.md: every shape (1500 uniform samples) by every method, with the
# raw power contour (colored by face type) with sample spheres and with tangent balls as the first columns. Shot names: cmp-<shape>-<method>.
CMP="$BASE, \"npts\": 1500, \"sampling\": \"random\", \"sScale\": 0.1, \"pcOp\": 0, \"pcEdges\": false"
FANDISK="${FANDISK:-$PWD/../../code-release/examples/fandisk.obj}"
HORSE="${HORSE:-$PWD/../../../paper-math-code/code/third_party/gpytoolbox/test/unit_tests_data/horse.obj}"
cmpshape() { # name "shape json fragment"
  shot cmp-$1-contour 480 400 "{$CMP, $2, \"recMethod\": \"off\", \"pcOp\": 1, \"pcColorBy\": \"type\", \"pcEdges\": true}"
  shot cmp-$1-ballcontour 480 400 "{$CMP, $2, \"balls\": true, \"recMethod\": \"off\", \"pcOp\": 1, \"pcColorBy\": \"type\", \"pcEdges\": true}"
  for m in regions extend patches collapse; do shot cmp-$1-$m 480 400 "{$CMP, $2, \"recMethod\": \"$m\"}"; done
  shot cmp-$1-merge 480 400 "{$CMP, $2, \"balls\": true, \"recMethod\": \"merge\"}"
  shot cmp-$1-ballplanes 480 400 "{$CMP, $2, \"balls\": true, \"recMethod\": \"ballplanes\"}"
}
cmpshape torus '"shape": "torus"'
cmpshape twospheres '"shape": "twospheres", "cam": [0.6, -2.4, 1.6]'
cmpshape box '"shape": "box"'
cmpshape cylinder '"shape": "cylinder", "cam": [1.6, -2.2, 1.5]'
[ -f "$FANDISK" ] && cmpshape fandisk "\"obj\": \"file://$FANDISK\", \"cam\": [1.7, -2.2, 1.6]"
[ -f "$HORSE" ] && cmpshape horse "\"obj\": \"file://$HORSE\", \"cam\": [3.6, -1.5, 0.9]"
rm -f "$TMP"
python3 figures/montage.py
