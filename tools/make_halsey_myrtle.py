"""Generate two fonts: Halsey (a monospaced single-line sans) and Myrtle (the
same letters drawn as a coil, a looping telephone-cord line that runs along
each of Halsey's strokes).

    python tools/make_halsey_myrtle.py            # writes both, updates fonts.json
    python tools/make_halsey_myrtle.py --pitch 5 --radius 3.5

Glyphs are built from straight lines and elliptical arcs in font units
(origin on the baseline at the left of the cell, y up). Myrtle samples each
stroke and winds a circle of `radius` around it, one turn every `pitch`
units, so loops form wherever the pitch is shorter than the circle.
Edit the shapes in the editor afterwards like any other font; rerunning this
overwrites them.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'public', 'fonts')

W = 32          # glyph width
X = 36          # x-height
C = 60          # cap height and ascender
D = -18         # descender


# ------------------------------------------------------------------ paths

class Path:
    """A stroke: a list of segments ('L', p0, p1) or ('C', p0, c1, c2, p3)."""

    def __init__(self, x, y):
        self.start = (x, y)
        self.pos = (x, y)
        self.segs = []
        self.closed = False

    def L(self, x, y):
        self.segs.append(('L', self.pos, (x, y)))
        self.pos = (x, y)
        return self

    def A(self, cx, cy, rx, ry, a0, a1):
        """Elliptical arc from angle a0 to a1 (degrees, 0 = right, 90 = up),
        assumed to start where the pen is (a line is added if it doesn't)."""
        p0 = pt(cx, cy, rx, ry, a0)
        if dist(p0, self.pos) > 0.01:
            self.L(*p0)
        n = max(1, int(math.ceil(abs(a1 - a0) / 90.0)))
        step = (a1 - a0) / n
        for i in range(n):
            s, e = a0 + step * i, a0 + step * (i + 1)
            k = 4.0 / 3.0 * math.tan(math.radians(e - s) / 4.0)
            q0, q3 = pt(cx, cy, rx, ry, s), pt(cx, cy, rx, ry, e)
            d0 = (-rx * math.sin(math.radians(s)), ry * math.cos(math.radians(s)))
            d3 = (-rx * math.sin(math.radians(e)), ry * math.cos(math.radians(e)))
            c1 = (q0[0] + k * d0[0], q0[1] + k * d0[1])
            c2 = (q3[0] - k * d3[0], q3[1] - k * d3[1])
            self.segs.append(('C', q0, c1, c2, q3))
            self.pos = q3
        return self

    def Z(self):
        if dist(self.pos, self.start) > 0.01:
            self.L(*self.start)
        self.closed = True
        return self

    def d(self):
        out = ['M%s,%s' % (num(self.start[0]), num(self.start[1]))]
        for s in self.segs:
            if s[0] == 'L':
                out.append('L%s,%s' % (num(s[2][0]), num(s[2][1])))
            else:
                out.append('C%s,%s %s,%s %s,%s' % tuple(num(v) for v in (s[2][0], s[2][1], s[3][0], s[3][1], s[4][0], s[4][1])))
        if self.closed:
            out.append('Z')
        return ''.join(out)


def pt(cx, cy, rx, ry, a):
    r = math.radians(a)
    return (cx + rx * math.cos(r), cy + ry * math.sin(r))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def num(v):
    v = round(v, 2)
    if v == int(v):
        return str(int(v))
    return ('%.2f' % v).rstrip('0').rstrip('.')


def line(*pts):
    p = Path(*pts[0])
    for q in pts[1:]:
        p.L(*q)
    return p


def ellipse(cx, cy, rx, ry):
    # starts at the top and goes anticlockwise, like a hand would
    return Path(*pt(cx, cy, rx, ry, 90)).A(cx, cy, rx, ry, 90, 450).Z()


def arc(cx, cy, rx, ry, a0, a1):
    return Path(*pt(cx, cy, rx, ry, a0)).A(cx, cy, rx, ry, a0, a1)


def dot(x, y):
    return line((x, y), (x, y + 0.5))      # round ends make it a dot


# ------------------------------------------------------------------ Halsey

def halsey():
    g = {}
    bowl = lambda: ellipse(16, 18, 16, 18)

    # lowercase
    g['a'] = [bowl(), line((32, X), (32, 0))]
    g['b'] = [line((0, C), (0, 0)), bowl()]
    g['c'] = [arc(16, 18, 16, 18, 40, 320)]
    g['d'] = [bowl(), line((32, C), (32, 0))]
    g['e'] = [Path(0, 18).L(32, 18).A(16, 18, 16, 18, 0, 320)]
    g['f'] = [Path(12, 0).L(12, 48).A(22, 48, 10, 12, 180, 20), line((2, X), (28, X))]
    g['g'] = [bowl(), Path(32, X).L(32, -4).A(16, -4, 16, 14, 0, -165)]
    g['h'] = [line((0, C), (0, 0)), Path(0, 20).A(16, 20, 16, 16, 180, 0).L(32, 0)]
    g['i'] = [line((8, X), (16, X), (16, 0)), line((4, 0), (28, 0)), dot(16, 49)]
    g['j'] = [Path(10, X).L(20, X).L(20, -6).A(10, -6, 10, 12, 0, -160), dot(20, 49)]
    g['k'] = [line((2, C), (2, 0)), line((30, X), (2, 12)), line((11, 19.71), (32, 0))]   # leg starts on the arm
    g['l'] = [line((6, C), (16, C), (16, 0)), line((4, 0), (28, 0))]
    g['m'] = [line((0, X), (0, 0)),
              Path(0, 26).A(8, 26, 8, 10, 180, 0).L(16, 0),
              Path(16, 26).A(24, 26, 8, 10, 180, 0).L(32, 0)]
    g['n'] = [line((0, X), (0, 0)), Path(0, 20).A(16, 20, 16, 16, 180, 0).L(32, 0)]
    g['o'] = [bowl()]
    g['p'] = [line((0, X), (0, D)), bowl()]
    g['q'] = [bowl(), line((32, X), (32, D))]
    g['r'] = [line((4, X), (4, 0)), Path(4, 18).A(20, 18, 16, 18, 180, 55)]
    g['s'] = [arc(16, 27, 14, 9, 15, 270).A(16, 9, 16, 9, 90, -160)]
    g['t'] = [Path(12, 52).L(12, 8).A(22, 8, 10, 8, 180, 300), line((2, X), (28, X))]
    g['u'] = [Path(0, X).L(0, 16).A(16, 16, 16, 16, 180, 360), line((32, X), (32, 0))]
    g['v'] = [line((0, X), (16, 0), (32, X))]
    g['w'] = [line((0, X), (8, 0), (16, 28), (24, 0), (32, X))]
    g['x'] = [line((0, X), (32, 0)), line((32, X), (0, 0))]
    g['y'] = [line((0, X), (16, 0)), line((32, X), (8, D))]
    g['z'] = [line((0, X), (32, X), (0, 0), (32, 0))]

    # capitals
    g['A'] = [line((0, 0), (16, C), (32, 0)), line((4.8, 18), (27.2, 18))]
    g['B'] = [Path(0, 0).L(0, C).L(16, C).A(16, 46, 14, 14, 90, -90).L(0, 32),
              Path(16, 32).A(16, 16, 16, 16, 90, -90).L(0, 0)]
    g['C'] = [arc(16, 30, 16, 30, 40, 320)]
    g['D'] = [Path(0, 0).L(0, C).L(4, C).A(4, 30, 28, 30, 90, -90).L(0, 0)]
    g['E'] = [line((32, C), (0, C), (0, 0), (32, 0)), line((0, 32), (24, 32))]
    g['F'] = [line((32, C), (0, C), (0, 0)), line((0, 32), (24, 32))]
    g['G'] = [arc(16, 30, 16, 30, 40, 360).L(18, 30)]
    g['H'] = [line((0, 0), (0, C)), line((32, 0), (32, C)), line((0, 32), (32, 32))]
    g['I'] = [line((16, 0), (16, C)), line((6, C), (26, C)), line((6, 0), (26, 0))]
    g['J'] = [Path(14, C).L(32, C).L(32, 16).A(16, 16, 16, 16, 0, -180)]
    g['K'] = [line((0, 0), (0, C)), line((32, C), (0, 22)), line((10, 33.9), (32, 0))]
    g['L'] = [line((0, C), (0, 0), (32, 0))]
    g['M'] = [line((0, 0), (0, C), (16, 20), (32, C), (32, 0))]
    g['N'] = [line((0, 0), (0, C), (32, 0), (32, C))]
    g['O'] = [ellipse(16, 30, 16, 30)]
    g['P'] = [Path(0, 0).L(0, C).L(16, C).A(16, 45, 16, 15, 90, -90).L(0, 30)]
    g['Q'] = [ellipse(16, 30, 16, 30), line((18, 12), (32, -4))]
    g['R'] = [Path(0, 0).L(0, C).L(16, C).A(16, 44, 16, 16, 90, -90).L(0, 28), line((16, 28), (32, 0))]
    g['S'] = [arc(16, 45, 14, 15, 25, 270).A(16, 15, 16, 15, 90, -155)]
    g['T'] = [line((0, C), (32, C)), line((16, C), (16, 0))]
    g['U'] = [Path(0, C).L(0, 16).A(16, 16, 16, 16, 180, 360).L(32, C)]
    g['V'] = [line((0, C), (16, 0), (32, C))]
    g['W'] = [line((0, C), (6, 0), (16, 40), (26, 0), (32, C))]
    g['X'] = [line((0, C), (32, 0)), line((32, C), (0, 0))]
    g['Y'] = [line((0, C), (16, 30), (32, C)), line((16, 30), (16, 0))]
    g['Z'] = [line((0, C), (32, C), (0, 0), (32, 0))]

    # figures
    g['0'] = [ellipse(16, 30, 16, 30), line((24, 46), (8, 14))]
    g['1'] = [line((6, 48), (18, C), (18, 0)), line((6, 0), (30, 0))]
    g['2'] = [arc(16, 44, 15, 16, 160, -40).L(0, 0).L(32, 0)]
    g['3'] = [arc(16, 45, 14, 15, 150, -90).A(16, 15, 16, 15, 90, -150)]
    g['4'] = [line((24, 0), (24, C), (0, 16), (32, 16))]
    g['5'] = [Path(30, C).L(4, C).L(2.6, 32).A(15, 19, 17, 19, 137, -150)]
    g['6'] = [ellipse(16, 18, 16, 18), Path(0, 18).L(0, 40).A(16, 40, 16, 20, 180, 40)]
    g['7'] = [line((0, C), (32, C), (10, 0))]
    g['8'] = [ellipse(16, 45, 14, 15), ellipse(16, 15, 16, 15)]
    g['9'] = [ellipse(16, 42, 16, 18), Path(32, 42).L(32, 20).A(16, 20, 16, 20, 0, -140)]
    return g


# ------------------------------------------------------------------ Myrtle (the coil)

def sample(path, step):
    """Points (and tangents) along a path, about `step` apart."""
    pts = []
    for s in path.segs:
        if s[0] == 'L':
            p0, p1 = s[1], s[2]
            n = max(1, int(math.ceil(dist(p0, p1) / step * 4)))
            for i in range(n):
                t = i / float(n)
                pts.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
        else:
            p0, c1, c2, p3 = s[1:]
            approx = dist(p0, c1) + dist(c1, c2) + dist(c2, p3)
            n = max(2, int(math.ceil(approx / step * 4)))
            for i in range(n):
                t = i / float(n)
                mt = 1 - t
                pts.append((mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p3[0],
                            mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p3[1]))
    end = path.segs[-1][-1] if path.segs else path.start
    pts.append(end)
    # drop repeats
    out = [pts[0]]
    for p in pts[1:]:
        if dist(p, out[-1]) > 1e-6:
            out.append(p)
    return out


def coil(path, radius, pitch, per_turn=8):
    pts = sample(path, pitch / per_turn)
    if len(pts) < 2:
        x, y = path.start
        return circle_loop(x, y, radius, per_turn)
    # arc length along the skeleton
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + dist(a, b))
    total = acc[-1]
    if total < pitch * 0.6:
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        return circle_loop(cx, cy, radius, per_turn)
    turns = total / pitch
    if path.closed:
        turns = max(1, round(turns))     # whole turns, so the coil meets itself
    count = max(per_turn, int(round(turns * per_turn)))
    out = []
    j = 0
    for i in range(count + 1):
        s = total * i / count
        while j < len(acc) - 2 and acc[j + 1] < s:
            j += 1
        seg = acc[j + 1] - acc[j] or 1e-9
        t = (s - acc[j]) / seg
        a, b = pts[j], pts[j + 1]
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        # a smoothed tangent, so corners bend the coil instead of snapping it
        k0, k1 = max(0, j - 2), min(len(pts) - 1, j + 3)
        tx, ty = pts[k1][0] - pts[k0][0], pts[k1][1] - pts[k0][1]
        tl = math.hypot(tx, ty) or 1.0
        tx, ty = tx / tl, ty / tl
        nx, ny = -ty, tx
        th = 2 * math.pi * turns * i / count
        out.append((p[0] + radius * (math.sin(th) * tx + math.cos(th) * nx),
                    p[1] + radius * (math.sin(th) * ty + math.cos(th) * ny)))
    return polyline(out, closed=path.closed)


