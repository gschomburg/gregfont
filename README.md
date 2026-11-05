# gregfont

Browser tools for making and using custom single-line (stroke-based) fonts:

- **Typesetter** (`index.html`): lay out text boxes on a page in any of the fonts and save it as SVG for a plotter.
- **Editor** (`editor.html`): draw glyphs with a bezier pen, set spacing and kerning, and import fonts drawn in Illustrator.

Glyphs are stroked paths rendered with [Paper.js](http://paperjs.org/). Because the letters are strokes rather than filled outlines, you can change stroke weight and end-cap style on the fly, which makes the output useful for plotters, laser/CNC engraving and other line-based work.

## Running it

There is no build step. Either way below works.

**Open the files directly.** Drag `src/index.html` (typesetter) or `src/editor.html` (editor) into the browser. Browsers block reading other files from a page opened this way, so the fonts come from `src/fonts/fonts.js`, a copy of every font that loads as a script. When you save in the editor, Chrome and Edge ask once for the `src/fonts` folder and then save straight into it, keeping `fonts.json` and `fonts.js` up to date. Other browsers download the font file instead.

**Or run the dev server** from the repo root, then open http://localhost:8000 (typesetter) or http://localhost:8000/editor.html (editor):

```sh
python tools/server.py        # or: python tools/server.py 8080
```

It serves `src/`, and the editor saves through it with no folder prompt. Other static servers (like VS Code's Live Server extension) work too, and saving then falls back to the folder prompt. Live Server reloads the page whenever a file changes, including when you save a font, so the repo's `.vscode/settings.json` sets `liveServer.settings.ignoreFiles` to skip `src/fonts/**`. It only applies when VS Code has the repo folder itself open.

`fonts.js` is rebuilt whenever the editor or the dev server saves. After changing a font file any other way (by hand, or with git), rebuild it:

```sh
python tools/build_fonts.py
```

## Version

Hover the **gregfont** name in either page's top bar to see the version and its date. Before publishing, bump it:

```sh
python tools/bump_version.py 2.0.2
```

That writes the version and today's date into `src/js/version.js`, and adds `?v=2.0.2` to every script and stylesheet link in the two pages. Web hosts often tell browsers to keep `.js` and `.css` files for weeks, so without a new `?v=` visitors keep running the old scripts against the new pages. Use the first number for changes that break font or layout files, the middle for features, the last for fixes.

## Deploying

The live copy is at https://www.gregschomburg.com/gregfont/ (DreamHost). Everything in `src/` is uploaded; nothing outside it is.

1. Commit first, then bump the version: `python tools/bump_version.py X.Y.Z`, and commit that.
2. Connect to the server by SFTP (FileZilla).
3. Upload the contents of `src/` into the `gregfont/` folder, replacing what's there.
4. Open the live page, hover the gregfont name and check that the version is the new one.

The live site has no save server, so the editor saves to a picked folder (Chrome, Edge) or downloads the font.

## Typesetter

Open `index.html`. It sets text on a page, ready for a plotter. Everything is measured in pixels at 96 per inch (A4 landscape is 1123 × 794), which is how SVG sizes things; plotter software converts to millimetres.

The layout matches the editor: menus and tips in the top bar, the selected text's **type settings on the left**, the page in the middle, and the **document on the right** (the list of texts, page size, and plot options).

- **Text boxes**, like Illustrator's type tool. With the Text tool (<kbd>T</kbd>), click the page to start a line of text (its baseline sits where you clicked), or drag to make a box that wraps at its width. A page can hold any number of texts, each with its own font and settings. Click a text with the Text tool, or double-click it with Select, to edit; Esc stops editing. An emptied text is removed.
- **Select** (<kbd>V</kbd>): click a text to select it, drag to move it (Shift keeps it level or plumb), and drag its side handles to set where it wraps. Arrow keys nudge it (Shift for 10 px). Ctrl+D duplicates, Delete removes.
- **Left panel** (the selected text, or the settings the next new text gets when nothing is selected): font, size (the font's cell height in px), pen width, stroke ends, pen colour, letter spacing / tracking / line height (in px), monospaced, alignment, case (as typed, UPPER, lower), and the box's X, Y, wrap width and rotation. Changing font resets spacing to that font's defaults. Number fields can be dragged sideways.
- **Right panel**: the texts on the page (click to select, double-click to edit), the page size (presets, portrait / landscape, or your own size, plus a margin guide), and **Plot**: the stroke count and pen-up travel, **Order strokes to cut pen-up travel** (reorders and flips strokes across the whole page when saving and playing), **Play** (draws the page stroke by stroke) and **Copy SVG**.
- **Extend ends to guides** (Character section, or Text menu) is for heavy strokes with flat ends. Round letters and corners grow outward by half the stroke as it gets heavier, but a flat stroke end stops where it was drawn, so stems look short next to an "o". With this on, ends that finish on (or within a hair of) the baseline, x-height, cap height or descender are lengthened just enough that their outermost corner lands half a stroke past the line, like the rest of the ink. A straight stem gets half a stroke; an end cut at an angle (the arms of an x, an a's terminal) already has a corner partway there, so it gets less, and ends running nearly flat get nothing. Round ends just snap onto the line. Tails that end away from the guides are left alone. It only changes how that text is drawn and saved, never the font. A plotter's round pen already grows its ends, so it's mainly for SVGs used as artwork.
- **Plot preview** (in the bar above the page) dashes the pen-up moves.
- **Save SVG** (<kbd>Ctrl+S</kbd>) writes the page as plain stroked paths, one group per text (or one group in plotting order). The layout is stored inside the SVG too, in a `<metadata>` block, so **File → Open SVG…** (<kbd>Ctrl+O</kbd>) brings it back for editing. Fonts are referenced by file name. In Chrome and Edge, Save writes back to the same file after the first time; Save as… picks a new one. Other browsers download it.
- The page also keeps itself in the browser between visits. Wheel zooms, Space-drag or the Hand tool pans, Ctrl+0 fits the page.

## Fonts

| Font | Cell | Default spacing | Glyphs |
| --- | --- | --- | --- |
| Sutton | 30×60 | Monospaced | Letters, digits, punctuation (+ alternate `&`, apostrophe) |
| Nassau | 60×60 | Proportional | Letters, digits, punctuation |
| Kosciuszko | 20×60 | Monospaced | Letters only |
| Troutman | 40×60 | Proportional | Letters, digits, punctuation |
| Bleeker_03 | 51.5×60 | Proportional | Capitals, 0 and 2 |
| Clinton | 40×60 | Proportional | Just started (1 glyph) |
| Garfield 2015 | 40×60 | Proportional | Capitals, some digits |
| Locust 28 | 27.5×45 | Proportional | Capitals, digits |
| Halsey | 32×60 | Monospaced | Letters, digits. A round-ended sans drawn in code |
| Myrtle | 32×60 | Monospaced | Letters, digits. Halsey's letters drawn as a looping coil |
| Mercer | 32×60 | Monospaced | Letters, digits. Every character is one continuous stroke, with 45° chamfers |
| Delancey | 40×60 | Proportional | Letters, digits. Geometric sans with very uneven widths (i is one stroke, W is 88 wide) |
| Hester | 16×60 | Proportional | Letters, digits. Narrow and tight; ascenders sweep back over the letter before, descenders forward under the next |
| Astor | 48×48 | Monospaced | Symbols: space pictograms on a–z, runes on A–Z, moon phases on 0–9 |
| Lafayette | 40×60 | Proportional | Letters, digits. A clean serif; every anchor on a 5-unit grid |

Halsey, Myrtle, Mercer, Delancey, Hester, Astor and Lafayette were generated by the scripts in `tools/` and are marked **generated**; the rest are marked **proof** (see `status` under Font format).

Curly quotes, the apostrophe `’` and en/em dashes fall back to the plain `"` `'` `-` glyphs when a font doesn't have them.

## Font format

Each font is a single JSON file in `src/fonts/`, listed in `src/fonts/fonts.json` (which sets the dropdown order). Glyphs are stroked paths stored as SVG path data, in font units laid out like type: the origin (0,0) sits on the baseline at the left of the cell, x grows right and **y grows up**. So the cap line is a positive height and descenders go negative. The editor marks the origin with a small "0,0".

```json
{
	"format": "gregfont",
	"version": 2,
	"name": "Sutton",
	"cell":    { "width": 30, "height": 60 },
	"guides":  { "cap": 60, "xHeight": 30, "descender": -20 },
	"customGuides": [ { "axis": "h", "at": 45 } ],
	"style":   { "strokeCap": "round", "strokeJoin": "round", "miterLimit": 10 },
	"spacing": { "monospaced": true, "letterSpacing": 45, "lineHeight": 90 },
	"kerning": { "AV": -4 },
	"glyphs": {
		"a": {"lsb":3,"rsb":3,"paths":[{"d":"M30,45l0,15"},{"d":"M0,45c0,-8.3 ..."}]}
	}
}
```

- **glyphs** are keyed by the character itself. Longer keys (`"ampersandalt"`) are named extra glyphs, like alternates, which text setting doesn't use yet.
- **cell** is a box sitting on the baseline, from the origin up to (width, height). It's a drawing guide: resizing it never moves a glyph. In text, a line's top is the cell height above its baseline.
- **guides** are heights above the baseline, which is always 0.
- **customGuides** are extra guide lines you add in the editor: `"h"` lines at a height above the baseline, `"v"` lines at a distance right of the origin. They're named A, B, C… by their place in the list, so they have no names in the file. Left out when there are none. The typesetter ignores them.
- **lsb / rsb** (left/right side bearing) are the gaps, in font units, before and after the glyph's ink when setting proportionally. Monospaced setting ignores them and places each glyph's origin as drawn, `letterSpacing` apart.
- **paths** can override `strokeCap`, `strokeJoin` or `miterLimit` from `style`. Paths the editor has grouped share a `group` number; the typesetter ignores it.
- **kerning** maps two-character pairs to an adjustment added between them (proportional only).
- **spacing** holds the defaults the typesetter's controls reset to.
- **status** is where the font is at: `"generated"` (made by a script in `tools/`, not yet worked on by hand), `"draft"` (still being drawn), `"proof"` (all there, being tried out) or `"final"`. A font without one is final. Both apps' font lists group fonts under Final, Proof, Draft and Generated headings. New fonts start as drafts; set it under Font settings → Status.
- **revision** and **modified** count saves: each Save in the editor adds one to the revision and sets the date. The typesetter shows the revision under the font picker and names each font's revision in the SVGs it saves (in the `<desc>`), so you can tell which version a plot used.
- The file is written one glyph per line, so git diffs show which glyphs changed.
- Version 1 files (y down, origin at the cell's top-left, an explicit baseline guide) still load; they're converted on the way in and saved as version 2.

All reading, writing and importing lives in `src/js/gregfont.js`.

## Editor

Open `editor.html` (or **Editor ↗** in the typesetter). Pick a font and a glyph on the left, and draw on the canvas. The canvas works in font units, the same numbers stored in the font file.

The layout follows desktop drawing apps:

- **The left panel is the font**: the font picker, the font's settings (name, cell size, guides, typesetter defaults, default stroke ends and corners) and the glyph grid. Font settings and Guides fold away, and remember whether they were left open.
- **The right panel is the selected glyph**: a header with a preview, its code point and Illustrator layer name, then foldable sections that remember whether they're open: **Info** (the selection's position: X / Y of a single point; the bottom-left corner plus width and height for anything bigger, all editable: X / Y move it, so X 0 / Y 0 puts it on the origin, and W / H scale it from that corner), **Selected path** (end caps and corners), **Stroke inspect** (stroke order, for plotters) and **Spacing** (side bearings, and the kerning pairs the glyph is part of). Clear and Delete are at the bottom.
- **Tools** are in the tab on the left edge of the canvas: Select, Direct select, Pen, Anchor point, Shapes and Cut. Tips cycle one at a time in the middle of the top bar, starting with the current tool's (click one for the next; Help → Show tips turns them off).
- **Commands** are in the menus at the top: **File** (new, import and export SVG, save), **Edit** (undo, clipboard, delete, select all), **Object** (group, join, slice, rotate, flip, smooth/corner points) **View** (fit, snap, show or hide the grid, guides and cell, light mode) and **Help** (tips). Each menu item shows its keyboard shortcut.
- **Options** for drawing (snapping, grid size, on-screen stroke width, auto-slice, and which shape the Shapes tool draws) are in the bar above the canvas.
- **Number fields can be dragged**: sideways for most, up and down for the guides (the line moves the way you drag). Shift drags in bigger steps, Alt in smaller ones. Click a field to type instead. A whole drag on a side bearing is one undo step.
- **Light / dark**: the sun/moon button in the top bar (or View → Light mode). In the editor, dark mode puts dark panels around a light canvas and light mode puts light panels around a dark canvas with white strokes. In the typesetter the canvas and page follow the panels, and in dark mode near-black pens show as white on screen (saved SVGs keep the real colours). The choice is remembered.

| Tool / command | How |
| --- | --- |
| **Select** <kbd>V</kbd> | Picks whole paths. Click a path, Shift-click to add more, or drag a box. A box appears around the selection: drag its handles to scale (Shift keeps proportions, Alt scales from the center), or drag just outside a corner to rotate (Shift for 15° steps). Drag a path to move it, Alt-drag to move a copy. |
| **Direct** <kbd>A</kbd> | Picks points and the segments between them. Click a point, or click a line to pick just that segment (Flash-style). Shift-click to add more, or drag a box around points. Drag to move them, drag handles to reshape curves (Alt breaks a smooth point into a corner), Alt-drag to move a copy. |
| **Pen** <kbd>P</kbd> | Click for corner points, click-drag for curves. Click the first point to close the path, or press Enter/Esc to finish it open. Click the end of an existing open path to continue it, or to join onto it while drawing. |
| **Anchor point** <kbd>Shift+C</kbd> | Like Illustrator's: drag out from a point to pull out curve handles, click a point to make it a sharp corner, drag a handle to move it on its own. **Object → Make points smooth / corners** does the same for every selected point at once. |
| **Shapes** <kbd>E</kbd> <kbd>M</kbd> <kbd>\</kbd> | One tool for ellipses, rectangles and lines; pick which in the bar above the canvas, or press E (ellipse), M (rectangle) or \ (line). Drag to draw. Shift makes a circle or square, or keeps a line to 45° steps. |
| **Cut** <kbd>C</kbd> | Click a path to cut it there, or drag a line across paths to cut everything it crosses; the line itself isn't kept. Shift keeps the line to 45° steps. Cutting a closed shape opens it. |
| **Slice** <kbd>X</kbd> | Cuts the selected paths (or the whole glyph if nothing is selected) wherever they cross, so every piece between crossings can be picked up on its own. With **Auto-slice** on, new pen and shape strokes slice whatever they cross as soon as they're drawn. |
| **Stroke inspect** | For plotters: each glyph's strokes are drawn in list order, each from its first point to its last (a closed shape starts and ends at its first point). **Show start points & order** (in the glyph panel's Stroke inspect section, or View → Show stroke order, <kbd>O</kbd>) numbers each stroke's start, marks its end, shows its direction, and dashes the pen-up moves between strokes. **Play** draws the glyph stroke by stroke. **Optimize** finds the order, directions and start points with the least pen-up travel from 0,0 (it checks every combination for glyphs of up to 12 strokes; closed shapes can start at any of their points). Points and curves never move, ties keep the current setup, and it only applies if it's shorter. **Reverse** flips the selected strokes. Object → **Set start point** starts a stroke at the selected point, and **Draw earlier / later** (<kbd>Ctrl+[</kbd> / <kbd>Ctrl+]</kbd>) move strokes in the order. |
| **Group** <kbd>Ctrl+G</kbd> | Groups the selected paths so the Select tool picks them up, moves and transforms them together. <kbd>Ctrl+Shift+G</kbd> ungroups. The Direct tool still edits single points inside a group. Pieces cut from a grouped path stay in the group; pasted or Alt-dragged copies become a new group. |
| **Join** <kbd>Ctrl+J</kbd> | Joins the selected open paths into one, closest ends first. Ends that touch become one point; ends that don't get a straight line. With two end points selected, joins exactly those. With one open path selected, closes it. If a stroke's end touches a closed shape (like the tail of an "a" touching its bowl), selecting both and joining opens the shape at that point and makes them one stroke: around the shape, then on into the tail. With **Snap → Paths** on, dragged points snap onto other paths' points, so pieces line up exactly before joining. |
| Rotate / flip | <kbd>R</kbd> rotates the selection 90° clockwise (Shift+R the other way); <kbd>H</kbd> flips it horizontally (Shift+H vertically). |
| Copy / cut / paste | Ctrl+C copies the selection: whole paths, or just the selected segments when only part of a path is selected. Ctrl+X cuts. Ctrl+V pastes in place, into whichever glyph is open, so it also copies between glyphs (and between editor tabs). Nothing selected copies the whole glyph. **From Illustrator:** turn on Preferences → Clipboard Handling → Copy as SVG, copy some artwork, and Ctrl+V in the editor pastes it as paths, at 1:1, sitting on the baseline at the left of the cell, selected so you can move it into place. Groups with several paths come in as groups. |
| Delete | Removes the selected paths or segments. Deleting a point also removes the segments on either side of it, like Illustrator. **Alt+Delete** removes points but keeps the path joined. |
| Curve ↔ corner | Double-click a point. |
| Add a point | Double-click a line. |
| Spacing | Drag the pink dashed lines (left/right side bearings) by their **lsb / rsb** labels at the top of the canvas (the rest of each line ignores clicks, so selecting near it is safe), or type the numbers in the Glyph panel. |
| Nudge | Arrow keys move the selection 1 unit, Shift + arrows one grid step. Shift while dragging keeps a move straight across or straight up and down. |
| Align | The **Align** buttons in the glyph panel's Info section line things up by their left edges, centres, right edges, tops, middles or bottoms. **To: Selection** lines the selected paths up with each other (a group moves as one; with points picked, each point lines up). **To: Cell** moves the whole selection to the cell: left to 0, right to the cell width, bottom to the baseline, top to the cell height, or centred. With one thing selected it always uses the cell. Object → **Align left edge to 0** and **Align bottom to baseline** do the two most common ones. |
| Snap | Two switches in the bar above the canvas. **Grid** (<kbd>G</kbd>) snaps to the grid; set its size next to it. **Paths** (<kbd>Shift+G</kbd>) snaps onto other paths' points, or failing that onto their lines, when dragging points or handles, placing pen points (and pulling their handles) and drawing shapes; a pink ring shows where. A handle never snaps onto its own point. A nearby path wins over the grid; with both off, points go exactly where you put them. When you drag whole paths, their outline's edges snap too (left, centre, right; top, middle, bottom, including the low point of a curve): onto the guides (baseline, x-height, cap, descender, 0 and the cell edges) when one is close, else onto the grid, whichever edge needs the smallest nudge. So a shape dragged near the baseline sits its real bottom on it. |
| View | Mouse wheel zooms, Space-drag or middle-drag pans. The − / % / + / **Fit** buttons at the right of the bar above the canvas zoom out, go back to 100% (one font unit per pixel), zoom in, and fit the glyph; so do Ctrl+− / Ctrl+= / Ctrl+0, and <kbd>F</kbd> fits too. |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (glyph edits). |
| Save | Ctrl+S. Writes `src/fonts/<file>.json`; a new font is also added to `fonts.json`. Through the dev server it saves directly; from a page opened from disk (or another server), Chrome and Edge ask once for the `src/fonts` folder. Browsers without folder access download the file instead. |

The **scratch pad** is the dashed, full-width tile at the top of the glyph grid: a parts bin for spare shapes. Click it and it works like any glyph (draw, paste pieces in, copy them back out), but it has no spacing, isn't counted, never appears in text, and isn't exported. It's saved with the font, in the file as a glyph named `_scratch`.

The **Font** panel sets the name, cell size, guide lines, default stroke caps and joins, and the typesetter defaults.

**Custom guides**: **+ Add guide** under Guides adds a line of your own, saved with the font. Each gets a full-width row: its letter, an **H / V** switch (across, at a height above the baseline, or up and down, at a distance right of 0,0), its position (drag or type) and × to remove it. They're named A, B, C… in order, each letter with its own colour, so removing B makes C the new B. A new guide starts halfway up the cap height (halfway across the cell for V), stepping past any guide already there. Dragged paths snap to them like the other guides, View → Show guides hides them too, and Export SVG for Illustrator draws them in the reference layer. Individual paths can override caps and joins from the **Glyph** panel. To add a glyph that isn't in the grid (é, ß, or a named alternate), type it into the box under the grid.

The **preview** strip at the bottom sets a line of text with the font as you edit, at the strip's height; text that doesn't fit is cut off at the right. It's monospaced when the font's **Mono** switch (left panel) is on. **Stroke** sets the preview's stroke weight, in font units. **Extend ends to guides** (in the glyph panel's Spacing section) shows the typesetter's option of that name on the canvas and in the preview, so you can check how stems line up with round letters at the current stroke weight; it's view only and never changes the glyph. Click a letter to edit it. Shift-click two letters to set up a kerning pair, then enter the amount in the **Kerning** panel.

The dropdown next to it picks a **sample** instead of your own text: the character set, lowercase, initial caps, kerning pairs and reading paragraphs, for checking spacing. The **Specimen** button at the right of the preview bar (or picking a sample) slides the preview up into a **specimen view** over the glyph canvas. The text is wrapped once, to the view's width, and then you zoom and move around it like the canvas: the wheel (or a trackpad pinch) zooms around the cursor, dragging moves around, and the − / % / + / **Fit** buttons in the bar (or Ctrl+= / Ctrl+− / Ctrl+0) zoom, go back to 100% (one font unit per pixel) or fit the whole specimen in view. Line breaks never change while zooming; reopening the specimen wraps it to the view again. Clicking a letter goes back to editing it; Esc closes the specimen. The sample texts are in `src/js/samples.js`.

## Working in Illustrator

The JSON file is the font. Illustrator is for drawing, and SVG is how shapes move between the two.

### Editing an existing font

1. **File → Export SVG for Illustrator** downloads `<font>_grid.svg`. It's the whole font on one artboard, one glyph per cell in a grid. Each glyph is its own `char-<name>` layer, and grouped paths are nested groups. Two reference layers show each cell's box and label, the cap / x-height / baseline / descender guides, a dot at each glyph's origin (baseline, left of the cell), and pink side-bearing marks. Standard characters the font doesn't have yet get an empty labelled cell.
2. Edit in Illustrator and save as SVG. Moving a glyph within its cell moves it in the font. To add a glyph, make a new `char-<name>` layer and draw it in an empty cell; any empty spot on the grid works.
3. **File → Update shapes from SVG…** reads it back into the open font. Only shapes change. Spacing, kerning and font settings stay as they are, since Illustrator would drop them. Glyphs that didn't change are left untouched, glyphs missing from the SVG are kept, and new glyphs get default spacing. One Ctrl+Z undoes the whole update.

Import only reads the `char-` layers, so the reference layers can be edited, hidden or deleted. The grid's size is stored in the name of the cells layer (`gregfont-grid-…`); keep that layer, or the import will treat the file as the old stacked layout.

### Starting a font in Illustrator

1. Draw each glyph as its own layer named `char-<name>`. Letters and digits use themselves (`char-a`, `char-A`, `char-7`). Symbols use words (`char-dash`, `char-question`, `char-parenthleft`, …); the editor's Glyph panel shows the layer name for each glyph, and the full list is `GLYPH_NAMES` in `gregfont.js`. Any other name becomes a named extra glyph. Illustrator's `_1_`-style suffixes on duplicate names are ignored.
   Either stack every glyph on one `W×H` artboard, as the original fonts were, or start from an exported grid.
2. Export to SVG. Any shapes work (paths, lines, polylines, polygons, circles), and stroke styles from Illustrator's CSS classes are kept.
3. **File → New font from SVG…** creates the font. The name comes from the file name (`myfont_all_40x60.svg` becomes "Myfont"), and the cell size from the artboard or grid. Side bearings start at 10% of the cell width, and the x-height and descender guides are measured from the `x` and descender letters.
4. Check the spacing in the preview, adjust, and **Save**.

### Starting a font from a drawing that isn't sorted

For a sheet of letters that was never organised into `char-` layers, make each glyph its own group in Illustrator, save as SVG, and use **File → New font from shapes…** (**New font from SVG…** also lands here when the file has no `char-` layers).

Every group (or loose path) becomes a tile, in reading order: rows top to bottom, left to right. Illustrator's layers and wrapper groups are looked through; text and images are left out.

- **Press the key** for the selected shape's glyph. It moves to *Done* and the next shape is selected, so you can go through the sheet from the keyboard. Every key types its own character (`;` too); the editor's shortcuts are off while the window is open.
- **Backspace** clears a shape's glyph, **Delete** skips it, the **arrow keys** and **Tab** move. Click a done shape and type to change it. Giving a glyph to a second shape takes it from the first.
- **Named glyphs** (`ampersandalt`, or a symbol's name like `ampersand`) go in the box in the side panel.
- **Merge**: Shift-click shapes that belong together (an i drawn as a stem and a separate dot), then **Ctrl+G**.
- **Baselines**: shapes are sorted into rows, and each row's baseline is where most of its shapes end, so descenders hang below. It's the pink line on each tile; drag it (or the *Row baseline* field) to fix a row.
- The **Characters** map shows what's been drawn; click one to go to its shape, or an empty one to give it to the selected shape.
- **Create font** (Ctrl+Enter) makes a new font named after the file. Nothing is scaled: a unit in the file is a unit in the font. The cell height is the capitals' height (or the tallest glyph's), the x-height and descender are measured from the letters, and spacing starts at a tenth of the cell width. It opens unsaved; check the guides and spacing, then Save.

## Project layout

```
src/
  index.html          Typesetter UI
  editor.html         Editor UI
  js/typesetter.js    Typesetter: text boxes, page, plot, save/open SVG
  js/editor.js        Editor: tools, glyph grid, inspector, preview, specimen, saving
  js/gregfont.js      Font format: load/save, text layout, Paper.js glyphs, SVG import
  js/ui.js            Shared UI: menus, draggable number fields, tips, theme, folds
  js/version.js       The version shown on hover in the top bar
  js/samples.js       Sample texts for the editor's specimen view
  js/shapeimport.js   The New font from shapes window
  style/base.css      Shared look: colour tokens (both themes), controls, menus
  style/editor.css, style/typesetter.css
  libs/               Paper.js 0.12.18 core (vendored)
  fonts/
    fonts.json        Which fonts to load, in dropdown order
    fonts.js          Generated copy of all fonts, for pages opened from disk
    <font>.json       Fonts
tools/
  server.py           Dev server (static files + saving fonts)
  build_fonts.py      Rebuilds src/fonts/fonts.js
  bump_version.py     Sets the version and stamps it on the pages' scripts (run before publishing)
  make_halsey_myrtle.py  Generates Halsey and Myrtle (Myrtle's coil size: --radius, --pitch)
  make_four_fonts.py  Generates Mercer, Delancey, Hester and Astor (--only to pick)
  make_lafayette.py   Generates Lafayette
docs/
  TODO.md             The one list of open work
  meat_notes.md       Raw notes inbox, sorted into the other docs by Claude
CLAUDE.md             Working guide for Claude
textSample*.txt       Scratch character sets for testing
```

Open work is in [docs/TODO.md](docs/TODO.md).

## Credits

- [Paper.js](http://paperjs.org/) 0.12.18 draws the glyphs (MIT licence).
- [IBM Plex Sans and Mono](https://www.ibm.com/plex/) set the interface, from Google Fonts (SIL Open Font License).
