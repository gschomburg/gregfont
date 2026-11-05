"""Set the gregfont version before publishing.

Usage:  python tools/bump_version.py 2.0.1

Writes the version and today's date into public/js/version.js, and stamps
?v=<version> onto every local script and stylesheet in the pages, so
browsers fetch the new files instead of old cached ones (web hosts often
cache .js and .css for weeks).
"""
import datetime
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
PAGES = ['index.html', 'editor.html']


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r'\d+\.\d+\.\d+', sys.argv[1]):
        sys.exit(__doc__)
    version = sys.argv[1]
    today = datetime.date.today().isoformat()

    path = os.path.join(ROOT, 'js', 'version.js')
    text = open(path, encoding='utf-8').read()
    text, n = re.subn(r"window\.GREGFONT_VERSION = \{.*?\};",
                      "window.GREGFONT_VERSION = { version: '%s', date: '%s' };" % (version, today), text)
    if n != 1:
        sys.exit('Could not find GREGFONT_VERSION in ' + path)
    open(path, 'w', encoding='utf-8', newline='\n').write(text)

    # src="js/x.js" / href="style/x.css", with or without an old ?v=
    pattern = re.compile(r'((?:src|href)="(?!https?:|//)[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"')
    for page in PAGES:
        path = os.path.join(ROOT, page)
        text = open(path, encoding='utf-8').read()
        text, n = pattern.subn(lambda m: '%s?v=%s"' % (m.group(1), version), text)
        open(path, 'w', encoding='utf-8', newline='\n').write(text)
        print('%s: %d files stamped' % (page, n))
    print('gregfont %s (%s)' % (version, today))


if __name__ == '__main__':
    main()
