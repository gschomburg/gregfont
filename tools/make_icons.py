"""Make gregfont's icons and share preview from tools/make_icons.html.

Usage:  python tools/make_icons.py

Opens make_icons.html in headless Chrome (or Edge) and writes, into public/:
    icon.svg                 the icon (a "g" in Lafayette)
    icon-180.png             Apple touch icon (square corners)
    icon-192.png, icon-512.png
    preview.png              1200x630 card for Open Graph and Twitter
Change the drawing in make_icons.html, then rerun this.
"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'public'))
PAGE = 'file:///' + os.path.join(HERE, 'make_icons.html').replace('\\', '/')
BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'chromium',
]


def browser():
    for b in BROWSERS:
        if os.path.isfile(b) or (os.sep not in b and subprocess.run(['which', b], capture_output=True).returncode == 0):
            return b
    sys.exit('No Chrome or Edge found. Edit BROWSERS in ' + __file__)


def run(exe, query, *args):
    with tempfile.TemporaryDirectory() as profile:
        return subprocess.run([exe, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                               '--user-data-dir=' + profile, *args, PAGE + '?' + query],
                              capture_output=True, text=True, check=True).stdout


def shot(exe, query, w, h, out):
    run(exe, query, '--screenshot=' + out, '--window-size=%d,%d' % (w, h),
        '--default-background-color=00000000')
    print('wrote', os.path.relpath(out))


def main():
    if sys.argv[1:]:
        sys.exit(__doc__)
    exe = browser()
    dom = run(exe, 'mode=icon', '--dump-dom')
    m = re.search(r'<svg.*</svg>', dom, re.S)
    if not m:
        sys.exit('make_icons.html drew no SVG')
    out = os.path.join(PUBLIC, 'icon.svg')
    open(out, 'w', encoding='utf-8', newline='\n').write(m.group(0) + '\n')
    print('wrote', os.path.relpath(out))
    shot(exe, 'mode=icon&size=180&square=1', 180, 180, os.path.join(PUBLIC, 'icon-180.png'))
    for n in (192, 512):
        shot(exe, 'mode=icon&size=%d' % n, n, n, os.path.join(PUBLIC, 'icon-%d.png' % n))
    shot(exe, 'mode=preview', 1200, 630, os.path.join(PUBLIC, 'preview.png'))


if __name__ == '__main__':
    main()
