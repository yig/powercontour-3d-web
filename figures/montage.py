# Compose the comparison grid of RECOVERY.md (figures/comparison.png) from the cmp-* shots of shoot3d.sh.
# `python3 figures/montage.py` (needs Pillow). Rows: shapes; columns: the raw contour, the five methods, and Idea 1.
import os
from PIL import Image, ImageDraw, ImageFont
os.chdir(os.path.dirname(os.path.abspath(__file__)))
ROWS = [('torus', 'Torus'), ('twospheres', 'Two spheres'), ('box', 'Box'), ('cylinder', 'Cylinder'), ('fandisk', 'Fandisk'), ('horse', 'Horse')]
COLS = [('contour', 'Power contour', 'sample spheres, s = 0.1'), ('ballcontour', 'Power contour', 'tangent balls'),
        ('regions', '1. Contract', 'contour regions'), ('extend', '2. Extend', 'own faces'),
        ('patches', '3. Triangulate', 'step patches'), ('merge', '4. Merge steps', 'tangent balls'),
        ('collapse', '5. Collapse', 'and flip'), ('ballplanes', 'Idea 1: ball', 'connectivity, planes')]
W, H, LW, TH = 300, 250, 120, 54
font = lambda s: ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', s)
im = Image.new('RGB', (LW + W * len(COLS), TH + H * len(ROWS)), (27, 29, 34))
d = ImageDraw.Draw(im)
for j, (_, a, b) in enumerate(COLS):
    x = LW + j * W + W // 2
    d.text((x, 18), a, fill=(235, 235, 235), font=font(20), anchor='mm')
    d.text((x, 40), b, fill=(170, 170, 175), font=font(16), anchor='mm')
for i, (key, label) in enumerate(ROWS):
    if not os.path.exists(f'cmp-{key}-contour.png'): continue
    d.text((LW // 2, TH + i * H + H // 2), label, fill=(235, 235, 235), font=font(18), anchor='mm')
    for j, (m, _, _) in enumerate(COLS):
        tile = Image.open(f'cmp-{key}-{m}.png').convert('RGB').crop((0, 0, 480, 400)).resize((W, H), Image.LANCZOS)
        im.paste(tile, (LW + j * W, TH + i * H))
im.save('comparison.png', optimize=True)
print('wrote figures/comparison.png')
