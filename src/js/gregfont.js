/*
 * gregfont.js: the gregfont font format.
 *
 * A font is one JSON file. Glyphs are stroked (single-line) paths stored as
 * SVG path data, in font units, like type: the origin (0,0) is on the
 * baseline at the left of the cell, x grows right and y grows UP. So the
 * cap line is a positive y and descenders go negative. (Screen drawing is
 * y-down, so glyphItem() and the editor flip it when drawing.)
 *
 * {
 *   "format": "gregfont", "version": 2,
 *   "name": "Sutton",
 *   "cell":    { "width": 30, "height": 60 },
 *   "guides":  { "cap": 60, "xHeight": 30, "descender": -15 },
 *   "style":   { "strokeCap": "round", "strokeJoin": "round", "miterLimit": 10 },
 *   "spacing": { "monospaced": true, "letterSpacing": 45, "lineHeight": 90 },
 *   "kerning": { "AV": -4 },
 *   "glyphs": {
 *     "a": { "lsb": 6, "rsb": 6, "paths": [ { "d": "M0,30L20,30" }, { "d": "...", "strokeJoin": "bevel" } ] }
 *   }
 * }
 *
 * - glyphs are keyed by the character itself. Longer keys ("ampersandalt")
 *   are named extra glyphs, e.g. alternates; text setting doesn't use them.
 * - cell is a box sitting on the baseline, from the origin to (width,
 *   height). It's a drawing guide; in text, the line's top is cell.height
 *   above the baseline.
 * - guides are heights above the baseline (the baseline itself is 0).
 * - lsb / rsb (left/right side bearing) are gaps in font units between the
 *   glyph's ink and its neighbours, used when text is set proportionally.
 *   Monospaced setting ignores them and places the origin as drawn.
 * - Version 1 files (y down, origin at the cell's top-left) are converted
 *   when they're loaded.
 * - a path may override strokeCap / strokeJoin / miterLimit from font.style.
 * - kerning keys are two-character pairs; values are added to the advance.
 * - paths with the same `group` number were grouped in the editor.
 *
 * For Illustrator, toSVG() writes the font as a grid of cells, one
 * `char-<name>` layer per glyph, and fromSVG() reads it back. The grid's
 * size is encoded in the name of the cells layer, since Illustrator keeps
 * layer names but drops custom attributes.
 *
 * Functions that build or read Paper.js items take a PaperScope (`ps`), so
 * this file doesn't depend on which scope is active.
 */
