"""Local dev server for gregfont.

Serves src/ like any static server, and also accepts
    PUT /fonts/<name>.json
to save a font file into src/fonts/ (adding it to fonts/fonts.json if new,
and rebuilding fonts/fonts.js). That's how the editor saves straight to disk.

Usage:  python tools/server.py [port]      (default port 8000)
Only listens on 127.0.0.1.
"""
import http.server
import json
import os
import re
import sys
from functools import partial

from build_fonts import build as build_bundle

SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src'))
FONTS = os.path.join(SRC, 'fonts')
MANIFEST = os.path.join(FONTS, 'fonts.json')
FONT_PATH = re.compile(r'^/fonts/([a-z0-9][a-z0-9_-]*)\.json$')
MAX_BYTES = 10 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always serve fresh files so edits show up on reload.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_PUT(self):
        m = FONT_PATH.match(self.path)
        if not m or m.group(1) == 'fonts':
            return self.send_error(404, 'Can only save /fonts/<name>.json')
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BYTES:
            return self.send_error(400, 'Bad body size')
        body = self.rfile.read(length)
        try:
            font = json.loads(body)
        except ValueError as e:
            return self.send_error(400, 'Invalid JSON: %s' % e)
        if not isinstance(font, dict) or font.get('format') != 'gregfont':
            return self.send_error(400, 'Not a gregfont file')

        file_name = m.group(1) + '.json'
        with open(os.path.join(FONTS, file_name), 'wb') as f:
            f.write(body)
        add_to_manifest(file_name)
        build_bundle(FONTS)

        self.send_response(204)
        self.end_headers()


def add_to_manifest(file_name):
    manifest = {'fonts': []}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            manifest = json.load(f)
    if file_name not in manifest['fonts']:
        manifest['fonts'].append(file_name)
        with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(manifest, f, indent='\t')
            f.write('\n')


def main():
    args = sys.argv[1:]
    if len(args) > 1 or (args and not args[0].isdigit()):
        sys.exit(__doc__)
    port = int(args[0]) if args else 8000
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=SRC))
    print('gregfont dev server: http://localhost:%d  (serving %s)' % (port, SRC))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
