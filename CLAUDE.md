@~/.claude/greg_globals/web.md

# gregfont

A font editor (`src/editor.html`) and a typesetter (`src/index.html`). README.md has the
full picture, including the font format. Open work is in `docs/TODO.md`.

## Differences from web.md (keep these)
- `src/` is the web root (no build). Don't rename it to `public/`.
- Saving tries `PUT` to `tools/server.py` first, then a picked folder, then a download. Keep the server tier.
- JS is ES5 style (`var`, `.then`), matching the existing code.
- Indentation is tabs, including font JSON written by the editor and `build_fonts.py`. Switch to spaces only when asked, and then change the writers too.
- The bump script is Python: `python tools/bump_version.py X.Y.Z`.

## Working notes
- Run it with `python tools/server.py [port]` (default 8000, localhost only), or open `src/*.html` from disk.
- `src/fonts/fonts.js` is generated (by `tools/build_fonts.py` or by the editor's save). Never edit it by hand.
- Font JSON is written with one glyph per line, to keep diffs small.
