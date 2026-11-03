/*
 * gregfont.js: the gregfont font format.
 *
 * A font is one JSON file. Glyphs are stroked (single-line) paths stored as
 * SVG path data, in a "cell" coordinate space: x grows right, y grows down,
 * the cap line is usually y=0 and the baseline usually y=cell.height.
 *
 * {
 *   "format": "gregfont", "version": 1,
 *   "name": "Sutton",
 *   "cell":    { "width": 30, "height": 60 },
 *   "guides":  { "cap": 0, "xHeight": 30, "baseline": 60, "descender": 75 },
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
 * - lsb / rsb (left/right side bearing) are gaps in font units between the
 *   glyph's ink and its neighbours, used when text is set proportionally.
 *   Monospaced setting ignores them and places the cell as drawn.
 * - a path may override strokeCap / strokeJoin / miterLimit from font.style.
 * - kerning keys are two-character pairs; values are added to the advance.
 *
 * Functions that build or read Paper.js items take a PaperScope (`ps`), so
 * this file doesn't depend on which scope is active.
 */
(function (global) {
	'use strict';

	var FORMAT = 'gregfont';
	var VERSION = 1;

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

	// Fill in defaults so the rest of the code can rely on every field.
	function normalize(font) {
		if (!font || font.format !== FORMAT) throw new Error('Not a gregfont file');
		if (font.version > VERSION) throw new Error('Font version ' + font.version + ' is newer than this app supports');
		var cell = font.cell = font.cell || { width: 60, height: 60 };
		font.guides = Object.assign({ cap: 0, xHeight: null, baseline: cell.height, descender: cell.height }, font.guides);
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
	function inkBounds(ps, font, ch) {
		var item = glyphItem(ps, font, ch);
		return item && item.children.length ? item.bounds : null;
	}

	/*
	 * Lay out text. Returns { glyphs: [{ char, x, y, word }], missing: [chars] }
	 * where (x, y) is where the glyph's cell origin goes and `word` numbers
	 * the words. `char` is the glyph actually drawn (after fallbacks).
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
		var x = margin, y = margin;
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
	 * nested groups are all flattened into path data. The cell size comes from
	 * the SVG's viewBox.
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

		var groups = root.getItems({ match: function (it) { return charFromLayerName(it.name) !== null; } });
		var allPaths = [];
		var collected = {};
		var warnings = [];

		groups.forEach(function (group) {
			var ch = charFromLayerName(group.name);
			if (collected[ch]) { warnings.push('Duplicate glyph for "' + ch + '" (' + group.name + '), keeping the first'); return; }
			var paths = group.getItems({ match: function (it) {
				return it instanceof ps.Path && !(it.parent instanceof ps.CompoundPath);
			} }).concat(group.getItems({ class: ps.CompoundPath }));
			var entries = paths.filter(function (p) { return !p.isEmpty(); }).map(function (p) {
				var entry = { d: p.getPathData(null, 3) };
				STYLE_KEYS.forEach(function (k) { entry[k] = p[k]; });
				allPaths.push(entry);
				return entry;
			});
			var ink = null;
			paths.forEach(function (p) { ink = ink ? ink.unite(p.bounds) : p.bounds.clone(); });
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

		var font = normalize({
			format: FORMAT,
			version: VERSION,
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
		stringify: stringify,
		lookup: lookup,
		glyphItem: glyphItem,
		clearCache: clearCache,
		inkBounds: inkBounds,
		layout: layout,
		fromSVG: fromSVG,
		saveToServer: saveToServer
	};
})(window);
