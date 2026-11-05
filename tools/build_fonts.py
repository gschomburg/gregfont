"""Rebuild public/fonts/fonts.js from fonts.json and the font files.

fonts.js holds a copy of every font as a script, so the typesetter and the
editor also work when their HTML file is opened straight from disk (where
browsers block fetch). The JSON files are the real fonts; this is only a
copy. The dev server and the editor rebuild it when they save, so run this
by hand only after editing a font file some other way.

Usage:  python tools/build_fonts.py
"""
import json
import os
import sys

FONTS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'fonts'))

HEADER = ('// Generated from fonts.json and the font files so the pages work when opened\n'
          '// straight from disk. Don\'t edit: the JSON files are the fonts. Rebuild with\n'
          '// python tools/build_fonts.py (saving from the editor also rebuilds it).\n')


def bundle_script(pairs):
    """pairs: [(file name, file text)] in manifest order. Same output as GregFont.bundleScript()."""
    parts = [HEADER, 'window.GREGFONT_BUNDLE = {\n"fonts": ', json.dumps([name for name, _ in pairs]), ',\n"data": {\n']
    parts.append(',\n'.join(json.dumps(name) + ': ' + text.strip() for name, text in pairs))
    parts.append('\n}\n};\n')
    return ''.join(parts)


def build(fonts_dir=FONTS):
    with open(os.path.join(fonts_dir, 'fonts.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    pairs = []
    for name in manifest['fonts']:
        path = os.path.join(fonts_dir, name)
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                pairs.append((name, f.read()))
    with open(os.path.join(fonts_dir, 'fonts.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(bundle_script(pairs))
    return len(pairs)


if __name__ == '__main__':
    if sys.argv[1:]:
        sys.exit(__doc__)
    print('fonts.js: %d fonts' % build())
