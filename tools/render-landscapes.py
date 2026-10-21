import json, math, os
from PIL import Image, ImageDraw
lands = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'out', 'lands.json')))
N = 128; S = 4
for L in lands:
    elev, chan, lake, veg, slope = L['elev'], L['chan'], L['lake'], L['veg'], L['slope']
    img = Image.new('RGB', (N * S, N * S + 28), (240, 240, 235))
    px = img.load()
    for y in range(N):
        for x in range(N):
            c = y * N + x
            # hillshade from the northwest
            ex = elev[y * N + min(x + 1, N - 1)] - elev[y * N + max(x - 1, 0)]
            ey = elev[min(y + 1, N - 1) * N + x] - elev[max(y - 1, 0) * N + x]
            shade = max(0.35, min(1.25, 1 - (ex + ey) / 60))
            v = veg[c]
            base = (int(214 - 120 * v), int(200 - 60 * v), int(150 - 90 * v))  # tan grass → dark green forest
            if slope[c] > 0.35: base = (150, 140, 130)
            col = tuple(max(0, min(255, int(b * shade))) for b in base)
            if lake[c]: col = (90, 140, 190)
            elif chan[c]: col = [(110, 160, 205), (70, 125, 195), (40, 95, 180)][chan[c] - 1]
            for dy in range(S):
                for dx in range(S):
                    px[x * S + dx, y * S + dy] = col
    d = ImageDraw.Draw(img)
    f = L['features']
    for h in f['hills']:
        x, y = h['x'] * S + 2, h['y'] * S + 2
        d.polygon([(x, y - 6), (x - 5, y + 4), (x + 5, y + 4)], outline=(60, 40, 20), fill=(200, 170, 120))
    for wf in f['waterfalls']:
        x, y = wf['x'] * S + 2, wf['y'] * S + 2
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 255), outline=(20, 60, 140))
    for sp in f['springs']:
        x, y = sp['x'] * S + 2, sp['y'] * S + 2
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(0, 200, 220))
    if L['spawn']:
        x, y = L['spawn']['x'] * S + 2, L['spawn']['y'] * S + 2
        pts = [(x + 9 * math.cos(a * math.pi / 5 - math.pi / 2) * (1 if a % 2 == 0 else 0.45), y + 9 * math.sin(a * math.pi / 5 - math.pi / 2) * (1 if a % 2 == 0 else 0.45)) for a in range(10)]
        d.polygon(pts, fill=(200, 30, 30), outline=(255, 255, 255))
    # scale bar: 1 km = 12.8 cells
    y0 = N * S + 8
    d.rectangle([10, y0, 10 + int(12.8 * S), y0 + 5], fill=(30, 30, 30))
    d.text((10 + int(12.8 * S) + 6, y0 - 3), f"1 km   {L['seed']}: {L['biome']}, local relief {L['A']} m", fill=(30, 30, 30))
    img.save(os.path.join(os.path.dirname(__file__), '..', 'out', f"landscape-{L['seed']}.png"))
print('rendered', [L['seed'] for L in lands])
