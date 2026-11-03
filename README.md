# gregfont

A small browser tool for setting text in a handful of custom single-line (stroke-based) fonts and exporting the result as SVG.

Each glyph is drawn as a stroked path in Illustrator, exported to SVG, and rendered on a canvas with [Paper.js](http://paperjs.org/). Because the letters are strokes rather than filled outlines, you can change stroke weight and end-cap style on the fly, which makes the output useful for plotters, laser/CNC engraving and other line-based work.

## Running it

There is no build step. Run the dev server from the repo root and open http://localhost:8000:

```sh
python tools/server.py        # or: python tools/server.py 8080
```

It serves `src/` and also lets the browser save font files back into `src/fonts/` (used by the editor and importer). Any other static server pointed at `src/` works for just setting text. Opening `index.html` straight from disk won't work, because fonts are loaded with `fetch`.

## Using it

Type into the text box at the bottom-left; the canvas re-renders as you type. For text over 600 characters, live updates stop and a ↻ button appears to rebuild manually.

| Control | What it does |
| --- | --- |
| **Font** | Fonts listed in `src/fonts/fonts.json`. Switching font resets spacing to that font's defaults. |
| **Letter Spacing** | Advance per character (monospace) and width of a space. |
| **Line Height** | Distance between lines. |
| **Monospace** | Fixed-width cells vs. proportional spacing using each glyph's side bearings and kerning. |
| **Tracking** | Extra space after each letter when *not* monospaced (can be negative). |
| **End Caps** | Keep the font's caps, or force butt / round / square. |
| **Stroke Weight** | Stroke width of every glyph. |
| **Font Scale** | Overall scale, clamped to 0.333–2. |
| **Word Wrap / Wrap Width** | Wrap at spaces once a line passes the given width. |
| **EXPORT SVG** | Downloads the canvas as an SVG, named from the first 12 characters of the text. |

**Ctrl+D** shows a hidden *Samples* menu with test texts (initial caps, lowercase, kerning pairs, readability paragraphs) for checking spacing.

## Fonts

| Font | Cell | Default spacing | Glyphs |
| --- | --- | --- | --- |
| Sutton | 30×60 | Monospaced | Letters, digits, punctuation (+ alternate `&`, apostrophe) |
| Nassau | 60×60 | Proportional | Letters, digits, punctuation |
| Kosciuszko | 20×60 | Monospaced | Letters only |
| Troutman | 40×60 | Proportional | Letters, digits, punctuation |

Curly quotes, the apostrophe `’` and en/em dashes fall back to the plain `"` `'` `-` glyphs when a font doesn't have them.

## Font format

Each font is a single JSON file in `src/fonts/`, listed in `src/fonts/fonts.json` (which sets the dropdown order). Glyphs are stroked paths stored as SVG path data, in cell coordinates: x grows right, y grows down, the cap line is at y=0 and the baseline at y=cell height. Descenders go below the cell.

```json
{
	"format": "gregfont",
	"version": 1,
	"name": "Sutton",
	"cell":    { "width": 30, "height": 60 },
	"guides":  { "cap": 0, "xHeight": 30, "baseline": 60, "descender": 80 },
	"style":   { "strokeCap": "round", "strokeJoin": "round", "miterLimit": 10 },
	"spacing": { "monospaced": true, "letterSpacing": 45, "lineHeight": 90 },
	"kerning": { "AV": -4 },
	"glyphs": {
		"a": {"lsb":3,"rsb":3,"paths":[{"d":"M30,45l0,15"},{"d":"M0,45c0,-8.3 ..."}]}
	}
}
```

- **glyphs** are keyed by the character itself. Longer keys (`"ampersandalt"`) are named extra glyphs, like alternates, which text setting doesn't use yet.
- **lsb / rsb** (left/right side bearing) are the gaps, in font units, before and after the glyph's ink when setting proportionally. Monospaced setting ignores them and places the cell as drawn.
- **paths** can override `strokeCap`, `strokeJoin` or `miterLimit` from `style`.
- **kerning** maps two-character pairs to an adjustment added between them (proportional only).
- **spacing** holds the defaults the typesetter's controls reset to.
- The file is written one glyph per line, so git diffs show which glyphs changed.

All reading, writing and importing lives in `src/js/gregfont.js`.

## Adding a font from Illustrator

The importer reads the same layout the original fonts were drawn in:

1. Draw each glyph on a `W×H` artboard as its own group/layer named `char-<name>`. Letters and digits use themselves (`char-a`, `char-A`, `char-7`). Symbols use words (`char-dash`, `char-question`, `char-parenthleft`, …); see `GLYPH_NAMES` in `gregfont.js`. Any other name becomes a named extra glyph. Illustrator's `_1_`-style suffixes on duplicate names are ignored.
2. Export to SVG. Any shapes work (paths, lines, polylines, polygons, circles), nested groups too, and stroke styles from Illustrator's CSS classes are kept.
3. With the dev server running, open the typesetter and run this in the browser console:

   ```js
   const svg = await (await fetch('fonts/myfont_all_40x60.svg')).text(); // put the SVG in src/fonts/ first
   const { font } = GregFont.fromSVG(paper, svg, { name: 'Myfont', monospaced: false });
   await GregFont.saveToServer('myfont.json', font);  // writes src/fonts/myfont.json and adds it to fonts.json
   ```

   Side bearings default to 10% of the cell width, and the x-height and descender guides are measured from the `x` and descender letters.

The editor (in progress) will make this a button and let you adjust spacing visually.

## Project layout

```
src/
  index.html          Typesetter UI: canvas + settings panel
  js/main.js          Typesetter: layout, rendering, export, sample texts
  js/gregfont.js      Font format: load/save, Paper.js glyph building, SVG import
  style/main.css
  libs/               jQuery 3.1.1, Paper.js 0.10.2 (vendored)
  fonts/
    fonts.json        Which fonts to load, in dropdown order
    <font>.json       Fonts
    <font>_all_WxH.ai Original Illustrator sources
tools/
  server.py           Dev server (static files + saving fonts)
textSample*.txt       Scratch character sets for testing
```

## Ideas / TODO

From the notes in `main.js`:

- Copy SVG to clipboard
- Text alignment (left / right / center)
- Force upper or lower case
- Color
- Effects. There's a stub `effects()` hook with experiments that draw segment points and curve normals.
- Move effects and sample texts into a separate dev panel
