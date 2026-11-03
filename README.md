# gregfont

Browser tools for making and using custom single-line (stroke-based) fonts:

- **Typesetter** (`index.html`): set text in any of the fonts and export it as SVG.
- **Editor** (`editor.html`): draw glyphs with a bezier pen, set spacing and kerning, and import fonts drawn in Illustrator.

Glyphs are stroked paths rendered with [Paper.js](http://paperjs.org/). Because the letters are strokes rather than filled outlines, you can change stroke weight and end-cap style on the fly, which makes the output useful for plotters, laser/CNC engraving and other line-based work.

## Running it

There is no build step. Run the dev server from the repo root, then open http://localhost:8000 (typesetter) or http://localhost:8000/editor.html (editor):

```sh
python tools/server.py        # or: python tools/server.py 8080
```

It serves `src/` and also lets the editor save font files straight into `src/fonts/`. Any other static server pointed at `src/` works for just setting text. Opening `index.html` straight from disk won't work, because fonts are loaded with `fetch`.

## Typesetter

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

## Editor

Open `editor.html` (or **Edit fonts ↗** in the typesetter). Pick a font at the top, pick a glyph on the left, and draw on the canvas. The canvas works in font units, the same numbers stored in the font file.

The layout follows desktop drawing apps:

- **Tools** are in the palette down the left of the canvas: Select, Direct select, Pen, Ellipse and Cut. A hint line at the bottom of the canvas explains the current tool.
- **Commands** are in the menus at the top: **File** (new, import, save), **Edit** (undo, clipboard, delete, select all), **Path** (join, slice, rotate, flip) and **View** (fit, snap). Each menu item shows its keyboard shortcut.
- **Options** for drawing (snap, grid size, on-screen stroke width, auto-slice) are in the bar above the canvas.

| Tool / command | How |
| --- | --- |
| **Select** <kbd>V</kbd> | Picks whole paths. Click a path, Shift-click to add more, or drag a box. A box appears around the selection: drag its handles to scale (Shift keeps proportions, Alt scales from the center), or drag just outside a corner to rotate (Shift for 15° steps). Drag a path to move it, Alt-drag to move a copy. |
| **Direct** <kbd>A</kbd> | Picks points and the segments between them. Click a point, or click a line to pick just that segment (Flash-style). Shift-click to add more, or drag a box around points. Drag to move them, drag handles to reshape curves (Alt breaks a smooth point into a corner), Alt-drag to move a copy. |
| **Pen** <kbd>P</kbd> | Click for corner points, click-drag for curves. Click the first point to close the path, or press Enter/Esc to finish it open. Click the end of an existing open path to continue it, or to join onto it while drawing. |
| **Ellipse** <kbd>E</kbd> | Drag out an ellipse; Shift for a circle. |
| **Cut** <kbd>C</kbd> | Click a path to cut it there. Cutting a closed shape opens it. |
| **Slice** <kbd>X</kbd> | Cuts the selected paths (or the whole glyph if nothing is selected) wherever they cross, so every piece between crossings can be picked up on its own. With **Auto-slice** on, new pen and ellipse strokes slice whatever they cross as soon as they're drawn. |
| **Join** <kbd>Ctrl+J</kbd> | Joins the selected open paths into one, closest ends first. Ends that touch become one point; ends that don't get a straight line. With two end points selected, joins exactly those. With one open path selected, closes it. Dragged points snap onto other points, so pieces line up exactly before joining. |
| Rotate / flip | <kbd>R</kbd> rotates the selection 90° clockwise (Shift+R the other way); <kbd>H</kbd> flips it horizontally (Shift+H vertically). |
| Copy / cut / paste | Ctrl+C copies the selection: whole paths, or just the selected segments when only part of a path is selected. Ctrl+X cuts. Ctrl+V pastes in place, into whichever glyph is open, so it also copies between glyphs. Nothing selected copies the whole glyph. |
| Delete | Removes the selected paths or segments. Deleting a point also removes the segments on either side of it, like Illustrator. **Alt+Delete** removes points but keeps the path joined. |
| Curve ↔ corner | Double-click a point. |
| Add a point | Double-click a line. |
| Spacing | Drag the pink dashed lines (left/right side bearings) or type the numbers in the Glyph panel. |
| Nudge | Arrow keys move the selection 1 unit, Shift + arrows one grid step. |
| Snap | <kbd>G</kbd> toggles snapping to the grid; set the grid size in the toolbar. |
| View | Mouse wheel zooms, Space-drag or middle-drag pans, <kbd>F</kbd> fits the glyph. |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (glyph edits). |
| Save | Ctrl+S. Writes `src/fonts/<file>.json`; a new font is also added to `fonts.json`. Without the dev server, the file is downloaded instead. |

The **Font** panel sets the name, cell size, guide lines, default stroke caps and joins, and the typesetter defaults. Individual paths can override caps and joins from the **Glyph** panel. To add a glyph that isn't in the grid (é, ß, or a named alternate), type it into the box under the grid.

The **preview** strip at the bottom sets a line of text with the font as you edit. Click a letter to edit it. Shift-click two letters to set up a kerning pair, then enter the amount in the **Kerning** panel.

## Adding a font from Illustrator

1. Draw each glyph on a `W×H` artboard as its own group/layer named `char-<name>`. Letters and digits use themselves (`char-a`, `char-A`, `char-7`). Symbols use words (`char-dash`, `char-question`, `char-parenthleft`, …); the editor's Glyph panel shows the layer name for each glyph, and the full list is `GLYPH_NAMES` in `gregfont.js`. Any other name becomes a named extra glyph. Illustrator's `_1_`-style suffixes on duplicate names are ignored.
2. Export to SVG. Any shapes work (paths, lines, polylines, polygons, circles), nested groups too, and stroke styles from Illustrator's CSS classes are kept.
3. In the editor, click **Import SVG** and pick the file. The font name comes from the file name (`myfont_all_40x60.svg` becomes "Myfont"). The cell size comes from the artboard. Side bearings start at 10% of the cell width, and the x-height and descender guides are measured from the `x` and descender letters.
4. Check the spacing in the preview, adjust, and **Save**.

## Project layout

```
src/
  index.html          Typesetter UI: canvas + settings panel
  editor.html         Editor UI
  js/main.js          Typesetter: rendering, export, sample texts
  js/editor.js        Editor: tools, glyph grid, inspector, preview, saving
  js/gregfont.js      Font format: load/save, text layout, Paper.js glyphs, SVG import
  style/main.css, style/editor.css
  libs/               jQuery 3.1.1 (typesetter), Paper.js 0.12.18 core (vendored)
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
