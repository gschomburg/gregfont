# TODO

The one list of open work. `[ ]` todo, `[~]` in progress, `[x]` done (with date and version).

## Next session: start here

- [ ] Bleecker 426: a kerning pass, then review g, f, k and e.
- [x] Bring gregfont in line with the shared web rules: storage keys, theme default, editor undo cap, HTML head, `.htaccess`. (2026-11-04, 2.15.0)

## Editor

- [ ] Autosave unsaved fonts (new, imported or edited) to the browser, so a refresh or crash doesn't lose them. Restore on load; `?fresh` skips it. The web rules ask for this.
- [ ] Put `* ` in the page title when any font is unsaved, not just the one you're on.
- [x] Import font (Ctrl+O) and Export font (Ctrl+Shift+S), in place of Save as. (2026-11-07, 2.17.0)
- [x] Ctrl+Z after clicking a switch (like Grid) ran the browser's undo, which reverted typing in the preview text instead of the last edit. Fixed in the typesetter too. (2026-11-09, 2.17.1)
- [ ] Play with the theme colours more. In particular, a way to tone down the canvas colours (guides, grid, bearing lines), maybe a canvas contrast setting. All the colours are tokens at the top of `public/style/base.css`.
- [ ] One stroke control instead of two. The glyph canvas has a Stroke field in its options bar and the preview has its own; there should be one, laid out the same way, next to the zoom controls on each.
- [ ] Settle on one word for line thickness across both apps. The editor says "Stroke" (and "Strokes" for the default end and corner styles), the typesetter says "Pen", the code and README also say "stroke width" and "weight".
- [ ] Context from the preview: draw the current glyph's neighbours from the preview text faintly on the canvas, where the text would put them (spacing and kerning applied). Working on A with "ABC" in the preview shows a ghost B to its right on the baseline, and moving a side bearing slides the neighbours live. Clicking a letter in the specimen would open it with that spot's neighbours around it, like zooming in to an isolation mode. Not tracing, just seeing the letter in context.
- [ ] Picking a glyph in the grid while the specimen is open should bring that letter into view in the specimen (scroll the view to its first occurrence if it's off screen, maybe highlight it), without zooming in.
- [x] Shape keys are E ellipse, R rectangle, L line; rotate 90° moved to Alt+R / Alt+Shift+R. **Decided (Greg, 2026-11-09).** Dropped: M and \ as extra keys, to keep one key per shape. (2026-11-09, 2.18.0)
- [x] Hold Ctrl (Cmd on Mac) while drawing or dragging to skip all snapping: grid, guides and paths. (2026-11-09, 2.18.0)
- [x] The path being snapped onto lights up in its own `--snap` colour (orange), not just a ring. (2026-11-09, 2.18.0)
- [x] Alt+X slices only the selected paths where they cross others; the paths they cross stay whole. The Cut tool is now Scissors, and the act is "slicing" everywhere; "Cut" is only the clipboard. **Decided (Greg, 2026-11-09).** (2026-11-09, 2.19.0)

## Fonts

- [ ] Troutman's guides are off (x-height 20.1, descender −40.2). They were guessed from the letter shapes on import. Set them by hand in Font settings → Guides and save.

## Typesetter

- [ ] Effects (the old typesetter had a stub for drawing segment points and curve normals).
- [ ] Text on a path, and named alternate glyphs in text.
- [ ] Ligatures: draw combined glyphs (fi, fl, ff, ffi, ffl) and have text setting swap them in. Top-heavy f's like Garfield 2015's crowd whatever follows: "fi" can only kern so far before the l in "fill" runs into the hook (it's eased off with fi −16 and il +2 for now). Needs the named alternate glyphs above.
