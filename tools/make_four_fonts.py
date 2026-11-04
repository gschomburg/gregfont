"""Generate four fonts, each built from lines and arcs in code:

  Mercer    one continuous stroke per character, techy: straight runs with
            45-degree chamfers, doubling back over itself where it branches
  Delancey  a proportional geometric sans with very uneven widths
  Hester    narrow letters set tight; ascenders sweep back over the letter
            before, descenders swing forward under the next
  Astor     symbols: space pictograms (a-z), runes (A-Z), moon phases (0-9)

    python tools/make_four_fonts.py          # writes all four, updates fonts.json

Uses the drawing helpers in make_halsey_myrtle.py. Rerunning overwrites the
fonts, so once you start editing one by hand, leave it out of the run
(--only Mercer,Astor).
"""
import argparse
import json
import math
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from make_halsey_myrtle import Path, line, ellipse, arc, dot, pt, sample, add_to_manifest, FONTS  # noqa: E402

LOWER = 'abcdefghijklmnopqrstuvwxyz'
UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
DIGITS = '0123456789'


# ------------------------------------------------------------------ helpers

def polyline(pts, closed=False):
    p = Path(*pts[0])
    for q in pts[1:]:
        p.L(*q)
    if closed:
        p.Z()
    return p


def ring(cx, cy, rx, ry, rot=0.0, a0=0.0, a1=360.0, n=48):
    """An ellipse (or part of one) turned by rot degrees, as a polyline."""
    out, c, s = [], math.cos(math.radians(rot)), math.sin(math.radians(rot))
    steps = max(4, int(n * abs(a1 - a0) / 360.0))
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x, y = rx * math.cos(a), ry * math.sin(a)
        out.append((cx + x * c - y * s, cy + x * s + y * c))
    return polyline(out, closed=abs(a1 - a0) >= 360)


def star(cx, cy, r_out, r_in, n, rot=90):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + 180.0 * i / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return polyline(pts, closed=True)


def spiral(cx, cy, r0, r1, turns, start=90, n=24):
    pts = []
    steps = int(turns * n)
    for i in range(steps + 1):
        t = i / float(steps)
        a = math.radians(start + 360 * turns * t)
        r = r0 + (r1 - r0) * t
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return polyline(pts)


def bounds(paths):
    xs, ys = [], []
    for p in paths:
        pts = sample(p, 1.0) if p.segs else [p.start]
        xs += [q[0] for q in pts]
        ys += [q[1] for q in pts]
    return min(xs), max(xs), min(ys), max(ys)