(function (global) {
	'use strict';

	var FORMAT = 'gregfont';
	var VERSION = 2;

	// Names used for SVG layer ids (`char-<name>`), for characters that can't
	// appear in an id. Letters and digits use themselves.
	var GLYPH_NAMES = {
		'-': 'dash', '_': 'underscore', '"': 'doublequote', "'": 'quote',
		',': 'comma', '~': 'tilde', ':': 'colon', ';': 'semicolon',
		'?': 'question', '.': 'period', '!': 'exclamation', '&': 'ampersand',
		'#': 'pound', '|': 'bar', '\\': 'backslash', '/': 'slash',
		')': 'parenthright', '(': 'parenthleft', '%': 'percent',
		'>': 'greaterthan', '<': 'lessthan', '}': 'curlyright', '{': 'curlyleft',
		']': 'bracketright', '[': 'bracketleft', '^': 'caret', '@': 'at',
		'$': 'dollar', '=': 'equal', '+': 'plus', '*': 'asterix'
	};
	var NAME_TO_CHAR = {};
	Object.keys(GLYPH_NAMES).forEach(function (ch) { NAME_TO_CHAR[GLYPH_NAMES[ch]] = ch; });

	// Typographic characters drawn with a plainer glyph if the font lacks them.
	var FALLBACKS = {
		'\u2014': '-', '\u2013': '-',   // em / en dash
		'\u201C': '"', '\u201D': '"',   // curly double quotes
		'\u2018': "'", '\u2019': "'"    // curly single quotes
	};

	var STYLE_KEYS = ['strokeCap', 'strokeJoin', 'miterLimit'];

	function charToName(ch) {
		return GLYPH_NAMES[ch] || ch;
	}

	// "char-a" -> "a", "char-dash" -> "-". Unknown names ("char-ampersandalt")
	// are kept as named extra glyphs. Illustrator appends "_1_" etc. to
	// duplicate ids, so that suffix is ignored.
	function charFromLayerName(name) {
		var m = /^char-(.+?)(_\d+_)?$/.exec(name || '');
		if (!m) return null;
		return NAME_TO_CHAR[m[1]] || m[1];
	}

	/*
	 * Flip SVG path data vertically: y becomes `axis` - y (relative moves just
	 * change sign). With axis 0 this converts between y-up font units and
	 * y-down screen coordinates, both ways.
	 */
	var PATH_ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
	function flipPathData(d, axis) {
		axis = axis || 0;
		var tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
		var out = [], i = 0;
		function num(n) {
			var r = Math.round(n * 1000) / 1000;
			return String(r === 0 ? 0 : r);
		}
		while (i < tokens.length) {
			var cmd = tokens[i++];
			if (!/[a-zA-Z]/.test(cmd)) throw new Error('Bad path data: ' + d);
			var lower = cmd.toLowerCase(), rel = cmd === lower, n = PATH_ARGS[lower];
			if (n === undefined) throw new Error('Unknown path command ' + cmd);
			var groups = [];
			do {
				if (n === 0) break;
				var a = tokens.slice(i, i + n).map(Number);
				i += n;
				var fy = function (y) { return rel ? -y : axis - y; };
				if (lower === 'v') a[0] = fy(a[0]);
				else if (lower === 'h') { /* x only */ }
				else if (lower === 'a') { a[2] = -a[2]; a[4] = a[4] ? 0 : 1; a[6] = fy(a[6]); }
				else for (var k = 1; k < n; k += 2) a[k] = fy(a[k]);
				var parts = [];
				for (var j = 0; j < a.length; j += (lower === 'a' ? 7 : 2)) {
					parts.push(lower === 'a' ? a.map(num).join(',') : a.slice(j, j + 2).map(num).join(','));
				}
				groups.push(parts.join(' '));
			} while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i]));
			out.push(cmd + groups.join(' '));
		}
		return out.join('');
	}

	// Version 1 fonts: y down, origin at the cell's top-left, baseline at
	// guides.baseline. Move them to baseline-origin, y-up font units.
	function migrateV1(font) {
		var cell = font.cell || { width: 60, height: 60 };
		var g = font.guides || {};
		var base = g.baseline !== undefined && g.baseline !== null ? g.baseline : cell.height;
		function up(y) { return y === null || y === undefined ? null : Math.round((base - y) * 1000) / 1000; }
		font.guides = {
			cap: up(g.cap !== undefined ? g.cap : 0),
			xHeight: up(g.xHeight),
			descender: up(g.descender !== undefined ? g.descender : base)
		};
		Object.keys(font.glyphs || {}).forEach(function (ch) {
			(font.glyphs[ch].paths || []).forEach(function (p) { p.d = flipPathData(p.d, base); });
		});
		font.version = VERSION;
	}

	// Fill in defaults so the rest of the code can rely on every field.
	function normalize(font) {
		if (!font || font.format !== FORMAT) throw new Error('Not a gregfont file');
		if (font.version > VERSION) throw new Error('Font version ' + font.version + ' is newer than this app supports');
		if (!font.version || font.version < 2) migrateV1(font);
		var cell = font.cell = font.cell || { width: 60, height: 60 };
		font.guides = Object.assign({ cap: cell.height, xHeight: null, descender: 0 }, font.guides);
		delete font.guides.baseline;   // always 0 now
		font.style = Object.assign({ strokeCap: 'butt', strokeJoin: 'miter', miterLimit: 10 }, font.style);
		font.spacing = Object.assign({ monospaced: false, letterSpacing: cell.width, lineHeight: cell.height * 1.5 }, font.spacing);
		font.kerning = font.kerning || {};
		font.glyphs = font.glyphs || {};
		Object.keys(font.glyphs).forEach(function (ch) {
			var g = font.glyphs[ch];
			g.lsb = g.lsb || 0;
			g.rsb = g.rsb || 0;
			g.paths = g.paths || [];
		});
		return font;
	}

	function load(url) {
		return fetch(url, { cache: 'no-store' }).then(function (res) {
			if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
			return res.json();
		}).then(normalize);
	}

	/*
	 * Load every font listed in <base>fonts.json. Resolves to [{ file, font }]
	 * in list order. If fetching fails (as it does when a page is opened
	 * straight from disk), falls back to fonts/fonts.js, a copy of the fonts
	 * as a script that the page loads with a <script> tag.
	 */
	function loadAll(base) {
		base = base || 'fonts/';
		return fetch(base + 'fonts.json', { cache: 'no-store' })
			.then(function (res) {
				if (!res.ok) throw new Error('Could not load ' + base + 'fonts.json (' + res.status + ')');
				return res.json();
			})
			.then(function (manifest) {
				return Promise.all(manifest.fonts.map(function (file) {
					return load(base + file).then(function (font) { return { file: file, font: font }; });
				}));
			})
			.catch(function (err) {
				var bundle = global.GREGFONT_BUNDLE;
				if (!bundle) throw err;
				return bundle.fonts.filter(function (file) { return bundle.data[file]; }).map(function (file) {
					// copy, so edits never touch the bundle itself
					return { file: file, font: normalize(JSON.parse(JSON.stringify(bundle.data[file]))) };
				});
			});
	}

	var BUNDLE_HEADER = '// Generated from fonts.json and the font files so the pages work when opened\n' +
		'// straight from disk. Don\'t edit: the JSON files are the fonts. Rebuild with\n' +
		'// python tools/build_fonts.py (saving from the editor also rebuilds it).\n';

	// fonts/fonts.js from [[file name, file text]], in list order.
	// Same output as bundle_script() in tools/build_fonts.py.
	function bundleScript(pairs) {
		return BUNDLE_HEADER + 'window.GREGFONT_BUNDLE = {\n"fonts": ' +
			JSON.stringify(pairs.map(function (p) { return p[0]; })).replace(/","/g, '", "') + ',\n"data": {\n' +
			pairs.map(function (p) { return JSON.stringify(p[0]) + ': ' + p[1].trim(); }).join(',\n') +
			'\n}\n};\n';
	}

	function round(n) {
		return Math.round(n * 1000) / 1000;
	}

	// JSON with one glyph per line, so diffs show which glyphs changed.
	function stringify(font) {
		var top = {};
		Object.keys(font).forEach(function (k) {
			if (k !== 'glyphs' && k.charAt(0) !== '_') top[k] = font[k];
		});
		var head = JSON.stringify(top, null, '\t');
		var glyphLines = Object.keys(font.glyphs).map(function (ch) {
			var g = font.glyphs[ch];
			var out = { lsb: round(g.lsb), rsb: round(g.rsb), paths: g.paths };
			return '\t\t' + JSON.stringify(ch) + ': ' + JSON.stringify(out);
		});
		return head.replace(/\n}$/, ',\n\t"glyphs": {\n' + glyphLines.join(',\n') + '\n\t}\n}\n');
	}

	// The glyph to draw for `ch`, following fallbacks. Returns { char, glyph } or null.
	function lookup(font, ch) {
		if (font.glyphs[ch]) return { char: ch, glyph: font.glyphs[ch] };
		var fb = FALLBACKS[ch];
		if (fb && font.glyphs[fb]) return { char: fb, glyph: font.glyphs[fb] };
		return null;
	}

	// A Paper.js Group for a glyph (not inserted into the project). Templates
	// are cached on the font, so clone them before placing.
	function glyphItem(ps, font, ch) {
		var cache = font._items || (Object.defineProperty(font, '_items', { value: {}, writable: true }), font._items);
		if (cache[ch]) return cache[ch];
		var glyph = font.glyphs[ch];
		if (!glyph) return null;
		var group = new ps.Group({ insert: false, name: 'char-' + charToName(ch) });
		glyph.paths.forEach(function (p) {
			var path = new ps.CompoundPath({ pathData: p.d, insert: false });
			path.strokeColor = 'black';
			path.fillColor = null;
			STYLE_KEYS.forEach(function (k) {
				path[k] = p[k] !== undefined ? p[k] : font.style[k];
			});
			group.addChild(path);
		});
		// font units are y-up; Paper draws y-down. The origin stays on the baseline.
		group.scale(1, -1, new ps.Point(0, 0));
		cache[ch] = group;
		return group;
	}

	// Forget cached items, e.g. after a glyph is edited. Pass `ch` to forget
	// just that glyph.
	function clearCache(font, ch) {
		if (ch !== undefined && font._items) delete font._items[ch];
		else font._items = {};
	}

	// Bounds of a glyph's ink (ignoring stroke width), or null if it's empty.
	// In screen orientation: origin on the baseline, y down (so ink above the
	// baseline has a negative top).
	function inkBounds(ps, font, ch) {
		var item = glyphItem(ps, font, ch);
		return item && item.children.length ? item.bounds : null;
	}

	/*
	 * "Extend ends to guides": a drawing option for heavy strokes. Closed
	 * shapes and corners grow outward by half the stroke, but a flat stroke
	 * end stops where it was drawn, so stems look short next to round
	 * letters. This lengthens each open end that finishes on (or within a
	 * hair of) a guide line, running roughly up or down, so its edge lands
	 * half a stroke past the guide, the same as the rest of the ink.
	 * Round and square ends already reach that far, so those just snap onto
	 * the guide. Ends away from the guides (tails, diagonals) are left alone.
	 *
	 * d is one path's data in font units (y up); width is the stroke width
	 * in font units; cap is the end style used to draw it. Returns new path
	 * data; the glyph itself never changes.
	 */
	function extendEnds(ps, font, d, width, cap) {
		var g = font.guides || {};
		var guides = [0, g.xHeight, g.cap, g.descender].filter(function (v) { return typeof v === 'number' && isFinite(v); });
		var tol = Math.max(font.cell.height * 0.03, 1);
		var reach = cap === 'butt' ? width / 2 : 0;   // how far past the guide the end point goes
		var item = ps.PathItem.create(d);
		item.remove();
		var parts = item instanceof ps.CompoundPath ? item.children.slice() : [item];
		var changed = false;
		parts.forEach(function (path) {
			if (path.closed || path.segments.length < 2 || !path.length) return;
			[0, 1].forEach(function (atEnd) {
				var pt = atEnd ? path.lastSegment.point : path.firstSegment.point;
				// the direction the stroke leaves in, at this end
				var t = atEnd ? path.getTangentAt(path.length) : path.getTangentAt(0).negate();
				if (!t || Math.abs(t.y) < 0.85) return;       // only ends running up or down
				var near = null;
				guides.forEach(function (y) {
					if (Math.abs(pt.y - y) <= tol && (near === null || Math.abs(pt.y - y) < Math.abs(pt.y - near))) near = y;
				});
				if (near === null) return;
				var target = near + (t.y > 0 ? reach : -reach);
				var len = (target - pt.y) / t.y;
				if (Math.abs(len) < 1e-3 || len < -tol) return;
				var to = pt.add(t.multiply(len));
				if (len < 0) {
					// a hair past the guide: move the end back onto it
					(atEnd ? path.lastSegment : path.firstSegment).point = to;
				} else if (atEnd) {
					path.add(to);
				} else {
					path.insert(0, to);
				}
				changed = true;
			});
		});
		return changed ? item.getPathData(null, 3) : d;
	}

	/*
	 * Lay out text. Returns { glyphs: [{ char, x, y, word }], missing: [chars] }
	 * where (x, y) is where the glyph's origin goes (y is the line's
	 * baseline, in screen orientation: lines go down) and `word` numbers the
	 * words. `char` is the glyph actually drawn (after fallbacks). The first
	 * baseline is cell.height below the top margin.
	 *
	 * opts: { monospace, letterSpacing, lineHeight, tracking, wordWrap,
	 *         wrapWidth, margin }
	 * Monospace places each cell as drawn, `letterSpacing` apart. Otherwise
	 * each glyph's ink goes after its lsb (plus kerning with the previous
	 * glyph), and the next starts after the ink, rsb and tracking.
	 * Spaces are `letterSpacing` wide, tabs four spaces.
	 */
	function layout(ps, font, text, opts) {
		var margin = opts.margin || 0;
		var x = margin, y = margin + font.cell.height;
		var word = 0, inWord = false, prev = null;
		var out = [], missing = [];

		function breakWord() {
			if (inWord) word++;
			inWord = false;
			prev = null;
		}

		for (var i = 0; i < text.length; i++) {
			var ch = text[i];
			if (ch === ' ') {
				x += opts.letterSpacing;
				breakWord();
				if (opts.wordWrap && x > opts.wrapWidth) {
					x = margin;
					y += opts.lineHeight;
				}
			} else if (ch === '\n') {
				x = margin;
				y += opts.lineHeight;
				breakWord();
			} else if (ch === '\t') {
				x += opts.letterSpacing * 4;
				breakWord();
			} else if (ch !== '\r') {
				var found = lookup(font, ch);
				if (!found) {
					if (missing.indexOf(ch) < 0) missing.push(ch);
					continue;
				}
				if (opts.monospace) {
					out.push({ char: found.char, x: x, y: y, word: word });
					x += opts.letterSpacing;
				} else {
					var ink = inkBounds(ps, font, found.char);
					var inkLeft = ink ? ink.left : 0, inkWidth = ink ? ink.width : 0;
					if (prev !== null) x += font.kerning[prev + found.char] || 0;
					x += found.glyph.lsb;
					out.push({ char: found.char, x: x - inkLeft, y: y, word: word });
					x += inkWidth + found.glyph.rsb + (opts.tracking || 0);
				}
				inWord = true;
				prev = found.char;
			}
		}
		return { glyphs: out, missing: missing };
	}

	/*
	 * Lay out a block of text the way a text box does: wrap at spaces to fit
	 * `width` (font units; omit for no wrapping), align each line, and report
	 * where every character sits so an editor can draw a caret.
	 *
	 * opts: { monospace, letterSpacing, lineHeight, tracking, width, align }
	 *       align is 'left' (default), 'center' or 'right'.
	 * Returns {
	 *   glyphs: [{ char, x, y, i }]   where to put each glyph's origin (y is
	 *                                 the line's baseline, screen orientation),
	 *                                 i = its index in `text`
	 *   carets: [{ x, y, line }]      one per index 0..text.length: the pen
	 *                                 position before that character
	 *   lines, width, height, missing
	 * }
	 * Line n's baseline is cell.height + n * lineHeight. `height` runs from
	 * the top of the first line to the descender of the last.
	 */
	function layoutBlock(ps, font, text, opts) {
		opts = opts || {};
		var ls = opts.letterSpacing !== undefined ? opts.letterSpacing : font.spacing.letterSpacing;
		var lh = opts.lineHeight !== undefined ? opts.lineHeight : font.spacing.lineHeight;
		var tracking = opts.tracking || 0;
		var wrapAt = opts.width > 0 ? opts.width : Infinity;
		var missing = [];

		// One character's placement relative to the pen, and how far the pen moves.
		function measure(ch, prev) {
			var found = lookup(font, ch);
			if (!found) {
				if (missing.indexOf(ch) < 0) missing.push(ch);
				return null;
			}
			if (opts.monospace) {
				var mInk = inkBounds(ps, font, found.char);
				return { char: found.char, place: 0, advance: ls, right: mInk ? mInk.right : 0 };
			}
			var ink = inkBounds(ps, font, found.char);
			var inkLeft = ink ? ink.left : 0, inkWidth = ink ? ink.width : 0;
			var kern = prev ? font.kerning[prev + found.char] || 0 : 0;
			var place = kern + found.glyph.lsb - inkLeft;
			return {
				char: found.char, place: place,
				advance: kern + found.glyph.lsb + inkWidth + found.glyph.rsb + tracking,
				right: place + inkLeft + inkWidth
			};
		}

		// Split into lines of tokens: words (runs of non-spaces) and single spaces.
		var lines = [];   // [{ items: [{ i, x, m }], end }] where m is a measure or null
		var paragraphs = text.split('\n');
		var index = 0;
		paragraphs.forEach(function (para, pi) {
			var line = { items: [], start: index };
			var x = 0;
			var tokens = para.match(/ |[^ ]+/g) || [];
			tokens.forEach(function (tok) {
				if (tok === ' ') {
					line.items.push({ i: index, x: x, m: null, space: true });
					x += ls;
					index += 1;
					return;
				}
				// lay the word out from 0, then see whether it fits
				var chars = Array.from(tok), wx = 0, prev = null, placed = [], wordRight = 0;
				chars.forEach(function (ch) {
					var m = measure(ch, prev);
					placed.push({ i: index, x: wx, m: m });
					if (m) {
						wordRight = Math.max(wordRight, wx + m.right);
						wx += m.advance;
						prev = m.char;
					}
					index += ch.length;
				});
				if (x > 0 && x + wordRight > wrapAt && line.items.some(function (it) { return !it.space; })) {
					line.end = placed[0].i;
					lines.push(line);
					line = { items: [], start: placed[0].i };
					x = 0;
				}
				placed.forEach(function (p) { p.x += x; line.items.push(p); });
				x += wx;
			});
			line.end = index;
			line.penEnd = x;
			lines.push(line);
			if (pi < paragraphs.length - 1) index += 1;   // the '\n'
		});

		// Measure, align, and build glyphs + carets.
		var cellH = font.cell.height;
		var glyphs = [], carets = new Array(text.length + 1), widest = 0;
		var lineInfo = lines.map(function (line) {
			var right = 0;
			line.items.forEach(function (it) { if (it.m) right = Math.max(right, it.x + it.m.right); });
			widest = Math.max(widest, right);
			return right;
		});
		var boxWidth = isFinite(wrapAt) ? wrapAt : widest;
		lines.forEach(function (line, n) {
			var y = cellH + n * lh;
			var shift = 0;
			if (opts.align === 'center') shift = (boxWidth - lineInfo[n]) / 2;
			else if (opts.align === 'right') shift = boxWidth - lineInfo[n];
			line.items.forEach(function (it) {
				carets[it.i] = { x: it.x + shift, y: y, line: n };
				if (it.m) glyphs.push({ char: it.m.char, x: it.x + it.m.place + shift, y: y, i: it.i });
			});
			// The end of a paragraph (its '\n', or the end of the text) gets a
			// caret after the line. A wrapped line's end is the next line's start.
			if (line.penEnd !== undefined) carets[line.end] = { x: line.penEnd + shift, y: y, line: n };
		});
		// anything left unset (e.g. characters with no glyph) takes the next known spot
		for (var k = carets.length - 1, next = carets[carets.length - 1]; k >= 0; k--) {
			if (!carets[k]) carets[k] = next; else next = carets[k];
		}
		var depth = Math.max(0, -(font.guides.descender || 0));
		return {
			glyphs: glyphs, carets: carets, lines: lines.length,
			width: boxWidth, inkWidth: widest, height: cellH + (lines.length - 1) * lh + depth,
			missing: missing
		};
	}

	// --- Illustrator grid

	var GRID_COLUMNS = 10;
	var STANDARD_ORDER = [].concat(
		'abcdefghijklmnopqrstuvwxyz'.split(''),
		'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
		'0123456789'.split(''),
		Object.keys(GLYPH_NAMES));

	// Numbers in layer names: "." becomes "p" and "-" becomes "m", so
	// Illustrator doesn't escape them.
	function encodeNum(n) { return String(round(n)).replace('.', 'p').replace('-', 'm'); }
	function decodeNum(s) { return parseFloat(s.replace('p', '.').replace('m', '-')); }

	// "grid2": ox / oy point at each cell's baseline origin. The older
	// "grid" names pointed at the cell's top-left corner.
	function gridLayerName(g) {
		return 'gregfont-grid2-c' + g.cols + '-w' + encodeNum(g.w) + '-h' + encodeNum(g.h) +
			'-px' + encodeNum(g.px) + '-py' + encodeNum(g.py) + '-ox' + encodeNum(g.ox) + '-oy' + encodeNum(g.oy);
	}

	function parseGridLayerName(name) {
		var n = '([0-9pm]+)';
		var m = new RegExp('^gregfont-grid(2?)-c(\\d+)-w' + n + '-h' + n + '-px' + n + '-py' + n + '-ox' + n + '-oy' + n).exec(name || '');
		if (!m) return null;
		return {
			version: m[1] ? 2 : 1,
			cols: parseInt(m[2], 10), w: decodeNum(m[3]), h: decodeNum(m[4]),
			px: decodeNum(m[5]), py: decodeNum(m[6]), ox: decodeNum(m[7]), oy: decodeNum(m[8])
		};
	}

	function xmlEscape(str) {
		return String(str).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
		});
	}

	/*
	 * The font as an SVG for Illustrator: glyphs laid out in a grid, each on
	 * its own `char-<name>` layer (grouped paths as nested groups), plus
	 * reference layers with the cell boxes, guides and side-bearing marks.
	 * Standard characters the font lacks get an empty labelled cell.
	 *
	 * options: { strokeWidth }
	 */
	function toSVG(ps, font, options) {
		options = options || {};
		var sw = options.strokeWidth || 2;
		var cell = font.cell, guides = font.guides;
		var order = STANDARD_ORDER.concat(Object.keys(font.glyphs).filter(function (ch) {
			return STANDARD_ORDER.indexOf(ch) < 0;
		}));

		// one slot size that fits every glyph, its bearings and the guides.
		// Worked out in screen orientation around the baseline (y down).
		var left = 0, right = cell.width;
		var top = Math.min(-cell.height, -(guides.cap || 0)), bottom = Math.max(0, -(guides.descender || 0));
		var inks = {};
		order.forEach(function (ch) {
			var ink = font.glyphs[ch] ? inkBounds(ps, font, ch) : null;
			inks[ch] = ink;
			if (!ink) return;
			var g = font.glyphs[ch];
			left = Math.min(left, ink.left - g.lsb);
			right = Math.max(right, ink.right + g.rsb);
			top = Math.min(top, ink.top);
			bottom = Math.max(bottom, ink.bottom);
		});
		var margin = Math.max(cell.width, cell.height) * 0.15;
		var labelRoom = Math.max(cell.height * 0.2, 8);
		var grid = { cols: GRID_COLUMNS, w: cell.width, h: cell.height };
		grid.ox = Math.ceil(margin - left);
		grid.oy = Math.ceil(margin - top);
		grid.px = Math.ceil(grid.ox + right + margin);
		grid.py = Math.ceil(grid.oy + bottom + margin + labelRoom);
		var rows = Math.ceil(order.length / grid.cols);
		var width = grid.px * grid.cols, height = grid.py * rows;

		var cells = [], guideLines = [], layers = [];
		var fontSize = round(labelRoom * 0.6);
		var guideColors = { cap: '#2f8cff', xHeight: '#20a37a', baseline: '#e07b00', descender: '#9b59b6' };
		var guideY = { cap: guides.cap, xHeight: guides.xHeight, baseline: 0, descender: guides.descender };

		order.forEach(function (ch, i) {
			var col = i % grid.cols, row = Math.floor(i / grid.cols);
			var sx = col * grid.px, sy = row * grid.py;          // slot corner
			var cx = sx + grid.ox, cy = sy + grid.oy;           // origin, on the baseline
			cells.push('<rect x="' + round(cx) + '" y="' + round(cy - cell.height) + '" width="' + cell.width + '" height="' + cell.height +
				'" fill="none" stroke="#bbbbbb" stroke-width="0.5"/>');
			cells.push('<text x="' + round(sx + grid.px / 2) + '" y="' + round(sy + grid.py - labelRoom * 0.35) +
				'" font-family="sans-serif" font-size="' + fontSize + '" fill="#999999" text-anchor="middle">' +
				xmlEscape(GLYPH_NAMES[ch] ? ch + '  ' + GLYPH_NAMES[ch] : ch) + '</text>');
			cells.push('<circle cx="' + round(cx) + '" cy="' + round(cy) + '" r="' + round(Math.max(cell.width, cell.height) * 0.015) + '" fill="#e07b00"/>');
			Object.keys(guideColors).forEach(function (k) {
				if (guideY[k] === null || guideY[k] === undefined) return;
				var y = round(cy - guideY[k]);
				guideLines.push('<line x1="' + round(sx) + '" y1="' + y + '" x2="' + round(sx + grid.px) + '" y2="' + y +
					'" stroke="' + guideColors[k] + '" stroke-width="0.3"/>');
			});
			var glyph = font.glyphs[ch], ink = inks[ch];
			if (!glyph) return;
			if (ink) {
				[ink.left - glyph.lsb, ink.right + glyph.rsb].forEach(function (x) {
					x = round(cx + x);
					guideLines.push('<line x1="' + x + '" y1="' + round(sy) + '" x2="' + x + '" y2="' + round(sy + grid.py - labelRoom) +
						'" stroke="#d6337a" stroke-width="0.3" stroke-dasharray="1.5 1.5"/>');
				});
			}

			// paths, moved into the cell; grouped paths go in a nested group
			var loose = [], groups = {}, groupOrder = [];
			glyph.paths.forEach(function (entry) {
				var item = ps.PathItem.create(flipPathData(entry.d, 0));   // to y-down
				item.remove();
				item.translate(new ps.Point(cx, cy));
				var el = '<path d="' + item.getPathData(null, 3) + '" fill="none" stroke="#000000" stroke-width="' + sw + '"' +
					' stroke-linecap="' + (entry.strokeCap || font.style.strokeCap) + '"' +
					' stroke-linejoin="' + (entry.strokeJoin || font.style.strokeJoin) + '"' +
					' stroke-miterlimit="' + (entry.miterLimit || font.style.miterLimit) + '"/>';
				if (entry.group) {
					if (!groups[entry.group]) { groups[entry.group] = []; groupOrder.push(entry.group); }
					groups[entry.group].push(el);
				} else {
					loose.push(el);
				}
			});
			var inner = loose.concat(groupOrder.map(function (gid) { return '<g>' + groups[gid].join('') + '</g>'; }));
			layers.push('<g id="char-' + xmlEscape(charToName(ch)) + '">' + inner.join('') + '</g>');
		});

		return '<?xml version="1.0" encoding="UTF-8"?>\n' +
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">\n' +
			'<title>' + xmlEscape(font.name) + '</title>\n' +
			'<g id="' + gridLayerName(grid) + '">' + cells.join('') + '</g>\n' +
			'<g id="gregfont-guides">' + guideLines.join('') + '</g>\n' +
			layers.join('\n') + '\n</svg>\n';
	}

	// Most common value of `key` across items.
	function mostCommon(items, key) {
		var counts = {}, best = null;
		items.forEach(function (it) {
			var v = it[key];
			counts[v] = (counts[v] || 0) + 1;
			if (best === null || counts[v] > counts[best]) best = v;
		});
		return best;
	}

	/*
	 * Build a font from an SVG where each glyph is a group/layer with the id
	 * `char-<name>` (the Illustrator workflow). Shapes, lines, polylines and
	 * nested groups are all flattened into path data; nested groups inside a
	 * glyph's layer come back as path groups.
	 *
	 * Two layouts are understood: a grid written by toSVG() (glyph positions
	 * are taken relative to whichever cell they sit in), or every glyph drawn
	 * at the same spot, with the artboard as the cell (the original files).
	 *
	 * options: { name, monospaced, letterSpacing, lineHeight, sidebearing }
	 * Returns { font, ink } where ink[ch] is the glyph's ink bounds.
	 */
	function fromSVG(ps, svgText, options) {
		options = options || {};
		var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
		var svg = doc.documentElement;
		var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
		var cell = vb.length === 4 && vb[2] > 0
			? { width: vb[2], height: vb[3] }
			: { width: parseFloat(svg.getAttribute('width')) || 60, height: parseFloat(svg.getAttribute('height')) || 60 };

		// Paper only picks up class-based CSS if the SVG is in the document.
		var holder = document.createElement('div');
		holder.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
		holder.appendChild(document.importNode(svg, true));
		document.body.appendChild(holder);
		var root;
		try {
			root = ps.project.importSVG(holder.firstChild, { insert: false, expandShapes: true });
		} finally {
			document.body.removeChild(holder);
		}

		var gridItem = root.getItems({ match: function (it) { return parseGridLayerName(it.name) !== null; } })[0];
		var grid = gridItem ? parseGridLayerName(gridItem.name) : null;
		if (grid) cell = { width: grid.w, height: grid.h };

		var groups = root.getItems({ match: function (it) { return charFromLayerName(it.name) !== null; } });
		var allPaths = [];
		var collected = {};
		var warnings = [];

		groups.forEach(function (group) {
			var ch = charFromLayerName(group.name);
			if (collected[ch]) { warnings.push('Duplicate glyph for "' + ch + '" (' + group.name + '), keeping the first'); return; }
			var paths = group.getItems({ match: function (it) {
				return it instanceof ps.Path && !(it.parent instanceof ps.CompoundPath);
			} }).concat(group.getItems({ class: ps.CompoundPath })).filter(function (p) { return !p.isEmpty(); });
			var ink = null;
			paths.forEach(function (p) { ink = ink ? ink.unite(p.bounds) : p.bounds.clone(); });

			// in a grid, move the glyph out of whichever cell it sits in, to
			// cell-top-left coordinates (version 1 of the format; normalize()
			// then moves it onto the baseline)
			if (grid && ink) {
				var col = Math.floor(ink.center.x / grid.px), row = Math.floor(ink.center.y / grid.py);
				var offset = new ps.Point(col * grid.px + grid.ox, row * grid.py + grid.oy - (grid.version === 2 ? cell.height : 0));
				paths.forEach(function (p) { p.translate(offset.negate()); });
				ink = ink.clone();
				ink.x -= offset.x;
				ink.y -= offset.y;
			}

			// a group nested in the glyph's layer (but not holding all of it) is a path group
			var groupIds = new Map();
			function groupOf(p) {
				var top = p;
				while (top.parent && top.parent !== group) top = top.parent;
				if (top === p || !(top instanceof ps.Group)) return 0;
				var count = paths.filter(function (q) { return q.isDescendant(top); }).length;
				if (count < 2 || count === paths.length) return 0;
				if (!groupIds.has(top)) groupIds.set(top, groupIds.size + 1);
				return groupIds.get(top);
			}

			var entries = paths.map(function (p) {
				var entry = { d: p.getPathData(null, 3) };
				STYLE_KEYS.forEach(function (k) { entry[k] = p[k]; });
				var gid = groupOf(p);
				if (gid) entry.group = gid;
				allPaths.push(entry);
				return entry;
			});
			collected[ch] = { entries: entries, ink: ink };
		});

		// Font-wide style is whatever most paths use; paths that differ keep an override.
		var style = {};
		STYLE_KEYS.forEach(function (k) { style[k] = mostCommon(allPaths, k); });
		allPaths.forEach(function (entry) {
			STYLE_KEYS.forEach(function (k) { if (entry[k] === style[k] || entry[k] == null) delete entry[k]; });
		});

		var sb = options.sidebearing !== undefined ? options.sidebearing : round(cell.width * 0.1);
		var glyphs = {}, ink = {};
		Object.keys(collected).forEach(function (ch) {
			glyphs[ch] = { lsb: sb, rsb: sb, paths: collected[ch].entries };
			ink[ch] = collected[ch].ink;
		});

		var xTop = ink.x ? round(ink.x.top) : null;
		var descender = cell.height;
		['g', 'j', 'p', 'q', 'y'].forEach(function (ch) {
			if (ink[ch]) descender = Math.max(descender, round(ink[ch].bottom));
		});

		// built in version 1 coordinates (y down from the cell's top-left), which
		// normalize() converts
		var font = normalize({
			format: FORMAT,
			version: 1,
			name: options.name || 'Untitled',
			cell: cell,
			guides: { cap: 0, xHeight: xTop, baseline: cell.height, descender: descender },
			style: style,
			spacing: {
				monospaced: !!options.monospaced,
				letterSpacing: options.letterSpacing || cell.width,
				lineHeight: options.lineHeight || round(cell.height * 1.5)
			},
			kerning: {},
			glyphs: glyphs
		});
		warnings.forEach(function (w) { console.warn('[gregfont] ' + w); });
		return { font: font, ink: ink, warnings: warnings };
	}

	// Save through the dev server (tools/server.py). Resolves false if the
	// page isn't being served by it.
	function saveToServer(fileName, font) {
		return fetch('fonts/' + fileName, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: stringify(font)
		}).then(function (res) { return res.ok; }, function () { return false; });
	}

	global.GregFont = {
		FORMAT: FORMAT,
		VERSION: VERSION,
		GLYPH_NAMES: GLYPH_NAMES,
		FALLBACKS: FALLBACKS,
		charToName: charToName,
		charFromLayerName: charFromLayerName,
		normalize: normalize,
		load: load,
		loadAll: loadAll,
		bundleScript: bundleScript,
		stringify: stringify,
		lookup: lookup,
		glyphItem: glyphItem,
		clearCache: clearCache,
		inkBounds: inkBounds,
		extendEnds: extendEnds,
		layout: layout,
		layoutBlock: layoutBlock,
		fromSVG: fromSVG,
		toSVG: toSVG,
		flipPathData: flipPathData,
		saveToServer: saveToServer
	};
})(window);