def circle_loop(x, y, r, per_turn):
    pts = [(x + r * math.cos(2 * math.pi * i / per_turn), y + r * math.sin(2 * math.pi * i / per_turn)) for i in range(per_turn)]
    return polyline(pts, closed=True)


def polyline(pts, closed=False):
    """Path data through the points as smooth curves (Catmull-Rom), written
    relative to the last point at one decimal, to keep the file small."""
    n = len(pts)
    get = (lambda i: pts[i % n]) if closed else (lambda i: pts[min(max(i, 0), n - 1)])
    r1 = lambda v: round(v, 1)
    cur = (r1(pts[0][0]), r1(pts[0][1]))
    d = ['M%s,%s' % (num1(cur[0]), num1(cur[1]))]
    last = n if closed else n - 1
    for i in range(last):
        p0, p1, p2, p3 = get(i - 1), get(i), get(i + 1), get(i + 2)
        c1 = (r1(p1[0] + (p2[0] - p0[0]) / 6.0), r1(p1[1] + (p2[1] - p0[1]) / 6.0))
        c2 = (r1(p2[0] - (p3[0] - p1[0]) / 6.0), r1(p2[1] - (p3[1] - p1[1]) / 6.0))
        e = (r1(p2[0]), r1(p2[1]))
        d.append('c' + ' '.join('%s,%s' % (num1(q[0] - cur[0]), num1(q[1] - cur[1])) for q in (c1, c2, e)))
        cur = e
    if closed:
        d.append('z')
    return ''.join(d)


