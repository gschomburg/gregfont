"""Generate Lafayette: a clean single-line serif on a 5-unit grid.

    python tools/make_lafayette.py

Every endpoint, corner and arc anchor sits on a multiple of 5: curves are
quarter arcs whose centres and radii are on the grid (only the curve handles
fall between). Cap height 60, x-height 40, ascenders 65, descenders -20.
Proportional, with crisp (butt) ends and sharp corners. Rerunning overwrites
the font.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from make_halsey_myrtle import Path, line, ellipse, add_to_manifest, FONTS  # noqa: E402
from make_four_fonts import write_font, LOWER, UPPER, DIGITS  # noqa: E402


def round_dot(x, y):
    # a tiny circle centred on the grid: with any normal pen it closes up
    # into a solid round dot, though the font's ends are flat
    d = ellipse(x, y, 1, 1)
    d.cap = 'round'
    return d


def serif(x, y, left=5, right=5):
    return line((x - left, y), (x + right, y))


def lafayette():
    g, w = {}, {}

    def put(ch, width, paths):
        g[ch], w[ch] = paths, width

    # capitals
    put('A', 50, [line((5, 0), (25, 60), (45, 0)), line((10, 15), (40, 15)), serif(5, 0), serif(45, 0)])
    put('B', 45, [line((5, 0), (5, 60)),
                  Path(0, 60).L(25, 60).A(25, 45, 15, 15, 90, -90).L(5, 30),
                  Path(5, 30).L(30, 30).A(30, 15, 15, 15, 90, -90).L(0, 0)])
    put('C', 55, [Path(50, 40).A(30, 40, 20, 20, 0, 90).A(30, 30, 25, 30, 90, 270).A(30, 20, 20, 20, 270, 360), line((50, 40), (50, 50))])
    put('D', 50, [line((5, 0), (5, 60)), Path(0, 60).L(20, 60).A(20, 30, 30, 30, 90, -90).L(0, 0)])
    put('E', 45, [line((5, 0), (5, 60)), line((0, 60), (45, 60), (45, 50)), line((5, 30), (35, 30)), line((35, 25), (35, 35)),
                  line((0, 0), (45, 0), (45, 10))])
    put('F', 45, [line((5, 0), (5, 60)), line((0, 60), (45, 60), (45, 50)), line((5, 30), (35, 30)), line((35, 25), (35, 35)), serif(5, 0, 5, 10)])
    put('G', 55, [Path(50, 40).A(30, 40, 20, 20, 0, 90).A(30, 30, 25, 30, 90, 270).A(30, 20, 20, 20, 270, 360).L(50, 30),
                  line((50, 40), (50, 50)), line((40, 30), (55, 30))])
    put('H', 50, [line((5, 0), (5, 60)), line((45, 0), (45, 60)), line((5, 30), (45, 30)),
                  serif(5, 0), serif(45, 0), serif(5, 60), serif(45, 60)])
    put('I', 10, [line((5, 0), (5, 60)), serif(5, 0), serif(5, 60)])
    put('J', 40, [Path(30, 60).L(30, 15).A(15, 15, 15, 15, 0, -180), serif(30, 60, 10, 10)])
    put('K', 50, [line((5, 0), (5, 60)), line((45, 60), (5, 20)), line((20, 35), (45, 0)),
                  serif(5, 0), serif(5, 60), serif(45, 60), serif(45, 0)])
    put('L', 45, [line((5, 0), (5, 60)), serif(5, 60), line((0, 0), (45, 0), (45, 10))])
    put('M', 60, [line((5, 0), (5, 60), (30, 0), (55, 60), (55, 0)), serif(5, 0), serif(55, 0), serif(5, 60, 5, 0), serif(55, 60, 0, 5)])
    put('N', 50, [line((5, 0), (5, 60), (45, 0), (45, 60)), serif(5, 0), serif(5, 60, 5, 0), serif(45, 60)])
    put('O', 50, [ellipse(25, 30, 25, 30)])
    put('P', 40, [line((5, 0), (5, 60)), Path(0, 60).L(25, 60).A(25, 45, 15, 15, 90, -90).L(5, 30), serif(5, 0)])
    put('Q', 50, [ellipse(25, 30, 25, 30), line((30, 5), (45, -10))])
    put('R', 50, [line((5, 0), (5, 60)), Path(0, 60).L(25, 60).A(25, 45, 15, 15, 90, -90).L(5, 30), line((20, 30), (45, 0)),
                  serif(5, 0), serif(45, 0)])
    put('S', 50, [Path(45, 45).A(25, 45, 20, 15, 0, 270).A(25, 15, 20, 15, 90, -180), line((45, 45), (45, 55)), line((5, 15), (5, 5))])
    put('T', 50, [line((0, 50), (0, 60), (50, 60), (50, 50)), line((25, 60), (25, 0)), serif(25, 0, 10, 10)])
    put('U', 50, [Path(5, 60).L(5, 20).A(25, 20, 20, 20, 180, 360).L(45, 60), serif(5, 60), serif(45, 60)])
    put('V', 50, [line((5, 60), (25, 0), (45, 60)), serif(5, 60), serif(45, 60)])
    put('W', 70, [line((5, 60), (20, 0), (35, 60), (50, 0), (65, 60)), serif(5, 60), serif(35, 60), serif(65, 60)])
    put('X', 50, [line((5, 60), (45, 0)), line((45, 60), (5, 0)), serif(5, 60), serif(45, 60), serif(5, 0), serif(45, 0)])
    put('Y', 50, [line((5, 60), (25, 30), (45, 60)), line((25, 30), (25, 0)), serif(5, 60), serif(45, 60), serif(25, 0, 10, 10)])
    put('Z', 50, [line((5, 50), (5, 60), (45, 60), (5, 0), (45, 0), (45, 10))])

    # lowercase
    put('a', 40, [Path(5, 30).A(20, 30, 15, 10, 180, 0).L(35, 5).A(40, 5, 5, 5, 180, 270),
                  Path(35, 20).L(15, 20).A(15, 10, 10, 10, 90, 270).L(35, 0)])
    put('b', 45, [line((5, 0), (5, 65)), serif(5, 65, 5, 0), ellipse(25, 20, 20, 20)])
    put('c', 40, [Path(35, 30).A(20, 30, 15, 10, 0, 90).A(20, 20, 20, 20, 90, 270).A(20, 10, 15, 10, 270, 360), line((35, 30), (35, 35))])
    put('d', 45, [ellipse(20, 20, 20, 20), line((40, 0), (40, 65)), serif(40, 65, 5, 0), serif(40, 0, 0, 5)])
    put('e', 40, [Path(0, 20).L(40, 20).A(20, 20, 20, 20, 0, 270).A(20, 10, 15, 10, 270, 360)])
    put('f', 35, [Path(10, 0).L(10, 50).A(25, 50, 15, 15, 180, 90).L(35, 65).L(35, 60), line((0, 40), (25, 40)), serif(10, 0, 10, 10)])
    put('g', 45, [ellipse(20, 20, 20, 20), Path(40, 40).L(40, -5).A(20, -5, 20, 15, 0, -180), serif(40, 40, 0, 5)])
    put('h', 40, [line((5, 0), (5, 65)), Path(5, 25).A(20, 25, 15, 15, 180, 0).L(35, 0), serif(5, 65, 5, 0), serif(5, 0), serif(35, 0)])
    put('i', 10, [line((5, 0), (5, 40)), serif(5, 40, 5, 0), serif(5, 0), round_dot(5, 50)])
    put('j', 20, [Path(15, 40).L(15, -10).A(5, -10, 10, 10, 0, -90).L(0, -20), serif(15, 40, 5, 0), round_dot(15, 50)])
    put('k', 40, [line((5, 0), (5, 65)), line((35, 40), (5, 10)), line((15, 20), (35, 0)),
                  serif(5, 65, 5, 0), serif(5, 0), serif(35, 40), serif(35, 0)])
    put('l', 10, [line((5, 0), (5, 65)), serif(5, 65, 5, 0), serif(5, 0)])
    put('m', 50, [line((5, 0), (5, 40)), Path(5, 30).A(15, 30, 10, 10, 180, 0).L(25, 0), Path(25, 30).A(35, 30, 10, 10, 180, 0).L(45, 0),
                  serif(5, 40, 5, 0), serif(5, 0), serif(25, 0), serif(45, 0)])
    put('n', 40, [line((5, 0), (5, 40)), Path(5, 25).A(20, 25, 15, 15, 180, 0).L(35, 0), serif(5, 40, 5, 0), serif(5, 0), serif(35, 0)])
    put('o', 40, [ellipse(20, 20, 20, 20)])
    put('p', 45, [line((5, 40), (5, -20)), ellipse(25, 20, 20, 20), serif(5, 40, 5, 0), serif(5, -20)])
    put('q', 45, [ellipse(20, 20, 20, 20), line((40, 40), (40, -20)), serif(40, -20)])
    put('r', 30, [line((5, 0), (5, 40)), Path(5, 30).A(20, 30, 15, 10, 180, 90).L(25, 40), serif(5, 40, 5, 0), serif(5, 0, 5, 10)])
    put('s', 40, [Path(35, 30).A(20, 30, 15, 10, 0, 270).A(20, 10, 15, 10, 90, -180), line((35, 30), (35, 35)), line((5, 10), (5, 5))])
    put('t', 30, [Path(10, 55).L(10, 10).A(20, 10, 10, 10, 180, 270).L(25, 0), line((0, 40), (25, 40))])
    put('u', 40, [Path(5, 40).L(5, 15).A(20, 15, 15, 15, 180, 360).L(35, 40), line((35, 40), (35, 0)),
                  serif(5, 40, 5, 0), serif(35, 40, 5, 0), serif(35, 0, 0, 5)])
    put('v', 40, [line((5, 40), (20, 0), (35, 40)), serif(5, 40), serif(35, 40)])
    put('w', 60, [line((5, 40), (15, 0), (30, 40), (45, 0), (55, 40)), serif(5, 40), serif(30, 40), serif(55, 40)])
    put('x', 40, [line((5, 40), (35, 0)), line((35, 40), (5, 0)), serif(5, 40), serif(35, 40), serif(5, 0), serif(35, 0)])
    put('y', 40, [line((5, 40), (20, 0)), line((35, 40), (20, 0), (15, -15), (5, -20)), serif(5, 40), serif(35, 40)])
    put('z', 40, [line((5, 30), (5, 40), (35, 40), (5, 0), (35, 0), (35, 10))])

    # figures
    put('0', 40, [ellipse(20, 30, 20, 30)])
    put('1', 30, [line((10, 50), (20, 60), (20, 0)), serif(20, 0, 10, 10)])
    put('2', 40, [Path(5, 45).A(20, 45, 15, 15, 180, 0).L(5, 0).L(40, 0).L(40, 10)])
    put('3', 40, [Path(5, 45).A(20, 45, 15, 15, 180, -90).A(20, 15, 15, 15, 90, -180)])
    put('4', 40, [line((30, 0), (30, 60), (0, 15), (40, 15)), serif(30, 0, 10, 10)])
    put('5', 40, [Path(35, 60).L(10, 60).L(5, 35).L(20, 35).A(20, 20, 15, 15, 90, -180)])
    put('6', 40, [ellipse(20, 20, 20, 20), Path(0, 20).L(0, 40).A(20, 40, 20, 20, 180, 90).L(30, 60)])
    put('7', 40, [line((0, 50), (0, 60), (40, 60), (15, 0))])
    put('8', 40, [ellipse(20, 45, 15, 15), ellipse(20, 15, 20, 15)])
    put('9', 40, [ellipse(20, 40, 20, 20), Path(40, 40).L(40, 20).A(20, 20, 20, 20, 0, -90).L(10, 0)])

    glyphs = {}
    for ch in LOWER + UPPER + DIGITS:
        glyphs[ch] = (g[ch], 5, 5)
    return write_font('lafayette.json', 'Lafayette', glyphs, {'width': 40, 'height': 60},
                      {'cap': 60, 'xHeight': 40, 'descender': -20},
                      {'strokeCap': 'butt', 'strokeJoin': 'miter', 'miterLimit': 4},
                      {'monospaced': False, 'letterSpacing': 25, 'lineHeight': 100})


if __name__ == '__main__':
    f = lafayette()
    add_to_manifest([f])
    subprocess.check_call([sys.executable, os.path.join(HERE, 'build_fonts.py')])
    print('%s: %d bytes' % (f, os.path.getsize(os.path.join(FONTS, f))))
