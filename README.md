# gregfont

Browser tools for making and using custom single-line (stroke-based) fonts:

- **Typesetter** (`index.html`): set text in any of the fonts and export it as SVG.
- **Editor** (`editor.html`): draw glyphs with a bezier pen, set spacing and kerning, and import fonts drawn in Illustrator.

Glyphs are stroked paths rendered with [Paper.js](http://paperjs.org/). Because the letters are strokes rather than filled outlines, you can change stroke weight and end-cap style on the fly, which makes the output useful for plotters, laser/CNC engraving and other line-based work.

## Running it

There is no build step. Either way below works.

**Open the files directly.** Drag `src/index.html` (typesetter) or `src/editor.html` (editor) into the browser. Browsers block reading other files from a page opened this way, so the fonts come from `src/fonts/fonts.js`, a copy of every font that loads as a script. When you save in the editor, Chrome and Edge ask once for the `src/fonts` folder and then save straight into it, keeping `fonts.json` and `fonts.js` up to date. Other browsers download the font file instead.

**Or run the dev server** from the repo root, then open http://localhost:8000 (typesetter) or http://localhost:8000/editor.html (editor):

```sh
python tools/server.py        # or: python tools/server.py 8080
```

It serves `src/`, and the editor saves through it with no folder prompt. Other static servers (like VS Code's Live Server extension) work too, and saving then falls back to the folder prompt. Live Server reloads the page whenever a file changes, including when you save a font, so set `liveServer.settings.ignoreFiles` to include `src/fonts/**`.

`fonts.js` is rebuilt whenever the editor or the dev server saves. After changing a font file any other way (by hand, or with git), rebuild it:

```sh
python tools/build_fonts.py
```

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
- **paths** can override `strokeCap`, `strokeJoin` or `miterLimit` from `style`. Paths the editor has grouped share a `group` number; the typesetter ignores it.
- **kerning** maps two-character pairs to an adjustment added between them (proportional only).
- **spacing** holds the defaults the typesetter's controls reset to.
- The file is written one glyph per line, so git diffs show which glyphs changed.

All reading, writing and importing lives in `src/js/gregfont.js`.

## Editor

Open `editor.html` (or **Edit fonts ↗** in the typesetter). Pick a font at the top, pick a glyph on the left, and draw on the canvas. The canvas works in font units, the same numbers stored in the font file.

The layout follows desktop drawing apps:

- **Tools** are in the palette down the left of the canvas: Select, Direct select, Pen, Anchor point, Shapes and Cut. A hint line at the bottom of the canvas explains the current tool.
- **Commands** are in the menus at the top: **File** (new, import and export SVG, save), **Edit** (undo, clipboard, delete, select all), **Object** (group, join, slice, rotate, flip, smooth/corner points) and **View** (fit, snap). Each menu item shows its keyboard shortcut.
- **Options** for drawing (snap, grid size, on-screen stroke width, auto-slice, and which shape the Shapes tool draws) are in the bar above the canvas.

| Tool / command | How |
| --- | --- |
| **Select** <kbd>V</kbd> | Picks whole paths. Click a path, Shift-click to add more, or drag a box. A box appears around the selection: drag its handles to scale (Shift keeps proportions, Alt scales from the center), or drag just outside a corner to rotate (Shift for 15° steps). Drag a path to move it, Alt-drag to move a copy. |
| **Direct** <kbd>A</kbd> | Picks points and the segments between them. Click a point, or click a line to pick just that segment (Flash-style). Shift-click to add more, or drag a box around points. Drag to move them, drag handles to reshape curves (Alt breaks a smooth point into a corner), Alt-drag to move a copy. |
| **Pen** <kbd>P</kbd> | Click for corner points, click-drag for curves. Click the first point to close the path, or press Enter/Esc to finish it open. Click the end of an existing open path to continue it, or to join onto it while drawing. |
| **Anchor point** <kbd>Shift+C</kbd> | Like Illustrator's: drag out from a point to pull out curve handles, click a point to make it a sharp corner, drag a handle to move it on its own. **Object → Make points smooth / corners** does the same for every selected point at once. |
| **Shapes** <kbd>E</kbd> <kbd>M</kbd> <kbd>\</kbd> | One tool for ellipses, rectangles and lines; pick which in the bar above the canvas, or press E (ellipse), M (rectangle) or \ (line). Drag to draw. Shift makes a circle or square, or keeps a line to 45° steps. |
| **Cut** <kbd>C</kbd> | Click a path to cut it there, or drag a line across paths to cut everything it crosses; the line itself isn't kept. Shift keeps the line to 45° steps. Cutting a closed shape opens it. |
| **Slice** <kbd>X</kbd> | Cuts the selected paths (or the whole glyph if nothing is selected) wherever they cross, so every piece between crossings can be picked up on its own. With **Auto-slice** on, new pen and shape strokes slice whatever they cross as soon as they're drawn. |
| **Group** <kbd>Ctrl+G</kbd> | Groups the selected paths so the Select tool picks them up, moves and transforms them together. <kbd>Ctrl+Shift+G</kbd> ungroups. The Direct tool still edits single points inside a group. Pieces cut from a grouped path stay in the group; pasted or Alt-dragged copies become a new group. |
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
| Save | Ctrl+S. Writes `src/fonts/<file>.json`; a new font is also added to `fonts.json`. Through the dev server it saves directly; from a page opened from disk (or another server), Chrome and Edge ask once for the `src/fonts` folder. Browsers without folder access download the file instead. |

The **Font** panel sets the name, cell size, guide lines, default stroke caps and joins, and the typesetter defaults. Individual paths can override caps and joins from the **Glyph** panel. To add a glyph that isn't in the grid (é, ß, or a named alternate), type it into the box under the grid.

The **preview** strip at the bottom sets a line of text with the font as you edit. Click a letter to edit it. Shift-click two letters to set up a kerning pair, then enter the amount in the **Kerning** panel.

## Working in Illustrator

The JSON file is the font. Illustrator is for drawing, and SVG is how shapes move between the two.

### Editing an existing font

1. **File → Export SVG for Illustrator** downloads `<font>_grid.svg`. It's the whole font on one artboard, one glyph per cell in a grid. Each glyph is its own `char-<name>` layer, and grouped paths are nested groups. Two reference layers show each cell's box and label, the cap / x-height / baseline / descender guides, and pink side-bearing marks. Standard characters the font doesn't have yet get an empty labelled cell.
2. Edit in Illustrator and save as SVG. Moving a glyph within its cell moves it in the font. To add a glyph, make a new `char-<name>` layer and draw it in an empty cell; any empty spot on the grid works.
3. **File → Update shapes from SVG…** reads it back into the open font. Only shapes change. Spacing, kerning and font settings stay as they are, since Illustrator would drop them. Glyphs that didn't change are left untouched, glyphs missing from the SVG are kept, and new glyphs get default spacing. One Ctrl+Z undoes the whole update.

Import only reads the `char-` layers, so the reference layers can be edited, hidden or deleted. The grid's size is stored in the name of the cells layer (`gregfont-grid-…`); keep that layer, or the import will treat the file as the old stacked layout.

### Starting a font in Illustrator

1. Draw each glyph as its own layer named `char-<name>`. Letters and digits use themselves (`char-a`, `char-A`, `char-7`). Symbols use words (`char-dash`, `char-question`, `char-parenthleft`, …); the editor's Glyph panel shows the layer name for each glyph, and the full list is `GLYPH_NAMES` in `gregfont.js`. Any other name becomes a named extra glyph. Illustrator's `_1_`-style suffixes on duplicate names are ignored.
   Either stack every glyph on one `W×H` artboard, as the original fonts were, or start from an exported grid.
2. Export to SVG. Any shapes work (paths, lines, polylines, polygons, circles), and stroke styles from Illustrator's CSS classes are kept.
3. **File → New font from SVG…** creates the font. The name comes from the file name (`myfont_all_40x60.svg` becomes "Myfont"), and the cell size from the artboard or grid. Side bearings start at 10% of the cell width, and the x-height and descender guides are measured from the `x` and descender letters.
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
    fonts.js          Generated copy of all fonts, for pages opened from disk
    <font>.json       Fonts
    <font>_all_WxH.ai Original Illustrator sources
tools/
  server.py           Dev server (static files + saving fonts)
  build_fonts.py      Rebuilds src/fonts/fonts.js
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