def num1(v):
    v = round(v, 1)
    if v == int(v):
        return str(int(v))
    s = '%.1f' % v
    return s.replace('0.', '.', 1) if s.startswith('0.') else s.replace('-0.', '-.', 1)


# ------------------------------------------------------------------ files

def font_json(name, glyphs, cell, guides, style, spacing):
    top = {
        'format': 'gregfont', 'version': 2, 'name': name, 'status': 'generated',
        'cell': cell, 'guides': guides, 'style': style, 'spacing': spacing, 'kerning': {}
    }
    head = json.dumps(top, indent='\t', ensure_ascii=False)
    lines = []
    for ch, paths in glyphs.items():
        g = {'lsb': 4, 'rsb': 4, 'paths': [{'d': d} for d in paths]}
        lines.append('\t\t' + json.dumps(ch, ensure_ascii=False) + ': ' + json.dumps(g, separators=(',', ':'), ensure_ascii=False))
    return re.sub(r'\n}$', ',\n\t"glyphs": {\n' + ',\n'.join(lines) + '\n\t}\n}\n', head)


def write(file, text):
    with open(os.path.join(FONTS, file), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def add_to_manifest(files):
    path = os.path.join(FONTS, 'fonts.json')
    manifest = json.load(open(path, encoding='utf-8'))
    for f in files:
        if f not in manifest['fonts']:
            manifest['fonts'].append(f)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(manifest, indent='\t') + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--radius', type=float, default=3.2, help='Myrtle: the coil\'s radius, in font units')
    ap.add_argument('--pitch', type=float, default=4.2, help='Myrtle: distance along the stroke per loop')
    args = ap.parse_args()

    shapes = halsey()
    order = list('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    guides = {'cap': C, 'xHeight': X, 'descender': D}

    hal = {ch: [p.d() for p in shapes[ch]] for ch in order}
    write('halsey.json', font_json('Halsey', hal, {'width': W, 'height': C}, guides,
                                   {'strokeCap': 'round', 'strokeJoin': 'round', 'miterLimit': 10},
                                   {'monospaced': True, 'letterSpacing': 44, 'lineHeight': 96}))

    r = args.radius
    myr = {ch: [coil(p, r, args.pitch) for p in shapes[ch]] for ch in order}
    write('myrtle.json', font_json('Myrtle', myr, {'width': W, 'height': C}, guides,
                                   {'strokeCap': 'round', 'strokeJoin': 'round', 'miterLimit': 10},
                                   {'monospaced': True, 'letterSpacing': 44 + 2 * r, 'lineHeight': 96 + 2 * r}))

    add_to_manifest(['halsey.json', 'myrtle.json'])
    subprocess.check_call([sys.executable, os.path.join(HERE, 'build_fonts.py')])
    for f in ('halsey.json', 'myrtle.json'):
        print('%s: %d bytes' % (f, os.path.getsize(os.path.join(FONTS, f))))


if __name__ == '__main__':
    main()