def write_font(file, name, glyphs, cell, guides, style, spacing):
    """glyphs: {ch: (paths, lsb, rsb)}"""
    top = {
        'format': 'gregfont', 'version': 2, 'name': name, 'status': 'generated',
        'cell': cell, 'guides': guides, 'style': style, 'spacing': spacing, 'kerning': {}
    }
    head = json.dumps(top, indent='\t', ensure_ascii=False)
    lines = []
    for ch, (paths, lsb, rsb) in glyphs.items():
        entries = []
        for p in paths:
            e = {'d': p.d()}
            if getattr(p, 'cap', None):     # a stroke with its own ends (say, a round dot)
                e['strokeCap'] = p.cap
            entries.append(e)
        g = {'lsb': round(lsb, 2), 'rsb': round(rsb, 2), 'paths': entries}
        lines.append('\t\t' + json.dumps(ch, ensure_ascii=False) + ': ' + json.dumps(g, separators=(',', ':'), ensure_ascii=False))
    text = re.sub(r'\n}$', ',\n\t"glyphs": {\n' + ',\n'.join(lines) + '\n\t}\n}\n', head)
    with open(os.path.join(FONTS, file), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    return file


# ------------------------------------------------------------------ Mercer: one stroke

def mercer():
    X, C = 40, 60
    s = {}
    # capitals
    s['A'] = [(0, 0), (0, 54), (6, 60), (26, 60), (32, 54), (32, 0), (32, 28), (0, 28)]
    s['B'] = [(0, 30), (26, 30), (32, 24), (32, 6), (26, 0), (0, 0), (0, 60), (26, 60), (32, 54), (32, 36), (26, 30)]
    s['C'] = [(32, 54), (26, 60), (6, 60), (0, 54), (0, 6), (6, 0), (26, 0), (32, 6)]
    s['D'] = [(0, 0), (0, 60), (20, 60), (32, 48), (32, 12), (20, 0), (0, 0)]
    s['E'] = [(32, 60), (0, 60), (0, 30), (24, 30), (0, 30), (0, 0), (32, 0)]
    s['F'] = [(32, 60), (0, 60), (0, 30), (24, 30), (0, 30), (0, 0)]
    s['G'] = [(32, 54), (26, 60), (6, 60), (0, 54), (0, 6), (6, 0), (26, 0), (32, 6), (32, 28), (16, 28)]
    s['H'] = [(0, 60), (0, 0), (0, 30), (32, 30), (32, 60), (32, 0)]
    s['I'] = [(6, 60), (26, 60), (16, 60), (16, 0), (6, 0), (26, 0)]
    s['J'] = [(12, 60), (32, 60), (32, 6), (26, 0), (6, 0), (0, 6), (0, 16)]
    s['K'] = [(0, 60), (0, 0), (0, 24), (32, 60), (12.5, 38.06), (32, 0)]
    s['L'] = [(0, 60), (0, 0), (32, 0)]
    s['M'] = [(0, 0), (0, 60), (16, 36), (32, 60), (32, 0)]
    s['N'] = [(0, 0), (0, 60), (32, 0), (32, 60)]
    s['O'] = [(6, 0), (0, 6), (0, 54), (6, 60), (26, 60), (32, 54), (32, 6), (26, 0), (6, 0)]
    s['P'] = [(0, 0), (0, 60), (26, 60), (32, 54), (32, 34), (26, 28), (0, 28)]
    s['Q'] = [(26, 0), (6, 0), (0, 6), (0, 54), (6, 60), (26, 60), (32, 54), (32, 6), (26, 0), (34, -8)]
    s['R'] = [(0, 0), (0, 60), (26, 60), (32, 54), (32, 34), (26, 28), (14, 28), (32, 0)]
    s['S'] = [(32, 54), (26, 60), (6, 60), (0, 54), (0, 36), (6, 30), (26, 30), (32, 24), (32, 6), (26, 0), (6, 0), (0, 6)]
    s['T'] = [(0, 60), (32, 60), (16, 60), (16, 0)]
    s['U'] = [(0, 60), (0, 6), (6, 0), (26, 0), (32, 6), (32, 60)]
    s['V'] = [(0, 60), (0, 20), (16, 0), (32, 20), (32, 60)]
    s['W'] = [(0, 60), (0, 0), (16, 20), (32, 0), (32, 60)]
    s['X'] = [(0, 60), (32, 0), (16, 30), (32, 60), (0, 0)]
    s['Y'] = [(0, 60), (16, 32), (32, 60), (16, 32), (16, 0)]
    s['Z'] = [(0, 60), (32, 60), (0, 0), (32, 0)]
    # lowercase
    s['a'] = [(2, 40), (26, 40), (32, 34), (32, 0), (32, 22), (6, 22), (0, 16), (0, 6), (6, 0), (32, 0)]
    s['b'] = [(0, 60), (0, 0), (26, 0), (32, 6), (32, 34), (26, 40), (0, 40)]
    s['c'] = [(32, 40), (6, 40), (0, 34), (0, 6), (6, 0), (32, 0)]
    s['d'] = [(32, 60), (32, 0), (6, 0), (0, 6), (0, 34), (6, 40), (32, 40)]
    s['e'] = [(0, 20), (32, 20), (32, 34), (26, 40), (6, 40), (0, 34), (0, 6), (6, 0), (32, 0)]
    s['f'] = [(28, 60), (16, 60), (10, 54), (10, 40), (2, 40), (22, 40), (10, 40), (10, 0)]
    s['g'] = [(32, 0), (6, 0), (0, 6), (0, 34), (6, 40), (32, 40), (32, -10), (26, -16), (2, -16)]
    s['h'] = [(0, 60), (0, 0), (0, 40), (26, 40), (32, 34), (32, 0)]
    s['i'] = [(6, 0), (26, 0), (16, 0), (16, 40), (8, 40), (8, 50), (16, 50)]
    s['j'] = [(4, -16), (16, -16), (22, -10), (22, 40), (14, 40), (14, 50), (22, 50)]
    s['k'] = [(0, 60), (0, 0), (0, 16), (28, 40), (10, 24.57), (32, 0)]
    s['l'] = [(6, 60), (16, 60), (16, 6), (22, 0), (30, 0)]
    s['m'] = [(0, 0), (0, 40), (10, 40), (16, 34), (16, 0), (16, 34), (22, 40), (26, 40), (32, 34), (32, 0)]
    s['n'] = [(0, 0), (0, 40), (26, 40), (32, 34), (32, 0)]
    s['o'] = [(6, 0), (0, 6), (0, 34), (6, 40), (26, 40), (32, 34), (32, 6), (26, 0), (6, 0)]
    s['p'] = [(0, -16), (0, 40), (26, 40), (32, 34), (32, 6), (26, 0), (0, 0)]
    s['q'] = [(32, -16), (32, 40), (6, 40), (0, 34), (0, 6), (6, 0), (32, 0)]
    s['r'] = [(0, 0), (0, 34), (6, 40), (26, 40), (32, 34)]
    s['s'] = [(32, 40), (6, 40), (0, 34), (0, 26), (6, 20), (26, 20), (32, 14), (32, 6), (26, 0), (0, 0)]
    s['t'] = [(10, 60), (10, 40), (2, 40), (24, 40), (10, 40), (10, 6), (16, 0), (28, 0)]
    s['u'] = [(0, 40), (0, 6), (6, 0), (32, 0), (32, 40)]
    s['v'] = [(0, 40), (0, 16), (16, 0), (32, 16), (32, 40)]
    s['w'] = [(0, 40), (0, 0), (16, 16), (32, 0), (32, 40)]
    s['x'] = [(0, 40), (32, 0), (16, 20), (32, 40), (0, 0)]
    s['y'] = [(0, 40), (0, 6), (6, 0), (32, 0), (32, 40), (32, -10), (26, -16), (2, -16)]
    s['z'] = [(0, 40), (32, 40), (0, 0), (32, 0)]
    # figures
    s['0'] = [(6, 0), (0, 6), (0, 54), (6, 60), (26, 60), (32, 54), (32, 6), (26, 0), (6, 0), (26, 60)]
    s['1'] = [(6, 50), (16, 60), (16, 0), (6, 0), (26, 0)]
    s['2'] = [(0, 54), (6, 60), (26, 60), (32, 54), (32, 36), (26, 30), (6, 30), (0, 24), (0, 0), (32, 0)]
    s['3'] = [(0, 60), (26, 60), (32, 54), (32, 36), (26, 30), (10, 30), (26, 30), (32, 24), (32, 6), (26, 0), (0, 0)]
    s['4'] = [(24, 0), (24, 60), (0, 20), (32, 20)]
    s['5'] = [(32, 60), (0, 60), (0, 30), (26, 30), (32, 24), (32, 6), (26, 0), (0, 0)]
    s['6'] = [(32, 60), (6, 60), (0, 54), (0, 6), (6, 0), (26, 0), (32, 6), (32, 24), (26, 30), (0, 30)]
    s['7'] = [(0, 52), (0, 60), (32, 60), (32, 52), (12, 0)]
    s['8'] = [(6, 30), (0, 36), (0, 54), (6, 60), (26, 60), (32, 54), (32, 36), (26, 30), (6, 30), (0, 24), (0, 6), (6, 0),
              (26, 0), (32, 6), (32, 24), (26, 30)]
    s['9'] = [(0, 0), (26, 0), (32, 6), (32, 54), (26, 60), (6, 60), (0, 54), (0, 36), (6, 30), (32, 30)]
    glyphs = {ch: ([polyline(s[ch])], 4, 4) for ch in LOWER + UPPER + DIGITS}
    return write_font('mercer.json', 'Mercer', glyphs, {'width': 32, 'height': C},
                      {'cap': C, 'xHeight': X, 'descender': -16},
                      {'strokeCap': 'butt', 'strokeJoin': 'miter', 'miterLimit': 4},
                      {'monospaced': True, 'letterSpacing': 44, 'lineHeight': 96})


# ------------------------------------------------------------------ Delancey: uneven widths

def delancey():
    g = {}
    circ = lambda: ellipse(20, 20, 20, 20)
    # lowercase: from a single stroke (i, l) to the 72-wide w
    g['a'] = [circ(), line((40, 40), (40, 0))]
    g['b'] = [line((0, 60), (0, 0)), circ()]
    g['c'] = [arc(20, 20, 20, 20, 45, 315)]
    g['d'] = [circ(), line((40, 60), (40, 0))]
    g['e'] = [Path(0, 20).L(40, 20).A(20, 20, 20, 20, 0, 315)]
    g['f'] = [Path(8, 0).L(8, 50).A(16, 50, 8, 8, 180, 10), line((0, 40), (18, 40))]
    g['g'] = [circ(), Path(40, 40).L(40, -4).A(20, -4, 20, 16, 0, -170)]
    g['h'] = [line((0, 60), (0, 0)), Path(0, 24).A(16, 24, 16, 16, 180, 0).L(32, 0)]
    g['i'] = [line((0, 0), (0, 40)), dot(0, 52)]
    g['j'] = [Path(8, 40).L(8, -8).A(0, -8, 8, 12, 0, -160), dot(8, 52)]
    g['k'] = [line((0, 60), (0, 0)), line((24, 40), (0, 16)), line((7, 23), (26, 0))]
    g['l'] = [line((0, 60), (0, 0))]
    g['m'] = [line((0, 40), (0, 0)), Path(0, 26).A(14, 26, 14, 14, 180, 0).L(28, 0), Path(28, 26).A(42, 26, 14, 14, 180, 0).L(56, 0)]
    g['n'] = [line((0, 40), (0, 0)), Path(0, 24).A(16, 24, 16, 16, 180, 0).L(32, 0)]
    g['o'] = [circ()]
    g['p'] = [line((0, 40), (0, -20)), circ()]
    g['q'] = [circ(), line((40, 40), (40, -20))]
    g['r'] = [line((0, 40), (0, 0)), Path(0, 24).A(14, 24, 14, 16, 180, 60)]
    g['s'] = [arc(12, 30, 11, 10, 10, 270).A(12, 10, 12, 10, 90, -170)]
    g['t'] = [Path(8, 60).L(8, 6).A(16, 6, 8, 6, 180, 300), line((0, 40), (18, 40))]
    g['u'] = [Path(0, 40).L(0, 16).A(16, 16, 16, 16, 180, 360).L(32, 40), line((32, 40), (32, 0))]
    g['v'] = [line((0, 40), (20, 0), (40, 40))]
    g['w'] = [line((0, 40), (18, 0), (36, 40), (54, 0), (72, 40))]
    g['x'] = [line((0, 40), (36, 0)), line((36, 40), (0, 0))]
    g['y'] = [line((0, 40), (20, 0)), line((40, 40), (10, -20))]
    g['z'] = [line((0, 40), (30, 40), (0, 0), (30, 0))]
    # capitals: from the single-stroke I to the 88-wide W
    g['A'] = [line((0, 0), (26, 60), (52, 0)), line((8.67, 20), (43.33, 20))]
    g['B'] = [Path(0, 0).L(0, 60).L(18, 60).A(18, 46, 14, 14, 90, -90).L(0, 32), Path(0, 32).L(20, 32).A(20, 16, 16, 16, 90, -90).L(0, 0)]
    g['C'] = [arc(30, 30, 30, 30, 45, 315)]
    g['D'] = [Path(0, 0).L(0, 60).L(22, 60).A(22, 30, 30, 30, 90, -90).L(0, 0)]
    g['E'] = [line((32, 60), (0, 60), (0, 0), (32, 0)), line((0, 30), (26, 30))]
    g['F'] = [line((30, 60), (0, 60), (0, 0)), line((0, 30), (24, 30))]
    g['G'] = [arc(30, 30, 30, 30, 45, 360).L(34, 30)]
    g['H'] = [line((0, 0), (0, 60)), line((44, 0), (44, 60)), line((0, 30), (44, 30))]
    g['I'] = [line((0, 0), (0, 60))]
    g['J'] = [Path(24, 60).L(24, 14).A(12, 14, 12, 14, 0, -180)]
    g['K'] = [line((0, 0), (0, 60)), line((40, 60), (0, 24)), line((13, 35.7), (42, 0))]
    g['L'] = [line((0, 60), (0, 0), (30, 0))]
    g['M'] = [line((0, 0), (0, 60), (32, 0), (64, 60), (64, 0))]
    g['N'] = [line((0, 0), (0, 60), (46, 0), (46, 60))]
    g['O'] = [ellipse(30, 30, 30, 30)]
    g['P'] = [Path(0, 0).L(0, 60).L(18, 60).A(18, 44, 18, 16, 90, -90).L(0, 28)]
    g['Q'] = [ellipse(30, 30, 30, 30), line((36, 14), (62, -6))]
    g['R'] = [Path(0, 0).L(0, 60).L(18, 60).A(18, 44, 18, 16, 90, -90).L(0, 28), line((16, 28), (38, 0))]
    g['S'] = [arc(17, 45, 15, 15, 20, 270).A(17, 15, 17, 15, 90, -160)]
    g['T'] = [line((0, 60), (44, 60)), line((22, 60), (22, 0))]
    g['U'] = [Path(0, 60).L(0, 22).A(22, 22, 22, 22, 180, 360).L(44, 60)]
    g['V'] = [line((0, 60), (26, 0), (52, 60))]
    g['W'] = [line((0, 60), (22, 0), (44, 60), (66, 0), (88, 60))]
    g['X'] = [line((0, 60), (48, 0)), line((48, 60), (0, 0))]
    g['Y'] = [line((0, 60), (24, 30), (48, 60)), line((24, 30), (24, 0))]
    g['Z'] = [line((0, 60), (40, 60), (0, 0), (40, 0))]
    # figures, proportional too
    g['0'] = [ellipse(18, 30, 18, 30)]
    g['1'] = [line((0, 48), (8, 60), (8, 0))]
    g['2'] = [arc(16, 44, 15, 16, 160, -40).L(0, 0).L(32, 0)]
    g['3'] = [arc(15, 45, 13, 15, 150, -90).A(15, 15, 15, 15, 90, -150)]
    g['4'] = [line((24, 0), (24, 60), (0, 16), (34, 16))]
    g['5'] = [Path(28, 60).L(3, 60).L(2, 34).A(14, 18, 16, 18, 130, -150)]
    g['6'] = [ellipse(16, 18, 16, 18), Path(0, 18).L(0, 40).A(16, 40, 16, 20, 180, 45)]
    g['7'] = [line((0, 60), (32, 60), (8, 0))]
    g['8'] = [ellipse(16, 45, 13, 15), ellipse(16, 15, 16, 15)]
    g['9'] = [ellipse(16, 42, 16, 18), Path(32, 42).L(32, 20).A(16, 20, 16, 20, 0, -135)]
    glyphs = {ch: (g[ch], 7, 7) for ch in LOWER + UPPER + DIGITS}
    return write_font('delancey.json', 'Delancey', glyphs, {'width': 40, 'height': 60},
                      {'cap': 60, 'xHeight': 40, 'descender': -20},
                      {'strokeCap': 'round', 'strokeJoin': 'round', 'miterLimit': 10},
                      {'monospaced': False, 'letterSpacing': 22, 'lineHeight': 96})


# ------------------------------------------------------------------ Hester: narrow, overlapping

def hester():
    def asc(x, base=0):
        # a stem that shoots up and sweeps back to the left, over the letter before
        return Path(x, base).L(x, 52).A(x - 20, 52, 20, 30, 0, 112)

    def desc(x, top=40):
        # a stem that drops and swings forward, under the next letter
        return Path(x, top).L(x, -12).A(x + 18, -12, 18, 14, 180, 305)

    def cap_asc(x):
        return Path(x, 0).L(x, 60).A(x - 14, 60, 14, 18, 0, 125)

    o = lambda: ellipse(8, 20, 8, 20)
    g, w = {}, {}

    def put(ch, width, paths):
        g[ch], w[ch] = paths, width

    put('a', 16, [o(), line((16, 40), (16, 0))])
    put('b', 16, [asc(0), o()])
    put('c', 16, [arc(8, 20, 8, 20, 50, 310)])
    put('d', 16, [o(), asc(16)])
    put('e', 16, [Path(0, 20).L(16, 20).A(8, 20, 8, 20, 0, 310)])
    put('f', 12, [asc(6), line((0, 40), (13, 40))])
    put('g', 16, [o(), desc(16)])
    put('h', 16, [asc(0), Path(0, 26).A(8, 26, 8, 14, 180, 0).L(16, 0)])
    put('i', 0, [line((0, 0), (0, 40)), dot(0, 50)])
    put('j', 0, [desc(0), dot(0, 50)])
    put('k', 16, [asc(0), line((14, 40), (0, 14)), line((5, 23.29), (16, 0))])
    put('l', 0, [asc(0)])
    put('m', 24, [line((0, 40), (0, 0)), Path(0, 30).A(6, 30, 6, 10, 180, 0).L(12, 0), Path(12, 30).A(18, 30, 6, 10, 180, 0).L(24, 0)])
    put('n', 16, [line((0, 40), (0, 0)), Path(0, 26).A(8, 26, 8, 14, 180, 0).L(16, 0)])
    put('o', 16, [o()])
    put('p', 16, [desc(0), o()])
    put('q', 16, [o(), desc(16)])
    put('r', 12, [line((0, 40), (0, 0)), Path(0, 22).A(10, 22, 10, 16, 180, 70)])
    put('s', 16, [arc(8, 30, 7, 10, 15, 270).A(8, 10, 8, 10, 90, -160)])
    put('t', 12, [Path(6, 52).L(6, 6).A(11, 6, 5, 6, 180, 300), line((0, 40), (13, 40))])   # plain, so it's not an f
    put('u', 16, [Path(0, 40).L(0, 12).A(8, 12, 8, 12, 180, 360).L(16, 40), line((16, 40), (16, 0))])
    put('v', 16, [line((0, 40), (8, 0), (16, 40))])
    put('w', 24, [line((0, 40), (6, 0), (12, 30), (18, 0), (24, 40))])
    put('x', 16, [line((0, 40), (16, 0)), line((16, 40), (0, 0))])
    put('y', 16, [line((0, 40), (9, 2)), Path(16, 40).L(8, 0).L(6, -10).A(24, -10, 18, 14, 180, 300)])
    put('z', 16, [line((0, 40), (16, 40), (0, 0), (16, 0))])

    put('A', 22, [line((0, 0), (11, 60), (22, 0)), line((3.67, 20), (18.33, 20))])
    put('B', 22, [cap_asc(0), Path(0, 60).L(10, 60).A(10, 46, 10, 14, 90, -90).L(0, 32), Path(0, 32).L(10, 32).A(10, 16, 12, 16, 90, -90).L(0, 0)])
    put('C', 22, [arc(11, 30, 11, 30, 40, 320)])
    put('D', 22, [cap_asc(0), Path(0, 60).L(4, 60).A(4, 30, 18, 30, 90, -90).L(0, 0)])
    put('E', 22, [cap_asc(0), line((22, 60), (0, 60)), line((0, 30), (16, 30)), line((0, 0), (22, 0))])
    put('F', 22, [cap_asc(0), line((22, 60), (0, 60)), line((0, 30), (16, 30))])
    put('G', 22, [arc(11, 30, 11, 30, 40, 360).L(12, 30)])
    put('H', 22, [cap_asc(0), line((22, 0), (22, 60)), line((0, 30), (22, 30))])
    put('I', 0, [cap_asc(0)])
    put('J', 22, [Path(22, 60).L(22, 10).A(11, 10, 11, 10, 0, -180)])
    put('K', 22, [cap_asc(0), line((22, 60), (0, 20)), line((7, 32.73), (22, 0))])
    put('L', 22, [cap_asc(0), line((0, 0), (22, 0))])
    put('M', 24, [line((0, 0), (0, 60), (12, 24), (24, 60), (24, 0))])
    put('N', 22, [cap_asc(0), line((0, 60), (22, 0), (22, 60))])
    put('O', 22, [ellipse(11, 30, 11, 30)])
    put('P', 22, [cap_asc(0), Path(0, 60).L(10, 60).A(10, 45, 12, 15, 90, -90).L(0, 30)])
    put('Q', 22, [ellipse(11, 30, 11, 30), line((14, 12), (26, -8))])
    put('R', 22, [cap_asc(0), Path(0, 60).L(10, 60).A(10, 45, 12, 15, 90, -90).L(0, 30), line((8, 30), (22, 0))])
    put('S', 22, [arc(11, 45, 10, 15, 20, 270).A(11, 15, 11, 15, 90, -160)])
    put('T', 22, [line((0, 60), (22, 60)), line((11, 60), (11, 0))])
    put('U', 22, [Path(0, 60).L(0, 11).A(11, 11, 11, 11, 180, 360).L(22, 60)])
    put('V', 22, [line((0, 60), (11, 0), (22, 60))])
    put('W', 24, [line((0, 60), (6, 0), (12, 40), (18, 0), (24, 60))])
    put('X', 22, [line((0, 60), (22, 0)), line((22, 60), (0, 0))])
    put('Y', 22, [line((0, 60), (11, 30), (22, 60)), line((11, 30), (11, 0))])
    put('Z', 22, [line((0, 60), (22, 60), (0, 0), (22, 0))])

    put('0', 18, [ellipse(9, 30, 9, 30)])
    put('1', 9, [line((2, 50), (9, 60), (9, 0))])
    put('2', 18, [arc(9, 45, 9, 15, 160, -40).L(0, 0).L(18, 0)])
    put('3', 18, [arc(9, 46, 8, 14, 150, -90).A(9, 16, 9, 16, 90, -150)])
    put('4', 18, [line((14, 0), (14, 60), (0, 18), (18, 18))])
    put('5', 18, [Path(17, 60).L(2, 60).L(1, 34).A(9, 18, 9, 18, 117, -150)])
    put('6', 18, [ellipse(9, 18, 9, 18), Path(0, 18).L(0, 42).A(9, 42, 9, 18, 180, 40)])
    put('7', 18, [line((0, 60), (18, 60), (4, 0))])
    put('8', 18, [ellipse(9, 46, 8, 14), ellipse(9, 16, 9, 16)])
    put('9', 18, [ellipse(9, 42, 9, 18), Path(18, 42).L(18, 18).A(9, 18, 9, 18, 0, -140)])

    # Spacing comes from each letter's body (0 to its width), not its ink, so
    # the flourishes hang over the neighbours instead of pushing them away.
    gap = 2.5
    glyphs = {}
    for ch in LOWER + UPPER + DIGITS:
        x0, x1, _, _ = bounds(g[ch])
        glyphs[ch] = (g[ch], gap + x0, w[ch] + gap - x1)
    return write_font('hester.json', 'Hester', glyphs, {'width': 16, 'height': 60},
                      {'cap': 60, 'xHeight': 40, 'descender': -26},
                      {'strokeCap': 'round', 'strokeJoin': 'round', 'miterLimit': 10},
                      {'monospaced': False, 'letterSpacing': 14, 'lineHeight': 104})


# ------------------------------------------------------------------ Astor: symbols

def astor():
    S = 48          # the symbol box: 0..48 both ways, sitting on the baseline
    c = S / 2.0
    g = {}

    # lowercase: space pictograms
    g['a'] = [star(c, c, 22, 9, 5)]
    g['b'] = [ellipse(c, c, 9, 9)] + [line(pt(c, c, 13, 13, a), pt(c, c, 21, 21, a)) for a in range(0, 360, 45)]
    g['c'] = [Path(*pt(c, c, 20, 20, 50)).A(c, c, 20, 20, 50, 310).A(40, c, 15.62, 15.62, 258.4, 101.6).Z()]
    g['d'] = [ellipse(c, c, 12, 12), ring(c, c, 23, 6, rot=-18)]
    g['e'] = [arc(c, -6, 37.2, 37.2, 126.3, 53.7).A(c, 54, 37.2, 37.2, -53.7, -126.3).Z(), ellipse(c, c, 8, 8), ellipse(c, c, 2.5, 2.5)]
    g['f'] = [polyline([(c, 47), (31, 34), (31, 12), (17, 12), (17, 34)], closed=True),
              polyline([(17, 20), (9, 8), (17, 13)]), polyline([(31, 20), (39, 8), (31, 13)]),
              ellipse(c, 27, 3.5, 3.5), polyline([(20, 10), (c, 0), (28, 10)])]
    g['g'] = [spiral(c, c, 1.5, 22, 1.6, start=0), spiral(c, c, 1.5, 22, 1.6, start=180)]
    g['h'] = [ellipse(34, 34, 6, 6), line((29, 30), (2, 8)), line((31, 28.5), (10, 2)), line((28.5, 34), (4, 20))]
    g['i'] = [polyline([(19, 19), (29, 19), (29, 29), (19, 29)], closed=True),
              polyline([(2, 17), (15, 17), (15, 31), (2, 31)], closed=True), line((15, 24), (19, 24)),
              polyline([(46, 17), (33, 17), (33, 31), (46, 31)], closed=True), line((29, 24), (33, 24)),
              line((c, 29), (c, 40)), ellipse(c, 42, 2, 2)]
    g['j'] = [arc(c, 24, 10, 10, 0, 180), ring(c, 22, 22, 6), line((14, 16), (8, 2)), line((34, 16), (40, 2)), line((c, 16), (c, 4))]
    g['k'] = [ring(c, 26, 18, 22), ring(16, 28, 7, 4, rot=-30), ring(32, 28, 7, 4, rot=30), line((20, 10), (28, 10))]
    g['l'] = [polyline([(30, 47), (12, 22), (24, 22), (16, 1), (36, 28), (24, 28)], closed=True)]
    g['m'] = [polyline([(0, 4), (16, 38), (26, 20), (34, 32), (48, 4)]), polyline([(11, 27), (16, 24), (21, 28)])]
    g['n'] = [polyline([(x, y0 + 4 * math.sin(x / 48.0 * 4 * math.pi)) for x in range(0, 49, 2)]) for y0 in (12, 24, 36)]
    g['o'] = [ellipse(c, c, 3, 3), ring(c, c, 22, 8, rot=0), ring(c, c, 22, 8, rot=60), ring(c, c, 22, 8, rot=120)]
    g['p'] = [polyline([(2, 4), (46, 4), (c, 46)], closed=True), ring(c, 18, 9, 4.5), ellipse(c, 18, 2, 2)]
    g['q'] = [ellipse(20, 22, 13, 13), ellipse(40, 40, 4, 4), ring(20, 22, 22, 22, a0=20, a1=70)]
    g['r'] = [arc(18, 30, 16, 16, 200, 340).L(2.96, 24.53), line((18, 14), (18, 6), (10, 2)), line((18, 6), (26, 2)),
              arc(18, 26, 22, 22, 20, 70), arc(18, 26, 30, 30, 25, 65)]
    g['s'] = [spiral(c, c, 0.5, 22, 3.2)]
    g['t'] = [polyline([(4, 30), (34, 46), (38, 38), (8, 22)], closed=True), line((22, 30), (12, 0)), line((22, 30), (c, 0)), line((22, 30), (34, 0))]
    g['u'] = [polyline([(8, 46), (40, 46), (c + 2, c), (40, 2), (8, 2), (c - 2, c)], closed=True), line((14, 8), (34, 8))]
    g['v'] = [polyline([(c, 47), (42, 32), (c, 1), (6, 32)], closed=True), line((6, 32), (42, 32)), line((16, 32), (c, 1)), line((32, 32), (c, 1)),
              line((16, 32), (c, 47)), line((32, 32), (c, 47))]
    nodes = [(4, 8), (14, 22), (10, 40), (26, 30), (38, 44), (44, 18), (30, 6)]
    g['w'] = [polyline(nodes[:5]), line(nodes[3], nodes[5]), line(nodes[5], nodes[6])] + [ellipse(x, y, 1.6, 1.6) for x, y in nodes]
    g['x'] = [ellipse(c, c, 20, 20), ellipse(c, c, 9, 9), line((c, 0), (c, 15)), line((c, 33), (c, 48)), line((0, c), (15, c)), line((33, c), (48, c))]
    g['y'] = [star(c, c, 23, 4, 4), star(c, c, 10, 2.5, 4, rot=45)]
    g['z'] = [polyline([(c + 20 * math.cos(t) / (1 + math.sin(t) ** 2), c + 20 * math.sin(t) * math.cos(t) / (1 + math.sin(t) ** 2))
                        for t in [i * 2 * math.pi / 64 for i in range(65)]])]

    # capitals: runes, a stem plus a few strokes between lattice points
    lattice = [(x, y) for y in (2, 17, 31, 46) for x in (8, 24, 40)]
    cands = []
    for i, a in enumerate(lattice):
        for b in lattice[i + 1:]:
            dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
            if (dx, dy) != (0, 0) and dx <= 16 and dy <= 15 and not (a[0] == 24 and b[0] == 24):
                cands.append((a, b))
    seen = set()
    for i, ch in enumerate(UPPER):
        rnd = random.Random(1907 + i * 31)
        while True:
            # grow from the stem: each stroke starts on a point already drawn,
            # so the rune hangs together
            joined = {p for p in lattice if p[0] == 24}
            pick = []
            for _ in range(rnd.choice((2, 3, 3, 4))):
                options = [k for k, (a, b) in enumerate(cands) if k not in pick and (a in joined or b in joined)]
                k = rnd.choice(options)
                pick.append(k)
                joined |= set(cands[k])
            key = tuple(sorted(pick))
            if key not in seen:
                seen.add(key)
                break
        strokes = [line((24, 2), (24, 46))] + [line(*cands[k]) for k in pick]
        if rnd.random() < 0.25:
            strokes.append(ellipse(24, rnd.choice((10, 24, 38)), 4, 4))
        g[ch] = strokes

    # figures: the phases of the moon, new (0) to full (5) and back
    for n, ch in enumerate(DIGITS):
        disc = ellipse(c, c, 20, 20)
        if n == 0:
            g[ch] = [disc, ellipse(c, c, 16, 16)]
            continue
        if n == 5:
            g[ch] = [disc, ellipse(17, 30, 4, 4), ellipse(31, 18, 5, 5), ellipse(30, 34, 2, 2)]
            continue
        phase = n / 5.0 if n < 5 else (10 - n) / 5.0       # 0 new .. 1 full
        rx = 20 * abs(math.cos(math.pi * phase))
        lit_right = n < 5
        if phase <= 0.5:   # crescent: the line bows the same way as the edge
            term = ring(c, c, rx, 20, a0=-90, a1=90) if lit_right else ring(c, c, rx, 20, a0=90, a1=270)
        else:              # gibbous: it bows the other way
            term = ring(c, c, rx, 20, a0=90, a1=270) if lit_right else ring(c, c, rx, 20, a0=-90, a1=90)
        g[ch] = [disc, term]

    glyphs = {ch: (g[ch], 6, 6) for ch in LOWER + UPPER + DIGITS}
    return write_font('astor.json', 'Astor', glyphs, {'width': S, 'height': S},
                      {'cap': S, 'xHeight': S / 2, 'descender': 0},
                      {'strokeCap': 'round', 'strokeJoin': 'round', 'miterLimit': 10},
                      {'monospaced': True, 'letterSpacing': 58, 'lineHeight': 70})


def main():
    makers = {'Mercer': mercer, 'Delancey': delancey, 'Hester': hester, 'Astor': astor}
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated font names to make (default: all four)')
    args = ap.parse_args()
    names = args.only.split(',') if args.only else list(makers)
    files = [makers[n]() for n in names]
    add_to_manifest(files)
    subprocess.check_call([sys.executable, os.path.join(HERE, 'build_fonts.py')])
    for f in files:
        print('%s: %d bytes' % (f, os.path.getsize(os.path.join(FONTS, f))))


if __name__ == '__main__':
    main()
