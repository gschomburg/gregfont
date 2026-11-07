@~/.claude/greg_globals/web.md

# gregfont

A font editor (`public/editor.html`) and a typesetter (`public/index.html`). README.md has the
full picture, including the font format. Open work is in `docs/TODO.md`.

## Differences from web.md (keep these)
- Saving tries `PUT` to `tools/server.py` first, then a picked folder, then a download. Keep the server tier.
- JS is ES5 style (`var`, `.then`), matching the existing code.
- Indentation is tabs, including font JSON written by the editor and `build_fonts.py`. Switch to spaces only when asked, and then change the writers too.
- `public/fonts` is the font library. Save always writes there; Import font (Ctrl+O) and Export font (Ctrl+Shift+S) are the only ways in and out. Ctrl+Shift+S is Export, not Save As.
- The bump script is Python: `python tools/bump_version.py X.Y.Z`.

## Working notes
- Run it with `python tools/server.py [port]` (default 8000, localhost only), or open `public/*.html` from disk.
- `public/fonts/fonts.js` is generated (by `tools/build_fonts.py` or by the editor's save). Never edit it by hand.
- Font JSON is written with one glyph per line, to keep diffs small.
