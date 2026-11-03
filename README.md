# gregfont

A small browser tool for setting text in a handful of custom single-line (stroke-based) fonts and exporting the result as SVG.

Each glyph is drawn as a stroked path in Illustrator, exported to SVG, and rendered on a canvas with [Paper.js](http://paperjs.org/). Because the letters are strokes rather than filled outlines, you can change stroke weight and end-cap style on the fly, which makes the output useful for plotters, laser/CNC engraving and other line-based work.

## Running it

There is no build step. Serve the `src/` folder with any static web server and open `index.html`:

```sh
cd src
python -m http.server 8000
# then open http://localhost:8000
```

A server is required (opening the file directly won't work) because the font data and SVGs are loaded with AJAX.

## Using it

Type into the text box at the bottom-left; the canvas re-renders as you type. For text over 600 characters, live updates stop and a ↻ button appears to rebuild manually.

| Control | What it does |
| --- | --- |
| **Font** | Sutton, Nassau, Kosciuszko or Troutman. Switching font resets spacing to that font's defaults. |
| **Letter Spacing** | Advance per character (monospace) and width of a space. |
| **Line Height** | Distance between lines. |
| **Monospace** | Fixed-width advance vs. proportional spacing using per-glyph side bearings. |
| **Spacing Base** | Multiplier on the side-bearing values when *not* monospaced. |
| **End Caps** | Keep the source caps, or force butt / round / square. |
| **Stroke Weight** | Stroke width of every glyph. |
| **Font Scale** | Overall scale, clamped to 0.333–2. |
| **Word Wrap / Wrap Width** | Wrap at spaces once a line passes the given width. |
| **EXPORT SVG** | Downloads the canvas as an SVG, named from the first 12 characters of the text. |

**Ctrl+D** shows a hidden *Samples* menu with test texts (initial caps, lowercase, kerning pairs, readability paragraphs) for checking spacing.

## Fonts

| Font | Glyph box | Spacing | Glyphs |
| --- | --- | --- | --- |
| Sutton | 30×60 | Monospaced | Letters, digits, punctuation |
| Nassau | 60×60 | Proportional | Letters, digits, punctuation |
| Kosciuszko | 20×60 | Monospaced | Letters only |
| Troutman | 40×60 | Proportional | Letters, digits, punctuation |

## Project layout

```
src/
  index.html          UI: canvas + settings panel
  js/main.js          PaperScript app: rendering, layout, export, sample texts
  style/main.css
  libs/               jQuery 3.1.1, Paper.js (vendored)
  fonts/
    <font>.js         Font metadata (sets a global `data` object)
    <font>_all_WxH.svg  Glyphs exported from Illustrator
    <font>_all_WxH.ai   Illustrator source
textSample*.txt       Scratch character sets for testing
```

## Adding a font

1. Draw each glyph in Illustrator on a `W×H` artboard, one group/layer per glyph, named `char-<name>`. Names come from `characterMap` at the bottom of `main.js`: letters and digits use themselves (`char-a`, `char-A`, `char-7`); symbols use words (`char-dash`, `char-question`, `char-parenthleft`, …).
2. Export to SVG as `src/fonts/<font>_all_WxH.svg` and keep the `.ai` next to it.
3. Create `src/fonts/<font>.js` modelled on an existing one:

   ```js
   var data = {
       "name": "Troutman",
       "file": "troutman_all_40x60.svg",
       "baseWidth": 40,
       "baseHeight": 60,
       "monospaced": false,       // default for the Monospace checkbox
       "baseLetterSpacing": 45,   // default Letter Spacing
       "baseLineHeight": 115,     // default Line Height
       "baseLetterSpaceUnit": 12, // default Spacing Base
       "charLetterSpacing": {
           "a": {"sidebearing": [0.5, 0.5], "kerningpairs": {}},
           ...
       }
   };
   ```

   `sidebearing` is `[left, right]`, multiplied by Spacing Base in proportional mode. `kerningpairs` exists in the data but isn't used yet.
4. Add the file to `FONT_PATHS` in `main.js` and add an `<option>` to `#font-select` in `index.html`, keeping the order the same in both.

## Known issues

- Kosciuszko's lowercase `c` is named `c_1_` in the Illustrator source (`.ai`). The exported SVG has been fixed by hand, so re-exporting from the `.ai` will bring the bug back unless the layer is renamed there too.

## Ideas / TODO

From the notes in `main.js`:

- Copy SVG to clipboard
- Text alignment (left / right / center)
- Force upper or lower case
- Color
- Effects. There's a stub `effects()` hook with experiments that draw segment points and curve normals.
- Move effects and sample texts into a separate dev panel
