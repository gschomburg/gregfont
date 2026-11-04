/*
 * gregfont editor: draw and space glyphs for single-line fonts.
 *
 * The canvas works in font units (the same coordinates as the glyph path
 * data). Zoom and pan only change the Paper.js view. Each finished edit is
 * written back to the font object right away (commit), so the glyph grid,
 * preview and saving always see the current drawing.
 */
(function () {
	'use strict';

	var P = paper;
	var $ = function (id) { return document.getElementById(id); };

	// Characters shown in the glyph grid, in order. Any other glyphs in the
	// font are listed after these.
	var STANDARD = []
		.concat('abcdefghijklmnopqrstuvwxyz'.split(''))
		.concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
		.concat('0123456789'.split(''))
		.concat(Object.keys(GregFont.GLYPH_NAMES));

	var COLORS = {
		ink: '#111111',
		grid: '#e4e4e4',
		gridMajor: '#d2d2d2',
		cell: 'rgba(0, 0, 0, 0.1)',
		guide: { cap: '#2f8cff', xHeight: '#20a37a', baseline: '#e07b00', descender: '#9b59b6' },
		bearing: '#d6337a',
		select: '#2f8cff',
		overlay: '#2f8cff'
	};

	// Canvas colours come from the theme's tokens in editor.css, so the
	// canvas follows the light / dark switch.
	function readColors() {
		var cs = getComputedStyle(document.documentElement);
		function v(name, fallback) { return cs.getPropertyValue(name).trim() || fallback; }
		COLORS.ink = v('--ink', COLORS.ink);
		COLORS.grid = v('--canvas-grid', COLORS.grid);
		COLORS.gridMajor = v('--canvas-grid-major', COLORS.gridMajor);
		COLORS.cell = v('--canvas-cell', COLORS.cell);
		COLORS.guide = {
			cap: v('--guide-cap', COLORS.guide.cap),
			xHeight: v('--guide-xh', COLORS.guide.xHeight),
			baseline: v('--guide-base', COLORS.guide.baseline),
			descender: v('--guide-desc', COLORS.guide.descender)
		};
		COLORS.bearing = v('--bearing', COLORS.bearing);
		COLORS.select = COLORS.overlay = v('--select', COLORS.select);
		COLORS.orderStart = v('--order-start', '#15803d');
		COLORS.orderEnd = v('--order-end', '#be123c');
		COLORS.travel = v('--order-travel', '#8a8c93');
	}
	readColors();

	var state = {
		entries: [],      // [{ file, font, dirty }] in dropdown order; file is null until first save
		entry: null,
		ch: 'a',
		tool: 'select',
		snap: true,       // snap to the grid
		snapPath: true,   // snap onto other paths' points and lines
		grid: 5,
		strokeWidth: 2,
		undo: [],
		redo: [],
		clipboard: null,
		kernPick: null,
		autoSlice: false,  // new strokes cut what they cross
		added: [],         // glyphs added from the sidebar but not drawn yet
		shapeKind: 'ellipse', // what the shape tool draws: ellipse, rect or line
		show: { grid: true, guides: true, cell: true, order: false }   // View menu toggles
	};

	// ---------------------------------------------------------------- setup

	var canvas = $('editor-canvas');
	var wrap = $('canvas-wrap');
	P.setup(canvas);
	P.settings.handleSize = 7;

	var guidesLayer = P.project.activeLayer;
	var glyphLayer = new P.Layer();
	var extendLayer = new P.Layer();    // Extend ends to guides: the added lengths (view only)
	var orderLayer = new P.Layer();     // stroke order: start points, direction, travel
	var playLayer = new P.Layer();      // the Play animation
	var selLayer = new P.Layer();       // selection highlights and transform box
	var overlayLayer = new P.Layer();   // hover, marquee, previews
	glyphLayer.selectedColor = COLORS.select;
	glyphLayer.activate();

	function font() { return state.entry && state.entry.font; }
	function px(n) { return n / P.view.zoom; }   // screen pixels -> font units

	new ResizeObserver(function () {
		var w = wrap.clientWidth, h = wrap.clientHeight;
		if (w > 0 && h > 0) {
			P.view.viewSize = new P.Size(w, h);
			fit();
		}
	}).observe(wrap);

	// ------------------------------------------------------------- helpers

	function snap(point) {
		if (!state.snap) return new P.Point(round(point.x, 0.1), round(point.y, 0.1));
		return new P.Point(round(point.x, state.grid), round(point.y, state.grid));
	}

	function round(n, step) {
		return Math.round(Math.round(n / step) * step * 1000) / 1000;
	}

	function setStatus(msg, isError) {
		var el = $('status');
		el.textContent = msg || '';
		el.className = isError ? 'error' : '';
	}

	function glyphLabel(ch) {
		if (ch.length > 1) return ch;
		var name = GregFont.GLYPH_NAMES[ch];
		return name ? ch + '  (' + name + ')' : ch;
	}

	function defaultBearing() {
		return round(font().cell.width * 0.1, 0.5);
	}

	function slug(name) {
		return (name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
	}

	function isTyping(e) {
		var t = e.target;
		return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
	}

	// -------------------------------------------------- canvas <-> font data

	function pathStyle(p) {
		var f = font(), o = p.data.style || {};
		p.strokeColor = COLORS.ink;
		p.fillColor = null;
		p.strokeWidth = state.strokeWidth;
		p.strokeCap = o.strokeCap || f.style.strokeCap;
		p.strokeJoin = o.strokeJoin || f.style.strokeJoin;
		p.miterLimit = o.miterLimit || f.style.miterLimit;
	}

	function editablePaths() {
		return glyphLayer.children.filter(function (it) { return it instanceof P.Path; });
	}

	// Put the current glyph on the canvas, as separate editable paths.
	function loadGlyph() {
		stopPlay();
		finishPen();
		selCurves.clear();
		glyphLayer.removeChildren();
		var glyph = font().glyphs[state.ch];
		if (glyph) {
			glyph.paths.forEach(function (entry) {
				var style = {};
				['strokeCap', 'strokeJoin', 'miterLimit'].forEach(function (k) {
					if (entry[k] !== undefined) style[k] = entry[k];
				});
				// font units are y-up; the canvas is y-down with the origin on the baseline
				var item = P.PathItem.create(GregFont.flipPathData(entry.d, 0));
				var parts = item instanceof P.CompoundPath ? item.removeChildren() : [item];
				item.remove();
				parts.forEach(function (path) {
					path.data.style = Object.assign({}, style);
					if (entry.group) path.data.group = entry.group;
					pathStyle(path);
					glyphLayer.addChild(path);
				});
			});
		}
		drawGuides();
		updateGlyphPanel();
		renderKerning();
	}

	// Write the canvas back into the font.
	function commit() {
		var f = font();
		var paths = editablePaths().filter(function (p) { return p.segments.length > 1; });
		var glyph = f.glyphs[state.ch];
		if (!glyph) {
			if (!paths.length) return;
			glyph = f.glyphs[state.ch] = { lsb: defaultBearing(), rsb: defaultBearing(), paths: [] };
		}
		glyph.paths = paths.map(function (p) {
			var entry = { d: GregFont.flipPathData(p.getPathData(null, 3), 0) };   // back to y-up
			var style = p.data.style || {};
			Object.keys(style).forEach(function (k) { if (style[k] !== undefined && style[k] !== '') entry[k] = style[k]; });
			if (p.data.group) entry.group = p.data.group;
			return entry;
		});
		GregFont.clearCache(f, state.ch);
		drawGuides();
		updateThumb(state.ch);
		renderPreview();
		updateGlyphPanel();
	}

	// ---------------------------------------------------------- undo / redo

	// The open undo step: { ch, before }. A step stays open for the length of
	// a mouse drag, a pen stroke, or dragging a number field (fieldEdit), so
	// all of it undoes at once.
	var pending = null;
	var fieldEdit = false;

	function snapshot(ch) {
		var g = font().glyphs[ch];
		return g ? JSON.stringify(g) : null;
	}

	function editInProgress() {
		return !!(drag || penPath || fieldEdit);
	}

	function beginEdit() {
		// A step left open with nothing going on (or for another glyph) was
		// never closed: close it now, so it can't swallow the edits after it.
		if (pending && (pending.ch !== state.ch || !editInProgress())) endEdit();
		if (!pending) pending = { ch: state.ch, before: snapshot(state.ch) };
	}

	function endEdit() {
		if (!pending) return;
		commit();
		var after = snapshot(pending.ch);
		if (after !== pending.before) {
			state.undo.push(pending);
			state.redo = [];
			markDirty();
		}
		pending = null;
	}

	// An undo step is { ch, before } for one glyph, or { batch: [...] } for
	// a change to many glyphs at once (like updating from an SVG).
	function restore(from, to) {
		finishPen();   // may add the pen stroke as its own undo step first
		if (pending && !editInProgress()) endEdit();   // and any step left open
		var e = from.pop();
		if (!e) return;
		var items = e.batch || [e];
		var inverse = items.map(function (it) { return { ch: it.ch, before: snapshot(it.ch) }; });
		to.push(e.batch ? { batch: inverse } : inverse[0]);
		var f = font();
		items.forEach(function (it) {
			if (it.before === null) delete f.glyphs[it.ch];
			else f.glyphs[it.ch] = JSON.parse(it.before);
			GregFont.clearCache(f, it.ch);
		});
		markDirty();
		if (e.batch) {
			renderGrid();
			loadGlyph();
		} else {
			if (e.ch !== state.ch) selectGlyph(e.ch);
			else loadGlyph();
			updateThumb(e.ch);
		}
		renderPreview();
	}

	function undo() { restore(state.undo, state.redo); }
	function redo() { restore(state.redo, state.undo); }

	// Glyph-level edit wrapped as one undo step. Made during a drag or pen
	// stroke, it becomes part of that step instead of cutting it short.
	function edit(fn) {
		var inside = !!pending && pending.ch === state.ch && editInProgress();
		beginEdit();
		fn();
		if (inside) commit();
		else endEdit();
	}

	// --------------------------------------------------------------- guides

	function inkBounds() {
		var paths = editablePaths().filter(function (p) { return p.segments.length; });
		if (!paths.length) return null;
		var b = paths[0].bounds;
		paths.slice(1).forEach(function (p) { b = b.unite(p.bounds); });
		return b;
	}

	function line(from, to, color, dashed, layer) {
		var l = new P.Path.Line({ from: from, to: to, strokeColor: color, strokeWidth: 1, insert: false });
		l.strokeScaling = false;
		if (dashed) l.dashArray = [4, 4];
		(layer || guidesLayer).addChild(l);
		return l;
	}

	function label(text, point, color, justification) {
		var t = new P.PointText({
			point: point, content: text, fillColor: color, fontSize: px(11),
			fontFamily: "'IBM Plex Mono', monospace", justification: justification || 'left', insert: false
		});
		guidesLayer.addChild(t);
	}

	function drawGuides() {
		showCanvasZoom();
		guidesLayer.removeChildren();
		var f = font();
		if (!f) return;
		var vb = P.view.bounds;

		// grid: thin out the lines when zoomed out (snapping works either way)
		if (state.show.grid) {
			var step = state.grid;
			while (step * P.view.zoom < 8) step *= 2;
			var major = step * 10;
			for (var x = Math.floor(vb.left / step) * step; x <= vb.right; x += step) {
				line([x, vb.top], [x, vb.bottom], Math.abs(x % major) < 1e-6 ? COLORS.gridMajor : COLORS.grid);
			}
			for (var y = Math.floor(vb.top / step) * step; y <= vb.bottom; y += step) {
				line([vb.left, y], [vb.right, y], Math.abs(y % major) < 1e-6 ? COLORS.gridMajor : COLORS.grid);
			}
		}

		// the cell: a light fill sitting on the baseline, under the grid lines.
		// (The canvas is y-down, so heights above the baseline are negative here.)
		if (state.show.cell) {
			var cell = new P.Path.Rectangle({ point: [0, -f.cell.height], size: [f.cell.width, f.cell.height], fillColor: COLORS.cell, insert: false });
			guidesLayer.addChild(cell);
			cell.sendToBack();
		}

		if (state.show.guides) {
			// font guides, labelled with their height
			Object.keys(COLORS.guide).forEach(function (key) {
				var h = key === 'baseline' ? 0 : f.guides[key];
				if (h === null || h === undefined) return;
				var gy = -h;
				line([vb.left, gy], [vb.right, gy], COLORS.guide[key]);
				// past the tool tab
				label((key === 'xHeight' ? 'x-height' : key) + ' ' + h, [vb.left + px(58), gy - px(4)], COLORS.guide[key]);
			});

			// the origin
			var dot = new P.Path.Circle({ center: [0, 0], radius: px(3.5), fillColor: COLORS.guide.baseline, insert: false });
			guidesLayer.addChild(dot);
			label('0,0', [-px(6), px(14)], COLORS.guide.baseline, 'right');
		}

		// side bearings
		var glyph = f.glyphs[state.ch];
		var ink = inkBounds();
		if (glyph && ink) {
			var lx = ink.left - glyph.lsb, rx = ink.right + glyph.rsb;
			line([lx, vb.top], [lx, vb.bottom], COLORS.bearing, true);
			line([rx, vb.top], [rx, vb.bottom], COLORS.bearing, true);
			label('lsb ' + glyph.lsb, [lx - px(4), vb.top + px(16)], COLORS.bearing, 'right');
			label('rsb ' + glyph.rsb, [rx + px(4), vb.top + px(16)], COLORS.bearing);
		}
		drawExtensions();
		drawOrder();
		drawSelection();
	}

	// Extend ends to guides, on the canvas: draw the extra length on each
	// stroke end that would be lengthened. Nothing is added to the glyph.
	function drawExtensions() {
		extendLayer.removeChildren();
		var f = font();
		if (!f || typeof previewView === 'undefined' || !previewView.extend) return;
		editablePaths().forEach(function (p) {
			if (p.closed || p.segments.length < 2) return;
			var up = p.clone({ insert: false });
			up.scale(1, -1, new P.Point(0, 0));          // the canvas is y-down, fonts are y-up
			var added = [];
			GregFont.extendEnds(P, f, up.getPathData(null, 4), state.strokeWidth, p.strokeCap, added);
			added.forEach(function (a) {
				var from = new P.Point(a.from[0], -a.from[1]), to = new P.Point(a.to[0], -a.to[1]);
				// start a little inside the stroke so no hairline seam shows
				var back = from.subtract(to).normalize(Math.min(0.5, state.strokeWidth / 4));
				var l = new P.Path.Line({ from: from.add(back), to: to, insert: false });
				l.strokeColor = COLORS.ink;
				l.strokeWidth = state.strokeWidth;
				l.strokeCap = 'butt';
				extendLayer.addChild(l);
			});
		});
	}

	function bearingLines() {
		var glyph = font().glyphs[state.ch];
		var ink = inkBounds();
		if (!glyph || !ink) return null;
		return { lsb: ink.left - glyph.lsb, rsb: ink.right + glyph.rsb, ink: ink };
	}

	// --- canvas zoom: the - / % / + / Fit controls and Ctrl+= / Ctrl+- / Ctrl+0
	function zoomCanvas(zoom, at) {
		zoom = Math.min(Math.max(zoom, 0.2), 200);
		at = at || P.view.center;
		var old = P.view.zoom;
		P.view.center = at.add(P.view.center.subtract(at).multiply(old / zoom));
		P.view.zoom = zoom;
		drawGuides();
	}

	function showCanvasZoom() {
		var label = $('canvas-zoom-reset');
		if (label) label.textContent = Math.round(P.view.zoom * 100) + '%';
	}

	function fit() {
		var f = font();
		if (!f) return;
		var ink = inkBounds();
		var left = Math.min(0, ink ? ink.left : 0);
		var right = Math.max(f.cell.width, ink ? ink.right : 0);
		var top = Math.min(-f.guides.cap, -f.cell.height, ink ? ink.top : 0);
		var bottom = Math.max(-(f.guides.descender || 0), 0, ink ? ink.bottom : 0);
		var w = right - left, h = bottom - top;
		var region = new P.Rectangle(left - w * 0.6, top - h * 0.15, w * 2.2, h * 1.3);
		var vs = P.view.viewSize;
		P.view.zoom = Math.min(vs.width / region.width, vs.height / region.height);
		P.view.center = region.center;
		drawGuides();
	}

	// ----------------------------------------------------------------- tools
	//
	// Selection works like Illustrator:
	//   Select (V)  picks whole paths and shows a box for scaling and rotating.
	//   Direct (A)  picks points, and the segments between points.
	// Paper only tracks selection per point, so direct-selected segments are
	// kept in selCurves, keyed by the segment's first point.

	var tool = new P.Tool();
	var drag = null;          // what the current mouse drag is doing
	var penPath = null;       // path being drawn with the pen
	var rubber = null;        // pen preview segment
	var hover = null;         // hover highlight
	var spaceDown = false;
	var panning = null;
	var selCurves = new Set();
	var EPS = 0.01;           // points closer than this count as the same point
	var MIN_PIECE = 0.5;      // shortest piece slicing will make, in font units

	// [name, x, y] as fractions of the selection box
	var BOX_HANDLES = [
		['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
		['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]
	];
	var RESIZE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

	// modifier keys, read from the mouse event itself
	function mod(e, key) {
		return e.event ? !!e.event[key + 'Key'] : !!e.modifiers[key];
	}

	function setTool(name) {
		finishPen();
		var paths = selectedPaths();
		if (name === 'select') {
			// the Select tool always works on whole paths
			selCurves.clear();
			paths.forEach(function (p) { groupMembers(p).forEach(selectWhole); });
		} else if ((name === 'direct' || name === 'anchor') && state.tool === 'select') {
			paths.forEach(selectPoints);
		}
		state.tool = name;
		document.querySelectorAll('.tool').forEach(function (b) {
			b.classList.toggle('active', b.dataset.tool === name);
		});
		wrap.className = 'tool-' + name;
		$('shape-options').hidden = name !== 'shape';
		setTips(name);
		clearHover();
		updatePathStyleRow();
	}

	var SHAPE_HELP = {
		ellipse: 'Drag out an ellipse \u00b7 Shift for a circle',
		rect: 'Drag out a rectangle \u00b7 Shift for a square',
		line: 'Drag a straight line \u00b7 Shift for 45\u00b0 steps'
	};

	var SHAPE_ICONS = {
		ellipse: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="6.5" ry="6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
		rect: '<svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
		line: '<svg viewBox="0 0 20 20"><path d="M4 16 16 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
	};

	// Pick what the shape tool draws, and switch to it.
	function useShape(kind) {
		state.shapeKind = kind;
		$('shape-tool').innerHTML = SHAPE_ICONS[kind];
		document.querySelectorAll('#shape-options [data-shape]').forEach(function (b) {
			b.classList.toggle('active', b.dataset.shape === kind);
		});
		setTool('shape');
	}

	// --- tips: one at a time in the top bar

	var GENERAL_TIPS = [
		'Wheel zooms · Space-drag pans · F fits the glyph',
		'Number fields can be dragged: sideways, or up and down for guides',
		'Shift-click two letters in the preview to set up a kerning pair',
		'Press O to see where each stroke starts and which way it runs',
		'Snap → Paths puts points onto other paths (Shift+G)',
		'Select two pieces and press Ctrl+J to join them into one stroke',
		'X slices crossing strokes into pieces you can pick up one at a time',
		'+ New font is at the bottom of the font list'
	];
	var tips = null;   // a GregUI.Tips, made in bindUI

	// The current tool's tips first, then the general ones.
	function setTips(toolName) {
		if (!tips) return;
		var own = (toolName === 'shape' ? SHAPE_HELP[state.shapeKind] : TOOL_HELP[toolName]) || '';
		tips.setList(own.split(' \u00b7 ').filter(Boolean).map(function (t) {
			return t.charAt(0).toUpperCase() + t.slice(1);
		}).concat(GENERAL_TIPS));
	}

	function nextTip() { tips.next(); }
	function setTipsOn(on) { tips.setOn(on); }

	var TOOL_HELP = {
		select: 'Click or drag a box to pick whole paths \u00b7 drag to move, Alt-drag to copy \u00b7 box handles scale, just outside a corner rotates \u00b7 pink lines set spacing',
		direct: 'Click points, or a line to pick one segment \u00b7 Shift adds \u00b7 drag handles to reshape (Alt makes a corner) \u00b7 double-click a point for curve/corner, a line to add a point',
		pen: 'Click for corners, drag for curves \u00b7 click the first point to close, or the end of another path to join \u00b7 Enter or Esc finishes',

		anchor: 'Drag from a point to pull out curve handles \u00b7 click a point to make it a corner \u00b7 drag a handle to move it on its own',
		scissors: 'Click a path to cut it there \u00b7 drag a line across paths to cut everything it crosses (Shift: 45\u00b0 steps)'
	};

	// --- selection model

	function cleanCurves() {
		selCurves.forEach(function (s) {
			if (!s.path || !s.path.parent || !s.next) selCurves.delete(s);
		});
	}

	// points selected one by one (Direct tool)
	function selectedSegments() {
		var out = [];
		editablePaths().forEach(function (p) {
			p.segments.forEach(function (s) { if (s.selected) out.push(s); });
		});
		return out;
	}

	// a path picked as a whole: selected, but no single points selected
	function isWhole(p) {
		return p.selected && !p.segments.some(function (s) { return s.selected; });
	}

	function selectedPaths() {
		cleanCurves();
		var withCurves = new Set();
		selCurves.forEach(function (s) { withCurves.add(s.path); });
		return editablePaths().filter(function (p) { return p.selected || withCurves.has(p); });
	}

	// every point that moves when the selection is dragged or transformed
	function movingSegments() {
		cleanCurves();
		var set = new Set();
		editablePaths().forEach(function (p) {
			if (!p.selected) return;
			var whole = isWhole(p);
			p.segments.forEach(function (s) { if (whole || s.selected) set.add(s); });
		});
		selCurves.forEach(function (s) { set.add(s); set.add(s.next); });
		return Array.from(set);
	}

	// is curve i of the path (from point i to the next) selected?
	function curveSelected(path, i) {
		var segs = path.segments, a = segs[i], b = segs[(i + 1) % segs.length];
		return isWhole(path) || selCurves.has(a) || (a.selected && b.selected);
	}

	function allSelected(p) {
		return isWhole(p) || p.segments.every(function (s) { return s.selected; });
	}

	function deselectAll() {
		editablePaths().forEach(function (p) { p.selected = false; });
		selCurves.clear();
	}

	function selectWhole(p) {
		p.selected = false;   // clears point selection
		p.selected = true;
	}

	function selectPoints(p) {
		p.segments.forEach(function (s) { s.selected = true; });
	}

	function selectPath(p) {
		if (state.tool === 'direct') selectPoints(p);
		else selectWhole(p);
	}

	// --- groups (stored per path as data.group, a number)

	function groupMembers(path) {
		var g = path.data.group;
		if (!g) return [path];
		return editablePaths().filter(function (p) { return p.data.group === g; });
	}

	function newGroupId() {
		var max = 0;
		editablePaths().forEach(function (p) { if (p.data.group > max) max = p.data.group; });
		return max + 1;
	}

	// copies of grouped paths become their own new groups
	function regroup(paths) {
		var map = {}, next = newGroupId();
		paths.forEach(function (p) {
			var g = p.data.group;
			if (!g) return;
			if (!map[g]) map[g] = next++;
			p.data.group = map[g];
		});
	}

	function groupSelection() {
		var paths = selectedPaths();
		if (paths.length < 2) { setStatus('Select two or more paths to group'); return; }
		edit(function () {
			var id = newGroupId();
			paths.forEach(function (p) { p.data.group = id; });
		});
		setStatus('Grouped ' + paths.length + ' paths');
	}

	function ungroupSelection() {
		var paths = selectedPaths().filter(function (p) { return p.data.group; });
		if (!paths.length) { setStatus('Nothing grouped is selected'); return; }
		edit(function () {
			paths.forEach(function (p) { delete p.data.group; });
		});
		setStatus('Ungrouped');
	}

	function toggleAnchor(s) {
		s.selected = !s.selected;
		var p = s.path;
		if (!p.segments.some(function (x) { return x.selected; })) p.selected = false;
	}

	function pointBounds(segs) {
		var r = new P.Rectangle(segs[0].point, segs[0].point);
		segs.forEach(function (s) { r = r.include(s.point); });
		return r;
	}

	// --- hit testing

	function hitGlyph(point, opts) {
		return glyphLayer.hitTest(point, Object.assign({ segments: true, stroke: true, fill: false, tolerance: px(6) }, opts));
	}

	// The side bearing lines are only grabbed at the top, by their lsb / rsb
	// labels, so clicks along the lines still select and marquee.
	function hitBearing(point) {
		var b = bearingLines();
		if (!b) return null;
		var top = P.view.bounds.top, tol = px(6), labelW = px(64);
		if (point.y < top || point.y > top + px(26)) return null;
		if (point.x > b.lsb - labelW && point.x < b.lsb + tol) return 'lsb';
		if (point.x > b.rsb - tol && point.x < b.rsb + labelW) return 'rsb';
		return null;
	}

	// bezier handles that are showing (Direct tool)
	function hitHandle(point) {
		var tol = px(6), best = null, cands = [];
		selectedSegments().forEach(function (s) { cands.push([s, 'handleIn'], [s, 'handleOut']); });
		selCurves.forEach(function (s) { cands.push([s, 'handleOut'], [s.next, 'handleIn']); });
		cands.forEach(function (c) {
			var s = c[0], k = c[1];
			if (s[k].isZero()) return;
			var d = s.point.add(s[k]).getDistance(point);
			if (d < tol && (!best || d < best.d)) best = { segment: s, which: k, d: d };
		});
		return best;
	}

	// the Select tool's transform box
	function selectionBox() {
		if (state.tool !== 'select') return null;
		var paths = selectedPaths();
		if (!paths.length) return null;
		var b = paths[0].bounds;
		paths.slice(1).forEach(function (p) { b = b.unite(p.bounds); });
		return b;
	}

	function boxPoint(b, h) {
		return new P.Point(b.x + b.width * h[1], b.y + b.height * h[2]);
	}

	function boxHandles(b) {
		// skip side handles on a flat side, or when the box is small on screen
		return BOX_HANDLES.filter(function (h) {
			if (h[1] === 0.5) return b.width * P.view.zoom > 30;
			if (h[2] === 0.5) return b.height * P.view.zoom > 30;
			return true;
		});
	}

	function hitBox(point) {
		var b = selectionBox();
		if (!b) return null;
		var tol = px(6), handles = boxHandles(b), i, q;
		for (i = 0; i < handles.length; i++) {
			q = boxPoint(b, handles[i]);
			if (Math.abs(point.x - q.x) < tol && Math.abs(point.y - q.y) < tol) {
				return { kind: 'scale', handle: handles[i], box: b };
			}
		}
		// just outside a corner rotates
		if (!b.expand(px(4)).contains(point)) {
			for (i = 0; i < handles.length; i++) {
				if (handles[i][1] === 0.5 || handles[i][2] === 0.5) continue;
				if (boxPoint(b, handles[i]).getDistance(point) < px(22)) {
					return { kind: 'rotate', handle: handles[i], box: b };
				}
			}
		}
		return null;
	}

	function isSmooth(s) {
		if (s.handleIn.isZero() || s.handleOut.isZero()) return false;
		return s.handleIn.normalize().add(s.handleOut.normalize()).length < 0.05;
	}

	function isOpenEnd(s) {
		var p = s.path;
		return p && !p.closed && p.segments.length > 1 && (s.isFirst() || s.isLast());
	}

	// --- drawing selection + hover

	function curvePath(s) {
		var e = s.next;
		return new P.Path({
			segments: [new P.Segment(s.point, null, s.handleOut), new P.Segment(e.point, e.handleIn, null)],
			insert: false
		});
	}

	function marker(point, layer, round) {
		var size = px(7);
		var m = round
			? new P.Path.Circle({ center: point, radius: size / 2, insert: false })
			: new P.Path.Rectangle({ point: point.subtract(size / 2), size: [size, size], insert: false });
		m.fillColor = 'white';
		m.strokeColor = COLORS.select;
		m.strokeWidth = 1;
		m.strokeScaling = false;
		layer.addChild(m);
		return m;
	}

	function drawSelection() {
		selLayer.removeChildren();
		if (!font()) return;
		cleanCurves();
		selCurves.forEach(function (s) {
			var c = curvePath(s);
			c.strokeColor = COLORS.select;
			c.strokeWidth = 3;
			c.strokeScaling = false;
			selLayer.addChild(c);
			[[s, 'handleOut'], [s.next, 'handleIn']].forEach(function (h) {
				var seg = h[0], v = seg[h[1]];
				if (v.isZero() || seg.selected) return;
				line(seg.point, seg.point.add(v), COLORS.select, false, selLayer);
				marker(seg.point.add(v), selLayer, true);
			});
			[s, s.next].forEach(function (seg) { if (!seg.selected) marker(seg.point, selLayer); });
		});
		var b = selectionBox();
		if (b) {
			var r = new P.Path.Rectangle({ rectangle: b, strokeColor: COLORS.select, strokeWidth: 1, insert: false });
			r.strokeScaling = false;
			r.dashArray = [4, 3];
			selLayer.addChild(r);
			boxHandles(b).forEach(function (h) { marker(boxPoint(b, h), selLayer); });
		}
	}

	function clearHover() {
		if (hover) { hover.remove(); hover = null; }
	}

	function showHover(point) {
		var hit = hitGlyph(point);
		if (!hit) return;
		var h;
		if (state.tool === 'select') {
			// outline the whole group
			h = new P.Group({ insert: false });
			groupMembers(hit.item).forEach(function (m) {
				var c = m.clone({ insert: false });
				c.selected = false;
				c.fillColor = null;
				c.strokeColor = COLORS.select;
				c.strokeWidth = 2;
				c.strokeScaling = false;
				h.addChild(c);
			});
			h.opacity = 0.6;
			overlayLayer.addChild(h);
			hover = h;
			return;
		} else if (hit.type === 'segment') {
			hover = marker(hit.segment.point, overlayLayer, true);
			return;
		} else if (state.tool === 'scissors') {
			hover = marker(hit.location.point, overlayLayer, true);
			return;
		} else {
			h = curvePath(hit.location.curve.segment1);
		}
		h.fillColor = null;
		h.strokeColor = COLORS.select;
		h.strokeWidth = 2;
		h.strokeScaling = false;
		h.opacity = 0.6;
		overlayLayer.addChild(h);
		hover = h;
	}

	// --- mouse

	tool.onMouseMove = function (e) {
		$('cursor-pos').textContent = round(e.point.x, 0.1) + ', ' + round(-e.point.y, 0.1);
		if (state.tool === 'pen' && penPath) {
			if (rubber) rubber.remove();
			rubber = line(penPath.lastSegment.point, snapTarget(e.point, [penPath]).point, COLORS.overlay, true, overlayLayer);
		}
		clearHover();
		if (drag) return;
		// show where the pen or a shape would snap onto a path
		if (state.tool === 'pen' || state.tool === 'shape') hover = snapMarker(snapTarget(e.point, penPath ? [penPath] : null));
		var cursor = '';
		if (state.tool === 'select' || state.tool === 'direct') {
			var box = hitBox(e.point);
			if (box && box.kind === 'rotate' && hitGlyph(e.point)) box = null;
			if (box) cursor = box.kind === 'rotate' ? 'grab' : RESIZE_CURSORS[box.handle[0]];
			else if (!hitGlyph(e.point) && hitBearing(e.point)) cursor = 'ew-resize';
			else showHover(e.point);
		} else if (state.tool === 'scissors' || state.tool === 'anchor') {
			showHover(e.point);
		}
		wrap.style.cursor = cursor;
	};

	tool.onMouseDown = function (e) {
		if (panning || e.event.button !== 0) return;
		if (drag) { drag = null; endEdit(); }   // the last drag's mouse-up went missing
		stopPlay();
		clearHover();
		if (state.tool === 'select') selectDown(e);
		else if (state.tool === 'direct') directDown(e);
		else if (state.tool === 'pen') penDown(e);
		else if (state.tool === 'scissors') drag = { mode: 'knife', start: e.point };
		else if (state.tool === 'anchor') anchorDown(e);
		else if (state.tool === 'shape') drag = { mode: 'shape', kind: state.shapeKind, start: snapTarget(e.point).point };
	};

	tool.onMouseDrag = function (e) {
		if (panning || !drag) return;
		$('cursor-pos').textContent = round(e.point.x, 0.1) + ', ' + round(-e.point.y, 0.1);
		var p = snap(e.point);
		if (drag.mode === 'points') {
			dragPoints(e);
		} else if (drag.mode === 'transform') {
			applyMatrix(drag.origs, transformMatrix(drag, e));
			commit();
		} else if (drag.mode === 'handle') {
			var s = drag.segment;
			var v = snapHandleTip(e, s).subtract(s.point);
			s[drag.which] = v;
			if (drag.mirror && !mod(e, 'alt') && !v.isZero()) {
				var other = drag.which === 'handleIn' ? 'handleOut' : 'handleIn';
				s[other] = v.normalize(-drag.otherLength);
			}
			commit();
		} else if (drag.mode === 'lsb' || drag.mode === 'rsb') {
			var glyph = font().glyphs[state.ch];
			if (drag.mode === 'lsb') glyph.lsb = round(drag.ink.left - p.x, 0.001);
			else glyph.rsb = round(p.x - drag.ink.right, 0.001);
			commit();
		} else if (drag.mode === 'marquee') {
			if (drag.box) drag.box.remove();
			drag.box = new P.Path.Rectangle({ from: drag.start, to: e.point, strokeColor: COLORS.overlay, insert: false });
			drag.box.strokeScaling = false;
			drag.box.dashArray = [3, 3];
			overlayLayer.addChild(drag.box);
		} else if (drag.mode === 'knife') {
			if (drag.line) drag.line.remove();
			drag.end = constrain(drag.start, e.point, mod(e, 'shift'));
			if (drag.end.getDistance(drag.start) > px(4)) {
				drag.line = line(drag.start, drag.end, COLORS.bearing, true, overlayLayer);
			}
		} else if (drag.mode === 'convert') {
			// pull handles out of the point, mirrored, as with Illustrator's Anchor Point tool
			var cs = drag.segment;
			var out = snapHandleTip(e, cs).subtract(cs.point);
			if (out.getDistance(new P.Point(0, 0)) > px(2)) {
				drag.moved = true;
				cs.handleOut = out;
				cs.handleIn = out.multiply(-1);
				commit();
			}
		} else if (drag.mode === 'pen-handle') {
			var h = snapHandleTip(e, drag.segment).subtract(drag.segment.point);
			drag.segment.handleOut = h;
			drag.segment.handleIn = h.multiply(-1);
		} else if (drag.mode === 'shape') {
			if (drag.preview) drag.preview.remove();
			if (drag.marker) { drag.marker.remove(); drag.marker = null; }
			var end = snapTarget(e.point);
			drag.marker = snapMarker(end);
			drag.preview = shapeFrom(drag.kind, drag.start, end.point, mod(e, 'shift'));
			if (drag.preview) {
				pathStyle(drag.preview);
				drag.preview.strokeColor = COLORS.overlay;
				overlayLayer.addChild(drag.preview);
			}
		}
	};

	tool.onMouseUp = function (e) {
		if (!drag) return;
		if (drag.marker) drag.marker.remove();
		if (drag.mode === 'marquee') {
			if (drag.box) {
				var rect = drag.box.bounds;
				drag.box.remove();
				if (state.tool === 'select') {
					var rp = new P.Path.Rectangle({ rectangle: rect, insert: false });
					editablePaths().forEach(function (path) {
						var inside = path.segments.some(function (s) { return rect.contains(s.point); });
						if (inside || path.getIntersections(rp).length) groupMembers(path).forEach(selectWhole);
					});
				} else {
					editablePaths().forEach(function (path) {
						path.segments.forEach(function (s) { if (rect.contains(s.point)) s.selected = true; });
					});
				}
			}
			updatePathStyleRow();
		} else if (drag.mode === 'shape') {
			if (drag.preview) drag.preview.remove();
			var shape = shapeFrom(drag.kind, drag.start, snapTarget(e.point).point, mod(e, 'shift'));
			if (shape) {
				edit(function () {
					shape.data.style = {};
					pathStyle(shape);
					glyphLayer.addChild(shape);
					deselectAll();
					autoSlice(shape);
				});
			}
		} else if (drag.mode === 'pen-handle') {
			commit();
		} else if (drag.mode === 'knife') {
			if (drag.line) { drag.line.remove(); knifeCut(drag.start, drag.end); }
			else clickCut(e.point);
		} else if (drag.mode === 'convert') {
			// a click without a drag makes a sharp corner
			if (!drag.moved) {
				drag.segment.handleIn = [0, 0];
				drag.segment.handleOut = [0, 0];
			}
			endEdit();
			updatePathStyleRow();
		} else {
			if (drag.mode === 'transform' && drag.kind === 'rotate') setStatus('');
			endEdit();
		}
		drag = null;
	};

	// A shape dragged from a to b. Shift makes a circle or square, or keeps a
	// line to 45 degree steps. Returns null if it's too small to keep.
	function shapeFrom(kind, a, b, constrained) {
		if (kind === 'line') {
			var end = constrain(a, b, constrained);
			if (end.getDistance(a) < 0.01) return null;
			return new P.Path.Line({ from: a, to: end, insert: false });
		}
		var w = b.x - a.x, h = b.y - a.y;
		if (constrained) {
			var size = Math.max(Math.abs(w), Math.abs(h));
			w = w < 0 ? -size : size;
			h = h < 0 ? -size : size;
		}
		if (Math.abs(w) < 0.01 || Math.abs(h) < 0.01) return null;
		var rect = new P.Rectangle(a, a.add([w, h]));
		return kind === 'rect'
			? new P.Path.Rectangle({ rectangle: rect, insert: false })
			: new P.Path.Ellipse({ rectangle: rect, insert: false });
	}

	function nearestPoint(path, point) {
		var best = path.firstSegment;
		path.segments.forEach(function (s) {
			if (s.point.getDistance(point) < best.point.getDistance(point)) best = s;
		});
		return best.point;
	}

	// Select tool: whole paths
	function selectDown(e) {
		var point = e.point, shift = mod(e, 'shift');

		var box = hitBox(point);
		if (box && box.kind === 'scale') { startTransform(box, point); return; }

		var hit = hitGlyph(point);
		if (!hit && box) { startTransform(box, point); return; }
		if (!hit) {
			var bearing = hitBearing(point);
			if (bearing) {
				beginEdit();
				drag = { mode: bearing, ink: bearingLines().ink };
				return;
			}
			if (!shift) deselectAll();
			drag = { mode: 'marquee', start: point };
			updatePathStyleRow();
			return;
		}

		var path = hit.item, members = groupMembers(path);
		if (shift && path.selected) {
			members.forEach(function (m) { m.selected = false; });
			updatePathStyleRow();
			return;
		}
		if (!shift && !path.selected) deselectAll();
		members.forEach(selectWhole);
		startPointDrag(nearestPoint(path, point), mod(e, 'alt'), point);
	}

	// Direct tool: points and segments
	function directDown(e) {
		var point = e.point, shift = mod(e, 'shift'), alt = mod(e, 'alt');

		var handle = hitHandle(point);
		if (handle) {
			beginEdit();
			var hs = handle.segment;
			var other = handle.which === 'handleIn' ? 'handleOut' : 'handleIn';
			drag = { mode: 'handle', segment: hs, which: handle.which, mirror: isSmooth(hs), otherLength: hs[other].length };
			return;
		}

		var hit = hitGlyph(point);
		if (hit && hit.type === 'segment') {
			var seg = hit.segment;
			if (shift) {
				toggleAnchor(seg);
				if (!seg.selected) { updatePathStyleRow(); return; }
			} else if (!seg.selected || allSelected(seg.path)) {
				// clicking into a fully selected path picks just this point
				deselectAll();
				seg.selected = true;
			}
			startPointDrag(seg.point, alt, point);
			return;
		}

		if (!hit) {
			var bearing = hitBearing(point);
			if (bearing) {
				beginEdit();
				drag = { mode: bearing, ink: bearingLines().ink };
				return;
			}
			if (!shift) deselectAll();
			drag = { mode: 'marquee', start: point };
			updatePathStyleRow();
			return;
		}

		// a segment between two points
		var start = hit.location.curve.segment1;
		var path = start.path;
		var already = selCurves.has(start) ||
			(curveSelected(path, start.index) && !allSelected(path));
		if (shift) {
			if (selCurves.has(start)) {
				selCurves.delete(start);
				updatePathStyleRow();
				return;
			}
			selCurves.add(start);
		} else if (!already) {
			deselectAll();
			selCurves.add(start);
		}
		var a = start.point, b = start.next.point;
		startPointDrag(a.getDistance(point) < b.getDistance(point) ? a : b, alt, point);
	}

	// anchor: the point that lands on the grid; click: where the mouse went down
	// Anchor Point tool: drag from a point to pull out smooth handles, click a
	// point to make it a corner, drag a handle to move it on its own.
	function anchorDown(e) {
		var handle = hitHandle(e.point);
		if (handle) {
			beginEdit();
			drag = { mode: 'handle', segment: handle.segment, which: handle.which, mirror: false };
			return;
		}
		var hit = hitGlyph(e.point, { stroke: false });
		if (!hit || hit.type !== 'segment') return;
		beginEdit();
		deselectAll();
		hit.segment.selected = true;
		drag = { mode: 'convert', segment: hit.segment, moved: false };
		updatePathStyleRow();
	}

	function setPointsSmooth(smooth) {
		var segs = selectedSegments();
		if (!segs.length) { setStatus('Select points with the Direct tool first'); return; }
		edit(function () {
			segs.forEach(function (s) {
				if (smooth) s.smooth({ type: 'catmull-rom' });
				else { s.handleIn = [0, 0]; s.handleOut = [0, 0]; }
			});
		});
		updatePathStyleRow();
	}

	function startPointDrag(anchor, alt, click) {
		beginEdit();
		drag = { mode: 'points', anchorStart: anchor.clone(), click: (click || anchor).clone(), alt: alt };
		collectPointDrag();
		updatePathStyleRow();
	}

	function collectPointDrag() {
		var segs = movingSegments(), moving = new Set(segs);
		drag.segments = segs;
		drag.starts = segs.map(function (s) { return s.point.clone(); });
		// moving whole paths: their outline's edges snap too (see snapMove)
		var g = selectionGeometry();
		drag.box = g && !g.single && g.whole ? g.box.clone() : null;
		// other points, and lines of paths that aren't moving, to snap onto
		drag.targets = [];
		drag.staticPaths = [];
		editablePaths().forEach(function (p) {
			p.segments.forEach(function (s) { if (!moving.has(s)) drag.targets.push(s.point.clone()); });
			if (p.segments.length > 1 && !p.segments.some(function (s) { return moving.has(s); })) drag.staticPaths.push(p);
		});
	}

	function dragPoints(e) {
		// Alt-drag drags a copy
		if (drag.alt && !drag.copied) {
			drag.copied = true;
			if (duplicateSelection()) collectPointDrag();
		}
		var raw = e.point.subtract(drag.click);
		// Shift keeps the move straight across or straight up and down
		var lock = mod(e, 'shift') ? (Math.abs(raw.x) >= Math.abs(raw.y) ? 'x' : 'y') : null;
		if (lock === 'x') raw = new P.Point(raw.x, 0);
		else if (lock === 'y') raw = new P.Point(0, raw.y);
		var delta = drag.box ? snapMove(raw) : snap(drag.anchorStart.add(raw)).subtract(drag.anchorStart);
		if (lock === 'x') delta = new P.Point(delta.x, 0);
		else if (lock === 'y') delta = new P.Point(0, delta.y);
		// snap onto nearby points (so pieces line up for joining), else onto lines
		var best = null, tol = px(8);
		if (state.snapPath && !lock) {
			drag.starts.forEach(function (st) {
				var q = st.add(raw);
				drag.targets.forEach(function (t) {
					var d = t.getDistance(q);
					if (d < tol && (!best || d < best.d)) best = { d: d, delta: t.subtract(st), at: t };
				});
			});
			// lines too, when only a few points are moving
			if (!best && drag.starts.length <= 20) {
				var ctol = px(6);
				drag.starts.forEach(function (st) {
					var q = st.add(raw);
					drag.staticPaths.forEach(function (p) {
						var loc = p.getNearestLocation(q);
						if (loc && loc.distance < ctol && (!best || loc.distance < best.d)) {
							best = { d: loc.distance, delta: loc.point.subtract(st), at: loc.point };
						}
					});
				});
			}
		}
		if (drag.marker) { drag.marker.remove(); drag.marker = null; }
		if (best) {
			delta = best.delta;
			drag.marker = marker(best.at, overlayLayer, true);
			drag.marker.strokeColor = COLORS.bearing;
		}
		drag.segments.forEach(function (s, i) { s.point = drag.starts[i].add(delta); });
		commit();
	}

	// Moving whole paths: the grabbed point and the outline's left, centre and
	// right (top, middle and bottom) can each snap. Guides (0, the cell
	// edges, baseline, x-height, cap, descender) win when one is close;
	// otherwise, with grid snap on, whichever needs the smallest nudge lands on
	// the grid. Each direction is snapped on its own.
	function snapMove(raw) {
		var f = font(), b = drag.box, a = drag.anchorStart, tol = px(8);
		function axis(cands, guides, move) {
			var guide = null, grid = null;
			cands.forEach(function (c) {
				var at = c + move;
				guides.forEach(function (g) {
					var d = g - at;
					if (Math.abs(d) < tol && (!guide || Math.abs(d) < Math.abs(guide))) guide = d;
				});
				if (state.snap) {
					var d = round(at, state.grid) - at;
					if (grid === null || Math.abs(d) < Math.abs(grid)) grid = d;
				}
			});
			if (guide !== null) return move + guide;
			if (grid !== null) return move + grid;
			return round(move, 0.1);
		}
		var gy = [0, -f.cell.height, -f.guides.cap, -f.guides.xHeight, -f.guides.descender].filter(function (v) { return typeof v === 'number' && isFinite(v); });
		return new P.Point(
			axis([a.x, b.left, b.center.x, b.right], [0, f.cell.width], raw.x),
			axis([a.y, b.top, b.center.y, b.bottom], gy, raw.y)
		);
	}

	// --- transforms

	function startTransform(box, point) {
		beginEdit();
		drag = {
			mode: 'transform', kind: box.kind, handle: box.handle, box: box.box.clone(), start: point,
			origs: movingSegments().map(origOf)
		};
	}

	function origOf(s) {
		return { s: s, p: s.point.clone(), hi: s.handleIn.clone(), ho: s.handleOut.clone() };
	}

	function applyMatrix(origs, m) {
		origs.forEach(function (o) {
			var p = m.transform(o.p);
			o.s.point = p;
			o.s.handleIn = m.transform(o.p.add(o.hi)).subtract(p);
			o.s.handleOut = m.transform(o.p.add(o.ho)).subtract(p);
		});
	}

	function ratio(a, b) {
		return Math.abs(b) < 1e-9 ? 1 : a / b;
	}

	function transformMatrix(d, e) {
		var b = d.box, m = new P.Matrix();
		if (d.kind === 'rotate') {
			var c = b.center;
			var angle = e.point.subtract(c).angle - d.start.subtract(c).angle;
			if (mod(e, 'shift')) angle = Math.round(angle / 15) * 15;
			setStatus('Rotate ' + round(angle, 0.1) + '°');
			return m.rotate(angle, c);
		}
		var h = d.handle, p = snap(e.point);
		var origin = mod(e, 'alt') ? b.center : boxPoint(b, [null, 1 - h[1], 1 - h[2]]);
		var from = boxPoint(b, h);
		var sx = h[1] === 0.5 ? 1 : ratio(p.x - origin.x, from.x - origin.x);
		var sy = h[2] === 0.5 ? 1 : ratio(p.y - origin.y, from.y - origin.y);
		if (mod(e, 'shift')) {
			if (h[1] === 0.5) sx = Math.abs(sy);
			else if (h[2] === 0.5) sy = Math.abs(sx);
			else {
				var s = Math.max(Math.abs(sx), Math.abs(sy));
				sx = sx < 0 ? -s : s;
				sy = sy < 0 ? -s : s;
			}
		}
		return m.scale(sx, sy, origin);
	}

	// rotate/flip from the keyboard or toolbar, around the selection's center
	function transformSelection(makeMatrix) {
		var segs = movingSegments();
		if (!segs.length) { setStatus('Select something first'); return; }
		var center = (selectionBox() || pointBounds(segs)).center;
		if (state.snap) center = new P.Point(round(center.x, state.grid / 2), round(center.y, state.grid / 2));
		var origs = segs.map(origOf);
		edit(function () { applyMatrix(origs, makeMatrix(center)); });
	}

	function rotateSelection(angle) {
		transformSelection(function (c) { return new P.Matrix().rotate(angle, c); });
	}

	function flipSelection(vertical) {
		transformSelection(function (c) { return new P.Matrix().scale(vertical ? 1 : -1, vertical ? -1 : 1, c); });
	}

	// --- cutting, slicing, joining

	function clonePath(path) {
		var np = path.clone({ insert: false });
		np.selected = false;
		np.data = copyData(path);
		return np;
	}

	// a path's editor data (style overrides and group), for a piece or copy of it
	function copyData(path) {
		var d = { style: Object.assign({}, path.data.style) };
		if (path.data.group) d.group = path.data.group;
		return d;
	}

	// New paths made from the runs of curves where keep(i) is true.
	function piecesOf(path, keep) {
		var segs = path.segments, n = segs.length, closed = path.closed;
		var count = closed ? n : n - 1;
		if (count <= 0) return [];
		var i, all = true;
		for (i = 0; i < count; i++) if (!keep(i)) { all = false; break; }
		if (all) return [clonePath(path)];

		// on a closed path, start right after a dropped curve so runs don't wrap
		var begin = 0;
		if (closed) {
			for (i = 0; i < count; i++) if (!keep(i)) { begin = i + 1; break; }
		}
		var out = [], run = null;
		for (var k = 0; k < count; k++) {
			i = (begin + k) % n;
			if (keep(i)) (run = run || []).push(i);
			else if (run) { out.push(runPath(path, run)); run = null; }
		}
		if (run) out.push(runPath(path, run));
		return out;
	}

	function runPath(path, curves) {
		var segs = path.segments, n = segs.length;
		var list = curves.map(function (i) { return segs[i]; })
			.concat([segs[(curves[curves.length - 1] + 1) % n]]);
		var np = new P.Path({
			segments: list.map(function (s) { return new P.Segment(s.point.clone(), s.handleIn.clone(), s.handleOut.clone()); }),
			insert: false
		});
		np.firstSegment.handleIn = [0, 0];
		np.lastSegment.handleOut = [0, 0];
		np.data = copyData(path);
		return np;
	}

	// the selected segments, as new paths
	function selectionPieces() {
		var out = [];
		selectedPaths().forEach(function (path) {
			out = out.concat(piecesOf(path, function (i) { return curveSelected(path, i); }));
		});
		return out;
	}

	function duplicateSelection() {
		var pieces = selectionPieces();
		if (!pieces.length) return false;
		deselectAll();
		regroup(pieces);
		pieces.forEach(function (p) {
			pathStyle(p);
			glyphLayer.addChild(p);
			selectPath(p);
		});
		return true;
	}

	// Split a path at the given offsets along it.
	function splitAtOffsets(path, offsets) {
		var L = path.length;
		if (!L) return 0;
		// cuts closer together than MIN_PIECE would leave tiny scraps
		// (common where strokes overlap), so they count as one cut
		var offs = offsets
			.map(function (o) { return path.closed && o > L - MIN_PIECE ? 0 : o; })
			.filter(function (o) { return path.closed || (o > MIN_PIECE && o < L - MIN_PIECE); })
			.sort(function (a, b) { return a - b; })
			.filter(function (o, i, arr) { return i === 0 || o - arr[i - 1] > MIN_PIECE; });
		if (path.closed && offs.length > 1 && L - offs[offs.length - 1] + offs[0] < MIN_PIECE) offs.pop();
		if (!offs.length) return 0;
		var data = copyData(path), cuts = offs.length;
		if (path.closed) {
			// opening a closed path moves its start to the cut
			var last = offs.pop();
			path.splitAt(last);
			offs = offs.map(function (o) { return o + (L - last); });
		}
		for (var k = offs.length - 1; k >= 0; k--) {
			var tail = path.splitAt(offs[k]);
			if (tail && tail !== path) {
				tail.selected = false;
				tail.data = { style: Object.assign({}, data.style), group: data.group };
				pathStyle(tail);
			}
		}
		return cuts;
	}

	// Cut paths wherever they cross (only pairs where pairOk(a, b), if given).
	function slicePaths(paths, pairOk) {
		var cuts = new Map();
		paths.forEach(function (p) { cuts.set(p, []); });
		for (var i = 0; i < paths.length; i++) {
			for (var j = i; j < paths.length; j++) {
				var a = paths[i], b = paths[j];
				if (pairOk && !pairOk(a, b)) continue;
				var locs = i === j ? a.getIntersections() : a.getIntersections(b);
				locs.forEach(function (loc) {
					cuts.get(a).push(loc.offset);
					if (loc.intersection) cuts.get(b).push(loc.intersection.offset);
				});
			}
		}
		var n = 0;
		cuts.forEach(function (offsets, path) { n += splitAtOffsets(path, offsets); });
		return n;
	}

	function sliceSelection() {
		var paths = selectedPaths();
		if (!paths.length) paths = editablePaths();
		var n = 0;
		edit(function () {
			n = slicePaths(paths);
			deselectAll();
		});
		updatePathStyleRow();
		setStatus(n ? 'Sliced at ' + n + ' crossing' + (n === 1 ? '' : 's') + '. Pick up the pieces with the Select tool.' : 'No crossings to slice');
	}

	// with Auto-slice on, a new stroke cuts (and is cut by) what it crosses
	function autoSlice(path) {
		if (!state.autoSlice || !path || !path.parent) return;
		slicePaths(editablePaths(), function (a, b) { return a === path || b === path; });
	}

	// Cut tool: a click cuts the path there; a drag draws a knife line that
	// cuts every path it crosses (the line itself isn't kept).
	function clickCut(point) {
		var hit = hitGlyph(point);
		if (!hit) return;
		var path = hit.item, loc;
		if (hit.type === 'segment') {
			if (!path.closed && (hit.segment.isFirst() || hit.segment.isLast())) {
				setStatus('That is already an end point');
				return;
			}
			loc = hit.segment.location;
		} else {
			loc = hit.location;
		}
		if (!loc) return;
		edit(function () {
			var data = copyData(path);
			var tail = path.splitAt(loc);
			if (tail && tail !== path) {
				tail.selected = false;
				tail.data = data;
				pathStyle(tail);
			}
			deselectAll();
		});
		setStatus('Cut');
	}

	function knifeCut(a, b) {
		var blade = new P.Path.Line({ from: a, to: b, insert: false });
		var cuts = 0;
		edit(function () {
			editablePaths().forEach(function (path) {
				var offsets = path.getIntersections(blade).map(function (loc) { return loc.offset; });
				if (offsets.length) cuts += splitAtOffsets(path, offsets);
			});
			deselectAll();
		});
		updatePathStyleRow();
		setStatus(cuts ? 'Cut at ' + cuts + ' point' + (cuts === 1 ? '' : 's') : 'The line didn\u2019t cross anything');
	}

	// Shift keeps a line to 45 degree steps
	function constrain(from, to, on) {
		if (!on) return to;
		var v = to.subtract(from);
		v.angle = Math.round(v.angle / 45) * 45;
		return from.add(v);
	}

	function closeEnds(p) {
		var first = p.firstSegment, last = p.lastSegment;
		if (p.segments.length > 2 && first.point.getDistance(last.point) < EPS) {
			first.handleIn = last.handleIn;
			last.remove();
		}
		p.closed = true;
	}

	// Join end point a to end point b. Ends that touch merge into one point,
	// otherwise a straight line connects them. Returns the joined path.
	function joinEnds(a, b) {
		var p1 = a.path, p2 = b.path;
		if (p1 === p2) { if (p1.segments.length > 2) closeEnds(p1); return p1; }
		if (a.isFirst()) p1.reverse();   // a is now p1's last point
		if (b.isLast()) p2.reverse();    // b is now p2's first point
		var segs = p2.segments.map(function (s) { return new P.Segment(s.point.clone(), s.handleIn.clone(), s.handleOut.clone()); });
		var last = p1.lastSegment;
		if (last.point.getDistance(segs[0].point) < EPS) {
			last.handleOut = segs[0].handleOut;
			segs.shift();
		}
		p1.addSegments(segs);
		p2.remove();
		if (p1.segments.length > 2 && p1.firstSegment.point.getDistance(p1.lastSegment.point) < EPS) closeEnds(p1);
		return p1;
	}

	// Joining a stroke onto a closed shape (like the tail of an "a" onto its
	// bowl): if one of the stroke's ends touches the shape, open the shape at
	// that point and join the two into one open stroke, around the shape and
	// on into the stroke. Returns true if it handled the join.
	function joinIntoClosed() {
		var sel = selectedPaths();
		var closedSel = sel.filter(function (p) { return p.closed && p.segments.length > 1; });
		var openSel = sel.filter(function (p) { return !p.closed && p.segments.length > 1; });
		if (!closedSel.length || !openSel.length) return false;
		var hit = null;
		openSel.some(function (op) {
			return [op.firstSegment, op.lastSegment].some(function (end) {
				return closedSel.some(function (cp) {
					var loc = cp.getNearestLocation(end.point);
					if (loc && loc.distance < 0.05) { hit = { end: end, shape: cp, loc: loc }; return true; }
					return false;
				});
			});
		});
		if (!hit) {
			setStatus('To join onto a closed shape, an end of the stroke has to touch it', true);
			return true;
		}
		edit(function () {
			hit.shape.splitAt(hit.loc);   // opens it there: both of its ends are now at the joint
			var joined = joinEnds(hit.shape.lastSegment, hit.end);
			deselectAll();
			selectPath(joined);
		});
		updatePathStyleRow();
		setStatus('Opened the shape where they meet and joined them into one stroke');
		return true;
	}

	function joinSelection() {
		if (joinIntoClosed()) return;
		var anchors = selectedSegments();
		var ends = anchors.filter(isOpenEnd);
		var paths = selectedPaths().filter(function (p) { return !p.closed && p.segments.length > 1; });
		var twoEnds = anchors.length === 2 && ends.length === 2;
		if (!twoEnds && (!paths.length || (paths.length === 1 && paths[0].segments.length < 3))) {
			setStatus('Select open paths, or two end points, to join', true);
			return;
		}
		edit(function () {
			var result;
			if (twoEnds) {
				result = joinEnds(ends[0], ends[1]);
			} else if (paths.length === 1) {
				result = paths[0];
				if (result.segments.length > 2) closeEnds(result);
			} else {
				// join the closest free ends until one path is left
				var list = paths.slice();
				while (list.length > 1) {
					var best = null;
					for (var i = 0; i < list.length; i++) {
						for (var j = i + 1; j < list.length; j++) {
							[list[i].firstSegment, list[i].lastSegment].forEach(function (sa) {
								[list[j].firstSegment, list[j].lastSegment].forEach(function (sb) {
									var d = sa.point.getDistance(sb.point);
									if (!best || d < best.d) best = { d: d, a: sa, b: sb };
								});
							});
						}
					}
					joinEnds(best.a, best.b);
					list = list.filter(function (p) { return p.parent && !p.closed; });
				}
				result = list[0] || paths[0];
			}
			deselectAll();
			if (result && result.parent) selectPath(result);
		});
		updatePathStyleRow();
	}

	// pen

	function penDown(e) {
		var p = snapTarget(e.point, penPath ? [penPath] : null).point;
		var tol = px(7);
		if (!penPath) {
			beginEdit();
			// clicking the end of an open path continues it
			var hit = hitGlyph(e.point, { stroke: false });
			if (hit && hit.type === 'segment' && isOpenEnd(hit.segment)) {
				var path = hit.item, seg = hit.segment;
				if (seg.isFirst()) path.reverse();
				penPath = path;
				deselectAll();
				penPath.lastSegment.selected = true;
				return;
			}
			penPath = new P.Path({ segments: [p], insert: false });
			penPath.data.style = {};
			pathStyle(penPath);
			glyphLayer.addChild(penPath);
			deselectAll();
			penPath.lastSegment.selected = true;
			drag = { mode: 'pen-handle', segment: penPath.lastSegment };
			return;
		}
		// close the path by clicking its first point
		if (penPath.segments.length > 1 && penPath.firstSegment.point.getDistance(e.point) < tol) {
			penPath.closed = true;
			finishPen();
			return;
		}
		// clicking the end of another open path joins onto it
		var target = hitGlyph(e.point, { stroke: false });
		if (target && target.type === 'segment' && target.item !== penPath && isOpenEnd(target.segment)) {
			penPath.add(target.segment.point.clone());
			penPath = joinEnds(penPath.lastSegment, target.segment);
			finishPen();
			return;
		}
		penPath.add(p);
		deselectAll();
		penPath.lastSegment.selected = true;
		drag = { mode: 'pen-handle', segment: penPath.lastSegment };
	}

	function finishPen() {
		if (rubber) { rubber.remove(); rubber = null; }
		if (!penPath) return;
		var path = penPath;
		penPath = null;
		if (path.segments.length < 2) path.remove();
		deselectAll();
		autoSlice(path);
		endEdit();
	}

	// double-click: toggle point smooth/corner, or add a point on a line
	canvas.addEventListener('dblclick', function (e) {
		if (state.tool !== 'select' && state.tool !== 'direct') return;
		var point = P.view.viewToProject(new P.Point(e.offsetX, e.offsetY));
		var hit = hitGlyph(point);
		if (!hit) return;
		if (state.tool === 'select') setTool('direct');
		if (hit.type === 'segment') {
			edit(function () {
				var s = hit.segment;
				if (s.handleIn.isZero() && s.handleOut.isZero()) s.smooth({ type: 'catmull-rom' });
				else { s.handleIn = [0, 0]; s.handleOut = [0, 0]; }
			});
		} else if (hit.location) {
			edit(function () {
				var seg = hit.item.divideAt(hit.location);
				if (seg && seg.point) {
					var snapped = snap(seg.point);
					if (snapped.getDistance(seg.point) < px(8)) seg.point = snapped;
					deselectAll();
					seg.selected = true;
				}
			});
		}
		updatePathStyleRow();
	});

	// zoom + pan
	wrap.addEventListener('wheel', function (e) {
		e.preventDefault();
		var rect = canvas.getBoundingClientRect();
		var mouse = P.view.viewToProject(new P.Point(e.clientX - rect.left, e.clientY - rect.top));
		zoomCanvas(P.view.zoom * Math.pow(1.0015, -e.deltaY), mouse);
	}, { passive: false });

	wrap.addEventListener('mousedown', function (e) {
		// take keyboard focus from whatever button was clicked last, so
		// Enter/Space don't press it again
		wrap.focus({ preventScroll: true });
		extendLayer.visible = false;   // the extended ends come back when the edit is done
		if (e.button === 1 || (e.button === 0 && spaceDown)) {
			e.preventDefault();
			panning = { x: e.clientX, y: e.clientY };
			wrap.classList.add('panning');
		}
	}, true);
	window.addEventListener('mousemove', function (e) {
		if (!panning) return;
		var d = new P.Point(e.clientX - panning.x, e.clientY - panning.y);
		panning = { x: e.clientX, y: e.clientY };
		P.view.center = P.view.center.subtract(d.divide(P.view.zoom));
		drawGuides();
	});
	window.addEventListener('mouseup', function () {
		if (!extendLayer.visible && !play) { extendLayer.visible = true; drawExtensions(); }
		if (panning) { panning = null; wrap.classList.remove('panning'); }
	});

	// ------------------------------------------------------------ keyboard

	function nudge(dx, dy) {
		var segs = movingSegments();
		if (!segs.length) return;
		edit(function () {
			segs.forEach(function (s) { s.point = s.point.add([dx, dy]); });
		});
	}

	// Illustrator-style delete: selected segments go, and so do selected
	// points along with the segments on either side of them. What's left of
	// each path stays as separate pieces.
	function deleteSelection() {
		var paths = selectedPaths();
		if (!paths.length) return;
		edit(function () {
			paths.forEach(function (path) {
				var segs = path.segments, n = segs.length, whole = isWhole(path);
				var pieces = whole ? [] : piecesOf(path, function (i) {
					var a = segs[i], b = segs[(i + 1) % n];
					return !(a.selected || b.selected || selCurves.has(a));
				});
				pieces.forEach(function (np) { pathStyle(np); np.insertBelow(path); });
				path.remove();
			});
			selCurves.clear();
		});
		updatePathStyleRow();
	}

	// Alt+Delete: remove the selected points but keep the path connected.
	function removeAnchors() {
		var paths = selectedPaths();
		if (!paths.length) return;
		edit(function () {
			paths.forEach(function (path) {
				var keep = path.segments.filter(function (s) { return !s.selected; });
				if (keep.length === path.segments.length) return;
				if (keep.length < 2) { path.remove(); return; }
				for (var i = path.segments.length - 1; i >= 0; i--) {
					if (path.segments[i].selected) path.removeSegment(i);
				}
			});
		});
		updatePathStyleRow();
	}

	function copySelection() {
		var pieces = selectedPaths().length ? selectionPieces() : editablePaths().map(clonePath);
		if (!pieces.length) {
			setStatus('Select a segment (or two neighbouring points) to copy', true);
			return false;
		}
		state.clipboard = pieces.map(function (p) {
			return { d: p.getPathData(null, 3), style: Object.assign({}, p.data.style), group: p.data.group };
		});
		setStatus('Copied ' + pieces.length + ' path' + (pieces.length === 1 ? '' : 's'));
		return true;
	}

	// pastes in place, since glyph coordinates line up between glyphs
	function paste() {
		if (!state.clipboard) return;
		edit(function () {
			deselectAll();
			var added = [];
			state.clipboard.forEach(function (c) {
				var item = P.PathItem.create(c.d);
				var parts = item instanceof P.CompoundPath ? item.removeChildren() : [item];
				item.remove();
				parts.forEach(function (p) {
					p.data.style = Object.assign({}, c.style);
					if (c.group) p.data.group = c.group;
					added.push(p);
				});
			});
			regroup(added);
			added.forEach(function (p) {
				pathStyle(p);
				glyphLayer.addChild(p);
				selectPath(p);
			});
		});
		updatePathStyleRow();
	}

	document.addEventListener('keydown', function (e) {
		if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; e.preventDefault(); return; }
		var ctrl = e.ctrlKey || e.metaKey;
		var key = e.key.toLowerCase();

		if (ctrl && key === 's') { e.preventDefault(); save(); return; }
		if (isTyping(e)) return;

		if (ctrl && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
		if (ctrl && key === 'y') { e.preventDefault(); redo(); return; }
		if (ctrl && key === 'a') { e.preventDefault(); selectAll(); return; }
		if (ctrl && (key === 'c' || key === 'x' || key === 'v')) return;   // the copy / cut / paste events below
		if (ctrl && key === 'j') { e.preventDefault(); joinSelection(); return; }
		if (ctrl && key === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
		if (ctrl && key === "'") { e.preventDefault(); toggleShow('grid'); return; }
		if (ctrl && key === ';') { e.preventDefault(); toggleShow('guides'); return; }
		if (ctrl && key === '[') { e.preventDefault(); moveInOrder(-1); return; }
		if (ctrl && key === ']') { e.preventDefault(); moveInOrder(1); return; }
		if (ctrl) return;

		var step = e.shiftKey ? state.grid : 1;
		switch (key) {
			case 'v': setTool('select'); break;
			case 'a': setTool('direct'); break;
			case 'p': setTool('pen'); break;
			case 'e': useShape('ellipse'); break;
			case 'm': useShape('rect'); break;
			case '\\': useShape('line'); break;
			case 'c': setTool(e.shiftKey ? 'anchor' : 'scissors'); break;
			case 'x': sliceSelection(); break;
			case 'r': rotateSelection(e.shiftKey ? -90 : 90); break;
			case 'h': flipSelection(e.shiftKey); break;
			case 'g': if (e.shiftKey) setSnapPath(!state.snapPath); else setSnap(!state.snap); break;
			case 'o': setShowOrder(!state.show.order); break;
			case 'f': fit(); break;
			case 'enter': finishPen(); break;
			case 'escape': if (isSpecimen()) setSpecimen(false); else deselect(); break;
			case 'delete': case 'backspace':
				e.preventDefault();
				if (e.altKey) removeAnchors(); else deleteSelection();
				break;
			case 'arrowleft': e.preventDefault(); nudge(-step, 0); break;
			case 'arrowright': e.preventDefault(); nudge(step, 0); break;
			case 'arrowup': e.preventDefault(); nudge(0, -step); break;
			case 'arrowdown': e.preventDefault(); nudge(0, step); break;
			default: return;
		}
	});
	document.addEventListener('keyup', function (e) {
		if (e.code === 'Space') spaceDown = false;
	});

	function setSnap(on) {
		state.snap = on;
		$('snap').checked = on;
	}

	function setSnapPath(on) {
		state.snapPath = on;
		$('snap-path').checked = on;
	}

	// Where a point placed at `raw` should go: onto another path's point or
	// line when Snap to paths is on and one is close, otherwise the grid (when
	// Snap to grid is on). `exclude` lists paths to ignore. Returns
	// { point, kind } with kind 'point', 'path', 'grid' or null.
	// For a handle, pass its own segment as `handleOf`: the handle won't snap
	// onto its own point (that would flatten it) or its own path's line.
	function snapTarget(raw, exclude, handleOf) {
		if (state.snapPath) {
			var best = null, tol = px(8);
			editablePaths().forEach(function (p) {
				if (exclude && exclude.indexOf(p) >= 0) return;
				p.segments.forEach(function (s) {
					if (s === handleOf) return;
					var d = s.point.getDistance(raw);
					if (d < tol && (!best || d < best.d)) best = { d: d, point: s.point.clone(), kind: 'point' };
				});
			});
			if (best) return best;
			var ctol = px(6);
			editablePaths().forEach(function (p) {
				if (exclude && exclude.indexOf(p) >= 0 || p.segments.length < 2) return;
				if (handleOf && p === handleOf.path) return;
				var loc = p.getNearestLocation(raw);
				if (loc && loc.distance < ctol && (!best || loc.distance < best.d)) best = { d: loc.distance, point: loc.point.clone(), kind: 'path' };
			});
			if (best) return best;
		}
		return { point: snap(raw), kind: state.snap ? 'grid' : null };
	}

	// Where a dragged handle's tip should go (snapped), with the ring updated.
	function snapHandleTip(e, segment) {
		if (drag.marker) { drag.marker.remove(); drag.marker = null; }
		var t = snapTarget(e.point, null, segment);
		drag.marker = snapMarker(t);
		return t.point;
	}

	// a ring showing where a point will snap onto a path
	function snapMarker(target) {
		if (!target || (target.kind !== 'point' && target.kind !== 'path')) return null;
		var m = marker(target.point, overlayLayer, true);
		m.strokeColor = COLORS.bearing;
		return m;
	}


	// ------------------------------------------------------- stroke order
	//
	// For pen plotters. A glyph's paths are drawn in list order (the order of
	// glyphLayer's children), each from its first point to its last; a closed
	// path starts and ends at its first point. Moving between strokes is a
	// pen-up "travel" move.

	var play = null;    // the running Play animation, if any

	function strokePaths() {
		return editablePaths().filter(function (p) { return p.segments.length > 1; });
	}

	function strokeStart(p) { return p.firstSegment.point; }
	function strokeEnd(p) { return p.closed ? p.firstSegment.point : p.lastSegment.point; }

	// Pen-up distance: from the origin to the first stroke, then between strokes.
	function travelOf(paths) {
		var pos = new P.Point(0, 0), total = 0;
		paths.forEach(function (p) {
			total += pos.getDistance(strokeStart(p));
			pos = strokeEnd(p);
		});
		return total;
	}

	function updateStrokeInfo() {
		var paths = strokePaths();
		$('stroke-info').textContent = paths.length
			? paths.length + ' stroke' + (paths.length === 1 ? '' : 's') + ' · pen-up travel ' + round(travelOf(paths), 0.1)
			: 'No strokes yet';
		$('show-order').checked = state.show.order;
	}

	function chevron(point, tangent, color) {
		var t = tangent.normalize(px(5)), n = t.rotate(90).multiply(0.8);
		var c = new P.Path({ segments: [point.subtract(t).add(n), point, point.subtract(t).subtract(n)], insert: false });
		c.strokeColor = color;
		c.strokeWidth = 1.5;
		c.strokeScaling = false;
		orderLayer.addChild(c);
	}

	function drawOrder() {
		orderLayer.removeChildren();
		if (!state.show.order || play || !font()) return;
		var prev = null;
		strokePaths().forEach(function (p, i) {
			var a = strokeStart(p), b = strokeEnd(p);
			if (prev && prev.getDistance(a) > EPS) {
				var t = line(prev, a, COLORS.travel, true, orderLayer);
				t.dashArray = [2, 4];
			}
			// direction: a chevron every ~80 screen pixels
			var len = p.length, count = Math.max(1, Math.round(len / px(80)));
			for (var k = 1; k <= count; k++) {
				var loc = p.getLocationAt(len * k / (count + 1));
				if (loc) chevron(loc.point, loc.tangent, COLORS.orderStart);
			}
			if (!p.closed) {
				var end = new P.Path.Rectangle({ point: b.subtract(px(3.5)), size: [px(7), px(7)], insert: false });
				end.fillColor = COLORS.orderEnd;
				orderLayer.addChild(end);
			}
			var dot = new P.Path.Circle({ center: a, radius: px(7.5), fillColor: COLORS.orderStart, insert: false });
			orderLayer.addChild(dot);
			orderLayer.addChild(new P.PointText({
				point: a.add([0, px(3.5)]), content: String(i + 1), fillColor: '#ffffff', fontSize: px(10),
				fontFamily: "'IBM Plex Mono', monospace", fontWeight: 'bold', justification: 'center', insert: false
			}));
			prev = b;
		});
	}

	function setShowOrder(on) {
		state.show.order = on;
		try { localStorage.setItem('gregfont-editor-show', JSON.stringify(state.show)); } catch (e) { /* ignore */ }
		$('show-order').checked = on;
		drawOrder();
	}

	// --- editing direction and order

	function rotateClosedStart(path, index) {
		if (!index) return;
		var segs = path.segments.map(function (s) {
			return new P.Segment(s.point.clone(), s.handleIn.clone(), s.handleOut.clone());
		});
		path.removeSegments();
		path.addSegments(segs.slice(index).concat(segs.slice(0, index)));
		path.closed = true;
	}

	function reverseSelection() {
		var paths = selectedPaths();
		if (!paths.length) paths = strokePaths().length === 1 ? strokePaths() : [];
		if (!paths.length) { setStatus('Select the strokes to reverse'); return; }
		edit(function () { paths.forEach(function (p) { p.reverse(); }); });
		setStatus('Reversed ' + paths.length + ' stroke' + (paths.length === 1 ? '' : 's'));
	}

	// Make the selected point where its stroke starts.
	function setStartPoint() {
		var segs = selectedSegments();
		if (segs.length !== 1) { setStatus('Select one point (Direct tool) to start the stroke from', true); return; }
		var s = segs[0], path = s.path;
		if (!path.closed && !s.isFirst() && !s.isLast()) {
			setStatus('An open stroke can only start at one of its ends', true);
			return;
		}
		edit(function () {
			if (path.closed) rotateClosedStart(path, s.index);
			else if (s.isLast()) path.reverse();
			deselectAll();
		});
		setStatus('Start point set');
	}

	// Move the selected strokes earlier (-1) or later (+1) in the drawing order.
	function moveInOrder(dir) {
		var all = glyphLayer.children.filter(function (it) { return it instanceof P.Path; });
		var sel = selectedPaths();
		if (!sel.length) { setStatus('Select the strokes to move in the order'); return; }
		edit(function () {
			var list = dir < 0 ? all : all.slice().reverse();
			list.forEach(function (p, i) {
				if (sel.indexOf(p) < 0 || i === 0) return;
				var neighbour = list[i - 1];
				if (sel.indexOf(neighbour) >= 0) return;
				if (dir < 0) p.insertBelow(neighbour); else p.insertAbove(neighbour);
				list[i - 1] = p;
				list[i] = neighbour;
			});
		});
	}

	// The ways a stroke can be drawn: an open stroke either way round; a
	// closed shape starting (and ending) at any of its points. `change`
	// marks options that differ from how it's drawn now.
	function strokeOptions(p) {
		if (p.closed) {
			return p.segments.map(function (s, i) {
				return { start: i, reverse: false, a: s.point, b: s.point, change: i === 0 ? 0 : 1 };
			});
		}
		return [
			{ start: 0, reverse: false, a: p.firstSegment.point, b: p.lastSegment.point, change: 0 },
			{ start: 0, reverse: true, a: p.lastSegment.point, b: p.firstSegment.point, change: 1 }
		];
	}

	// The drawing plan with the least pen-up travel, starting from 0,0.
	// Up to 12 strokes it checks every order, direction and start point
	// (dynamic programming over subsets); ties keep the current setup. More
	// strokes than that fall back to nearest-next.
	function bestPlan(paths) {
		var n = paths.length, origin = new P.Point(0, 0);
		var TIE = 1e-4;   // tiny cost for changing things, so ties keep what's there
		var nodes = [];   // every (stroke, option)
		paths.forEach(function (p, i) {
			strokeOptions(p).forEach(function (o) { o.stroke = i; o.path = p; nodes.push(o); });
		});
		var K = nodes.length;

		if (n > 12) {
			var pos = origin, left = paths.slice(), plan = [];
			while (left.length) {
				var best = null;
				nodes.forEach(function (o) {
					if (left.indexOf(o.path) < 0) return;
					var d = pos.getDistance(o.a) + o.change * TIE;
					if (!best || d < best.d) best = { d: d, o: o };
				});
				plan.push(best.o);
				pos = best.o.b;
				left.splice(left.indexOf(best.o.path), 1);
			}
			return plan;
		}

		var full = (1 << n) - 1;
		var cost = new Float64Array((full + 1) * K).fill(Infinity);
		var prev = new Int32Array((full + 1) * K).fill(-1);
		nodes.forEach(function (o, k) {
			cost[(1 << o.stroke) * K + k] = origin.getDistance(o.a) + o.change * TIE + (o.stroke === 0 ? 0 : TIE / 2);
		});
		for (var mask = 1; mask <= full; mask++) {
			for (var k = 0; k < K; k++) {
				var here = cost[mask * K + k];
				if (here === Infinity) continue;
				var from = nodes[k];
				for (var j = 0; j < K; j++) {
					var to = nodes[j];
					if (mask & (1 << to.stroke)) continue;
					var next = mask | (1 << to.stroke);
					var c = here + from.b.getDistance(to.a) + to.change * TIE +
						(to.stroke === from.stroke + 1 ? 0 : TIE / 2);   // prefer the current order
					if (c < cost[next * K + j]) {
						cost[next * K + j] = c;
						prev[next * K + j] = k;
					}
				}
			}
		}
		var end = -1;
		for (k = 0; k < K; k++) {
			if (end < 0 || cost[full * K + k] < cost[full * K + end]) end = k;
		}
		var planOut = [], m = full;
		while (end >= 0) {
			planOut.unshift(nodes[end]);
			var before = prev[m * K + end];
			m &= ~(1 << nodes[end].stroke);
			end = before;
		}
		return planOut;
	}

	function planTravel(plan) {
		var pos = new P.Point(0, 0), total = 0;
		plan.forEach(function (o) { total += pos.getDistance(o.a); pos = o.b; });
		return total;
	}

	// Reorder, flip and re-start strokes to shorten pen-up travel. Points and
	// curves never move. Only applied if it's actually shorter.
	function optimizeStrokes() {
		var paths = strokePaths();
		if (paths.length === 0) { setStatus('Nothing to optimize'); return; }
		var before = travelOf(paths);
		var plan = bestPlan(paths);
		var after = planTravel(plan);
		if (after >= before - 0.05) {
			setStatus('Already as short as it gets (pen-up travel ' + round(before, 0.1) + ')');
			return;
		}
		edit(function () {
			plan.forEach(function (o) {
				if (o.start) rotateClosedStart(o.path, o.start);
				if (o.reverse) o.path.reverse();
				glyphLayer.addChild(o.path);   // re-adding moves it to the end
			});
			deselectAll();
		});
		setStatus('Pen-up travel ' + round(before, 0.1) + ' → ' + round(after, 0.1));
	}

	// --- Play: draw the glyph stroke by stroke

	function playStrokes() {
		if (play) { stopPlay(); return; }
		finishPen();
		var paths = strokePaths();
		if (!paths.length) { setStatus('Nothing to play: the glyph is empty'); return; }
		var speed = Math.max(font().cell.height, 30) * 1.4;   // font units per second
		var steps = [], pos = null, total = 0;
		paths.forEach(function (p) {
			var a = strokeStart(p);
			if (pos && pos.getDistance(a) > EPS) {
				var tl = pos.getDistance(a);
				steps.push({ from: pos, to: a, dur: tl / (speed * 3) });
				total += tl / (speed * 3);
			}
			steps.push({ path: p, dur: Math.max(p.length / speed, 0.05) });
			total += Math.max(p.length / speed, 0.05);
			pos = strokeEnd(p);
		});
		glyphLayer.visible = false;
		extendLayer.visible = false;
		selLayer.visible = false;
		orderLayer.removeChildren();
		play = { steps: steps, total: total, t0: performance.now(), raf: 0 };
		$('play-strokes').textContent = '■ Stop';
		playFrame();
	}

	function playFrame() {
		if (!play) return;
		var t = (performance.now() - play.t0) / 1000;
		playLayer.removeChildren();
		var pen = null;
		for (var i = 0; i < play.steps.length; i++) {
			var st = play.steps[i], f = Math.min(1, t / st.dur);
			if (t <= 0) break;
			if (st.path) {
				var c = st.path.clone({ insert: false });
				c.selected = false;
				pathStyle(c);
				if (f < 1) {
					if (c.closed) c.splitAt(0);   // open it at its start
					var tail = c.splitAt(c.length * f);
					if (tail && tail !== c) tail.remove();
				}
				playLayer.addChild(c);
				pen = f < 1 ? c.lastSegment.point : strokeEnd(st.path);
			} else {
				var to = st.from.add(st.to.subtract(st.from).multiply(f));
				var tr = line(st.from, to, COLORS.travel, true, playLayer);
				tr.dashArray = [2, 4];
				pen = to;
			}
			t -= st.dur;
		}
		if (pen) {
			var dot = new P.Path.Circle({ center: pen, radius: px(4), fillColor: COLORS.orderStart, insert: false });
			playLayer.addChild(dot);
		}
		if ((performance.now() - play.t0) / 1000 > play.total + 0.8) { stopPlay(); return; }
		play.raf = requestAnimationFrame(playFrame);
	}

	function stopPlay() {
		if (!play) return;
		cancelAnimationFrame(play.raf);
		play = null;
		playLayer.removeChildren();
		glyphLayer.visible = true;
		extendLayer.visible = true;
		selLayer.visible = true;
		$('play-strokes').textContent = '▶ Play';
		drawOrder();
	}

	// View > Show grid / guides / cell. Remembered between visits.
	function toggleShow(what) {
		state.show[what] = !state.show[what];
		try { localStorage.setItem('gregfont-editor-show', JSON.stringify(state.show)); } catch (e) { /* ignore */ }
		drawGuides();
	}

	function loadShow() {
		try {
			var saved = JSON.parse(localStorage.getItem('gregfont-editor-show') || 'null');
			if (saved) Object.keys(state.show).forEach(function (k) {
				// stroke order always starts off
				if (k !== 'order' && typeof saved[k] === 'boolean') state.show[k] = saved[k];
			});
		} catch (e) { /* ignore */ }
	}

	function currentTheme() { return GregUI.currentTheme(); }

	function setTheme(theme) {
		GregUI.setTheme(theme);
		readColors();
		glyphLayer.selectedColor = COLORS.select;
		editablePaths().forEach(pathStyle);
		drawGuides();
	}

	function toggleTheme() {
		setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
	}

	function bindScrub(field) { GregUI.bindScrub(field); }

	function setAutoSlice(on) {
		state.autoSlice = on;
		$('auto-slice').checked = on;
	}

	function selectAll() {
		editablePaths().forEach(selectPath);
		updatePathStyleRow();
	}

	function deselect() {
		if (penPath) finishPen();
		else { deselectAll(); updatePathStyleRow(); }
	}

	function cutSelection() {
		if (copySelection()) { deleteSelection(); return true; }
		return false;
	}

	// --- the system clipboard
	//
	// Copying in the editor also puts the paths on the system clipboard,
	// tagged, so they paste between tabs, and so a paste can tell them from
	// something copied in another app since. SVG on the clipboard (Illustrator
	// with Preferences > Clipboard Handling > Copy as SVG) pastes as paths.

	var CLIP_TAG = 'gregfont-paths:';

	function clipText() { return CLIP_TAG + JSON.stringify(state.clipboard); }

	function pasteText(text) {
		text = text || '';
		if (text.indexOf(CLIP_TAG) === 0) {
			try { state.clipboard = JSON.parse(text.slice(CLIP_TAG.length)); } catch (e) { /* keep ours */ }
			paste();
		} else if (/<svg[\s>]/i.test(text)) {
			pasteSVG(text);
		} else {
			paste();
		}
	}

	// Pasted artwork lands on the baseline at the left of the cell, selected:
	// Illustrator's copy doesn't say where it was on the artboard. 1:1 scale.
	function pasteSVG(text) {
		var r;
		try {
			r = GregFont.pathsFromSVG(P, text);
		} catch (err) {
			console.error(err);
			setStatus('Couldn\u2019t read the SVG on the clipboard: ' + err.message, true);
			return;
		}
		if (!r.entries.length) { setStatus('The clipboard has SVG in it, but no paths', true); return; }
		var f = font(), count = 0;
		var offset = new P.Point(-r.ink.x, -(r.ink.y + r.ink.height));
		finishPen();
		edit(function () {
			deselectAll();
			var added = [];
			r.entries.forEach(function (e) {
				var item = P.PathItem.create(e.d);
				item.translate(offset);
				var parts = item instanceof P.CompoundPath ? item.removeChildren() : [item];
				item.remove();
				parts.forEach(function (p) {
					var style = {};
					['strokeCap', 'strokeJoin', 'miterLimit'].forEach(function (k) {
						if (e[k] !== undefined && e[k] !== f.style[k]) style[k] = e[k];
					});
					p.data.style = style;
					if (e.group) p.data.group = e.group;
					added.push(p);
				});
			});
			regroup(added);
			added.forEach(function (p) {
				pathStyle(p);
				glyphLayer.addChild(p);
				selectPath(p);
			});
			count = added.length;
		});
		updatePathStyleRow();
		setStatus('Pasted ' + count + ' path' + (count === 1 ? '' : 's') + ' from the clipboard, on the baseline at the left of the cell. Drag or nudge into place.' +
			(r.warnings.length ? ' (' + r.warnings.join('; ') + ')' : ''));
	}

	function clipboardBusy(e) {
		return isTyping(e) || (window.GregShapeImport && GregShapeImport.isOpen()) || !font();
	}

	document.addEventListener('copy', function (e) {
		if (clipboardBusy(e) || !copySelection()) return;
		e.clipboardData.setData('text/plain', clipText());
		e.preventDefault();
	});
	document.addEventListener('cut', function (e) {
		if (clipboardBusy(e) || !cutSelection()) return;
		e.clipboardData.setData('text/plain', clipText());
		e.preventDefault();
	});
	document.addEventListener('paste', function (e) {
		if (clipboardBusy(e)) return;
		var dt = e.clipboardData;
		e.preventDefault();
		pasteText(dt ? dt.getData('image/svg+xml') || dt.getData('text/plain') : '');
	});

	// the Edit menu can't get a clipboard event, so it asks the clipboard
	function menuCopy(cut) {
		if (!(cut ? cutSelection() : copySelection())) return;
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(clipText()).catch(function () { /* the editor's own copy still works */ });
	}

	function menuPaste() {
		if (navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then(pasteText, function () { paste(); });
		} else {
			paste();
		}
	}

	// ---------------------------------------------------------------- menus

	function hasSelection() { return selectedPaths().length > 0; }

	// The shortcuts here are only labels; the keydown handler does the work.
	var MENUS = [
		{ title: 'File', items: [
			{ label: 'New font', run: function () { newFont(); } },
			{ label: 'New font from SVG\u2026', run: function () { chooseSVG('new'); } },
			{ label: 'New font from shapes\u2026', run: function () { chooseSVG('shapes'); } },
			'-',
			{ label: 'Export SVG for Illustrator', run: exportSVG },
			{ label: 'Update shapes from SVG\u2026', run: function () { chooseSVG('update'); } },
			'-',
			{ label: 'Save', key: 'Ctrl+S', run: function () { save(); } }
		] },
		{ title: 'Edit', items: [
			{ label: 'Undo', key: 'Ctrl+Z', run: function () { undo(); }, enabled: function () { return state.undo.length > 0 || !!penPath; } },
			{ label: 'Redo', key: 'Ctrl+Shift+Z', run: function () { redo(); }, enabled: function () { return state.redo.length > 0; } },
			'-',
			{ label: 'Cut', key: 'Ctrl+X', run: function () { menuCopy(true); }, enabled: hasSelection },
			{ label: 'Copy', key: 'Ctrl+C', run: function () { menuCopy(false); }, enabled: function () { return editablePaths().length > 0; } },
			{ label: 'Paste', key: 'Ctrl+V', run: menuPaste },
			{ label: 'Delete', key: 'Del', run: deleteSelection, enabled: hasSelection },
			{ label: 'Delete points, keep path joined', key: 'Alt+Del', run: removeAnchors, enabled: function () { return selectedSegments().length > 0; } },
			'-',
			{ label: 'Select all', key: 'Ctrl+A', run: selectAll },
			{ label: 'Deselect', key: 'Esc', run: deselect, enabled: hasSelection }
		] },
		{ title: 'Object', items: [
			{ label: 'Group', key: 'Ctrl+G', run: groupSelection, enabled: function () { return selectedPaths().length > 1; } },
			{ label: 'Ungroup', key: 'Ctrl+Shift+G', run: ungroupSelection, enabled: function () { return selectedPaths().some(function (p) { return p.data.group; }); } },
			'-',
			{ label: 'Join', key: 'Ctrl+J', run: joinSelection, enabled: hasSelection },
			{ label: 'Slice at crossings', key: 'X', run: sliceSelection },
			'-',
			{ label: 'Rotate 90° clockwise', key: 'R', run: function () { rotateSelection(90); }, enabled: hasSelection },
			{ label: 'Rotate 90° counter-clockwise', key: 'Shift+R', run: function () { rotateSelection(-90); }, enabled: hasSelection },
			{ label: 'Flip horizontal', key: 'H', run: function () { flipSelection(false); }, enabled: hasSelection },
			{ label: 'Flip vertical', key: 'Shift+H', run: function () { flipSelection(true); }, enabled: hasSelection },
			'-',
			{ label: 'Align left edge to 0', run: function () { align('left', true); }, enabled: function () { return movingSegments().length > 0; } },
			{ label: 'Align bottom to baseline', run: function () { align('bottom', true); }, enabled: function () { return movingSegments().length > 0; } },
			'-',
			{ label: 'Make points smooth', run: function () { setPointsSmooth(true); }, enabled: function () { return selectedSegments().length > 0; } },
			{ label: 'Make points corners', run: function () { setPointsSmooth(false); }, enabled: function () { return selectedSegments().length > 0; } },
			'-',
			{ label: 'Reverse stroke direction', run: reverseSelection, enabled: function () { return hasSelection() || strokePaths().length === 1; } },
			{ label: 'Set start point', run: setStartPoint, enabled: function () { return selectedSegments().length === 1; } },
			{ label: 'Draw earlier', key: 'Ctrl+[', run: function () { moveInOrder(-1); }, enabled: hasSelection },
			{ label: 'Draw later', key: 'Ctrl+]', run: function () { moveInOrder(1); }, enabled: hasSelection },
			{ label: 'Optimize stroke order', run: optimizeStrokes },
			'-',
			{ label: 'Auto-slice new strokes', run: function () { setAutoSlice(!state.autoSlice); }, checked: function () { return state.autoSlice; } }
		] },
		{ title: 'View', items: [
			{ label: 'Fit glyph', key: 'F', run: fit },
			'-',
			{ label: 'Snap to grid', key: 'G', run: function () { setSnap(!state.snap); }, checked: function () { return state.snap; } },
			{ label: 'Snap to paths', key: 'Shift+G', run: function () { setSnapPath(!state.snapPath); }, checked: function () { return state.snapPath; } },
			'-',
			{ label: 'Show grid', key: "Ctrl+'", run: function () { toggleShow('grid'); }, checked: function () { return state.show.grid; } },
			{ label: 'Show guides', key: 'Ctrl+;', run: function () { toggleShow('guides'); }, checked: function () { return state.show.guides; } },
			{ label: 'Show cell', run: function () { toggleShow('cell'); }, checked: function () { return state.show.cell; } },
			{ label: 'Show stroke order', key: 'O', run: function () { setShowOrder(!state.show.order); }, checked: function () { return state.show.order; } },
			{ label: 'Play strokes', run: playStrokes },
			'-',
			{ label: 'Light mode', run: toggleTheme, checked: function () { return currentTheme() === 'light'; } }
		] },
		{ title: 'Help', items: [
			{ label: 'Show tips', run: function () { setTipsOn(!tips.on); }, checked: function () { return tips.on; } },
			{ label: 'Next tip', run: nextTip, enabled: function () { return tips.on; } }
		] }
	];

	function buildMenus() {
		GregUI.buildMenus($('menubar'), MENUS, wrap);
	}

	// --------------------------------------------------------- glyph grid

	function svgEl(tag, attrs) {
		var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
		return el;
	}

	// <g> with a glyph's paths, styled like the font.
	function glyphGroup(f, ch, strokeWidth, nonScaling, extend) {
		var g = svgEl('g', { transform: 'scale(1 -1)' });   // font units are y-up
		var glyph = f.glyphs[ch];
		if (!glyph) return g;
		glyph.paths.forEach(function (p) {
			var cap = p.strokeCap || f.style.strokeCap;
			var attrs = {
				d: extend ? GregFont.extendEnds(P, f, p.d, strokeWidth, cap) : p.d,
				fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth,
				'stroke-linecap': cap,
				'stroke-linejoin': p.strokeJoin || f.style.strokeJoin,
				'stroke-miterlimit': p.miterLimit || f.style.miterLimit
			};
			if (nonScaling) attrs['vector-effect'] = 'non-scaling-stroke';
			g.appendChild(svgEl('path', attrs));
		});
		return g;
	}

	function glyphChars() {
		var f = font();
		var extra = Object.keys(f.glyphs).concat(state.added).filter(function (ch, i, all) {
			return STANDARD.indexOf(ch) < 0 && all.indexOf(ch) === i;
		});
		return STANDARD.concat(extra);
	}

	function renderGrid() {
		var grid = $('glyph-grid');
		grid.innerHTML = '';
		glyphChars().forEach(function (ch) {
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'glyph-cell';
			btn.dataset.ch = ch;
			btn.title = glyphLabel(ch);
			btn.addEventListener('click', function () { selectGlyph(ch); });
			grid.appendChild(btn);
			updateThumb(ch);
		});
	}

	function updateThumb(ch) {
		var f = font();
		var btn = Array.prototype.find.call($('glyph-grid').children, function (b) { return b.dataset.ch === ch; });
		if (!btn) { renderGrid(); return; }
		btn.innerHTML = '';
		var glyph = f.glyphs[ch];
		btn.classList.toggle('missing', !glyph);
		btn.classList.toggle('current', ch === state.ch);
		var lbl = document.createElement('span');
		lbl.className = 'label';
		lbl.textContent = glyph ? ch : ch + ' +';
		if (glyph) btn.appendChild(glyphSvg(f, ch, 1.5));
		btn.appendChild(lbl);
	}

	// A small <svg> of a glyph, framed by its cell and guides.
	function glyphSvg(f, ch, strokeWidth) {
		var ink = GregFont.inkBounds(P, f, ch);
		var left = Math.min(0, ink ? ink.left : 0), right = Math.max(f.cell.width, ink ? ink.right : 0);
		var top = Math.min(-f.guides.cap, -f.cell.height, ink ? ink.top : 0);
		var bottom = Math.max(-(f.guides.descender || 0), 0, ink ? ink.bottom : 0);
		var pad = (bottom - top) * 0.05;
		var svg = svgEl('svg', { viewBox: [left - pad, top - pad, right - left + pad * 2, bottom - top + pad * 2].join(' '), 'aria-hidden': 'true' });
		svg.appendChild(glyphGroup(f, ch, strokeWidth, true));
		return svg;
	}

	function selectGlyph(ch) {
		finishPen();
		var prev = state.ch;
		state.ch = ch;
		updateThumb(prev);
		updateThumb(ch);
		loadGlyph();
		fit();
		renderPreview();
		var btn = document.querySelector('.glyph-cell.current');
		if (btn) btn.scrollIntoView({ block: 'nearest' });
	}

	// ---------------------------------------------------------- inspector

	function updateGlyphPanel() {
		var f = font(), ch = state.ch, glyph = f.glyphs[ch];
		$('glyph-title').textContent = ch;
		var code = Array.from(ch).length === 1
			? 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ' \u00b7 '
			: '';
		$('glyph-layer-name').textContent = code + 'char-' + GregFont.charToName(ch);
		var n = glyph ? glyph.paths.length : 0;
		$('glyph-info').textContent = glyph ? n + ' path' + (n === 1 ? '' : 's') : 'Empty: draw on the canvas';
		var big = $('glyph-big');
		big.innerHTML = '';
		if (glyph) big.appendChild(glyphSvg(f, ch, 2));
		$('glyph-lsb').value = glyph ? glyph.lsb : '';
		$('glyph-rsb').value = glyph ? glyph.rsb : '';
		$('glyph-lsb').disabled = $('glyph-rsb').disabled = !glyph;
		updateFontMeta();
		updateStrokeInfo();
		updatePathStyleRow();
	}

	function updatePathStyleRow() {
		var paths = selectedPaths();
		$('path-style-row').classList.toggle('disabled', !paths.length);
		var first = paths[0] && paths[0].data.style || {};
		[['path-cap', first.strokeCap], ['path-join', first.strokeJoin]].forEach(function (pair) {
			$(pair[0]).querySelectorAll('button').forEach(function (b) {
				b.disabled = !paths.length;
				b.classList.toggle('active', b.dataset.value === (pair[1] || ''));
			});
		});
		updatePositionPanel();
		drawSelection();
	}

	// --- Position panel: where the selection is, in font units (y up)

	// The selection's geometry: one point, or a box. Whole paths are measured
	// by their full curve extent; loose points by the box around them.
	function selectionGeometry() {
		var segs = movingSegments();
		if (!segs.length) return null;
		if (segs.length === 1) return { single: true, point: segs[0].point.clone(), count: 1 };
		var moving = new Set(segs), paths = selectedPaths();
		var whole = paths.length && paths.every(function (p) {
			return p.segments.every(function (s) { return moving.has(s); });
		});
		var b = null;
		if (whole) paths.forEach(function (p) { b = b ? b.unite(p.bounds) : p.bounds.clone(); });
		else b = pointBounds(segs);
		return { single: false, box: b, whole: whole, paths: paths.length, count: segs.length };
	}

	function updatePositionPanel() {
		var g = selectionGeometry();
		var fields = { x: $('pos-x'), y: $('pos-y'), w: $('pos-w'), h: $('pos-h') };
		Object.keys(fields).forEach(function (k) { fields[k].disabled = !g; });
		$('pos-size').hidden = !!(g && g.single);
		var kind = !g ? 'nothing selected'
			: g.single ? 'point'
			: g.whole ? g.paths + ' path' + (g.paths === 1 ? '' : 's') + ' \u00b7 bottom left'
			: g.count + ' points \u00b7 bottom left';
		$('position-kind').textContent = kind;
		var vals = !g ? { x: '', y: '', w: '', h: '' }
			: g.single ? { x: round(g.point.x, 0.01), y: round(-g.point.y, 0.01), w: '', h: '' }
			: { x: round(g.box.left, 0.01), y: round(-g.box.bottom, 0.01), w: round(g.box.width, 0.01), h: round(g.box.height, 0.01) };
		Object.keys(fields).forEach(function (k) {
			var input = fields[k];
			// don't fight the field being typed in or dragged
			if (document.activeElement === input || input.closest('.scrubbing')) return;
			input.value = vals[k];
		});
	}

	// --- align
	//
	// To each other (Selection) or to the cell: left 0, right the cell width,
	// bottom the baseline, top the cell height. Whole paths move as units (a
	// group moves together); with points picked, each point is a unit.
	// Aligning to the cell moves the whole selection as one block.

	var alignTo = 'selection';
	try { alignTo = localStorage.getItem('gregfont-editor-align-to') === 'cell' ? 'cell' : 'selection'; } catch (e) { /* ignore */ }

	function alignUnits() {
		var g = selectionGeometry();
		if (!g) return null;
		if (g.single || !g.whole) {
			return movingSegments().map(function (s) {
				return { box: new P.Rectangle(s.point, s.point), move: function (d) { s.point = s.point.add(d); } };
			});
		}
		var byGroup = {}, units = [];
		selectedPaths().forEach(function (p) {
			var key = p.data.group ? 'g' + p.data.group : null;
			var u = key && byGroup[key];
			if (!u) {
				u = { paths: [], box: null, move: null };
				u.move = function (d) { u.paths.forEach(function (q) { q.translate(d); }); };
				if (key) byGroup[key] = u;
				units.push(u);
			}
			u.paths.push(p);
			u.box = u.box ? u.box.unite(p.bounds) : p.bounds.clone();
		});
		return units;
	}

	function edgeDelta(edge, box, frame) {
		switch (edge) {
			case 'left': return new P.Point(frame.left - box.left, 0);
			case 'center': return new P.Point(frame.center.x - box.center.x, 0);
			case 'right': return new P.Point(frame.right - box.right, 0);
			case 'top': return new P.Point(0, frame.top - box.top);
			case 'middle': return new P.Point(0, frame.center.y - box.center.y);
			default: return new P.Point(0, frame.bottom - box.bottom);
		}
	}

	function align(edge, toCell) {
		var units = alignUnits();
		if (!units || !units.length) { setStatus('Select something to align'); return; }
		var all = units.reduce(function (b, u) { return b ? b.unite(u.box) : u.box.clone(); }, null);
		var cell = toCell || alignTo === 'cell' || units.length < 2;
		var f = font();
		var frame = cell ? new P.Rectangle(new P.Point(0, -f.cell.height), new P.Point(f.cell.width, 0)) : all;
		edit(function () {
			if (cell) {
				var d = edgeDelta(edge, all, frame);
				units.forEach(function (u) { u.move(d); });
			} else {
				units.forEach(function (u) { u.move(edgeDelta(edge, u.box, frame)); });
			}
		});
		var names = { left: 'left edges', center: 'centres', right: 'right edges', top: 'tops', middle: 'middles', bottom: 'bottoms' };
		var toCellText = { left: 'Left edge moved to 0', center: 'Centred across the cell', right: 'Right edge moved to the cell width',
			top: 'Top moved to the cell height', middle: 'Centred up and down in the cell', bottom: 'Bottom moved to the baseline' };
		setStatus(cell ? toCellText[edge] : 'Lined up ' + units.length + ' ' + (units[0].paths ? 'paths' : 'points') + ' by their ' + names[edge]);
	}

	function setAlignTo(v) {
		alignTo = v;
		try { localStorage.setItem('gregfont-editor-align-to', v); } catch (e) { /* ignore */ }
		$('align-to').querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.value === v); });
	}

	// Move (x, y) or scale around the center (w, h) to the given value.
	function capturePosition() {
		var g = selectionGeometry();
		return g ? { g: g, origs: movingSegments().map(origOf) } : null;
	}

	function applyPosition(key, value, base) {
		if (!base || isNaN(value)) return;
		var g = base.g, m = new P.Matrix();
		// a point, or the selection's bottom-left corner
		var cx = g.single ? g.point.x : g.box.left;
		var cy = g.single ? g.point.y : g.box.bottom;   // canvas y (down)
		if (key === 'x') m.translate(value - cx, 0);
		else if (key === 'y') m.translate(0, -value - cy);
		else if (g.single) return;
		else if (key === 'w') {
			if (g.box.width < EPS || value <= 0) { setStatus('Can’t scale something with no width', true); return; }
			m.scale(value / g.box.width, 1, g.box.bottomLeft);
		} else if (key === 'h') {
			if (g.box.height < EPS || value <= 0) { setStatus('Can’t scale something with no height', true); return; }
			m.scale(1, value / g.box.height, g.box.bottomLeft);
		}
		applyMatrix(base.origs, m);
		commit();
	}

	function bindPositionFields() {
		var drag = null;
		['x', 'y', 'w', 'h'].forEach(function (key) {
			var input = $('pos-' + key);
			input.addEventListener('scrubstart', function () { beginEdit(); fieldEdit = true; drag = capturePosition(); });
			input.addEventListener('scrub', function () { applyPosition(key, parseFloat(input.value), drag); });
			input.addEventListener('change', function () {
				var v = parseFloat(input.value);
				if (drag) {
					applyPosition(key, v, drag);
					drag = null;
					fieldEdit = false;
					endEdit();
				} else {
					edit(function () { applyPosition(key, v, capturePosition()); });
				}
				updatePositionPanel();
			});
		});
	}

	function updateFontMeta() {
		var n = Object.keys(font().glyphs).length;
		$('font-meta').textContent = (state.entry.file || 'not saved yet') + ' \u00b7 ' + n + ' glyph' + (n === 1 ? '' : 's');
	}

	function setPathStyle(key, value) {
		var paths = selectedPaths();
		if (!paths.length) return;
		edit(function () {
			paths.forEach(function (p) {
				p.data.style = Object.assign({}, p.data.style);
				if (value) p.data.style[key] = value; else delete p.data.style[key];
				pathStyle(p);
			});
		});
	}

	function setBearing(key, value) {
		var glyph = font().glyphs[state.ch];
		if (!glyph || isNaN(value)) return;
		edit(function () { glyph[key] = value; });
	}

	function updateFontPanel() {
		var f = font();
		$('font-name').value = f.name;
		$('font-status').value = GregFont.statusOf(f);
		$('font-revision').textContent = f.revision ? 'rev ' + f.revision + (f.modified ? ' \u00b7 ' + f.modified : '') : 'not saved yet';
		updateFontMeta();
		$('cell-width').value = f.cell.width;
		$('cell-height').value = f.cell.height;
		['cap', 'xHeight', 'descender'].forEach(function (k) {
			$('guide-' + k).value = f.guides[k] === null ? '' : f.guides[k];
		});
		$('style-strokeCap').value = f.style.strokeCap;
		$('style-strokeJoin').value = f.style.strokeJoin;
		$('spacing-monospaced').checked = f.spacing.monospaced;
		$('spacing-letterSpacing').value = f.spacing.letterSpacing;
		$('spacing-lineHeight').value = f.spacing.lineHeight;
		renderKerning();
	}

	// Font-wide settings. Not part of undo.
	function fontChanged(redrawGlyphs) {
		var f = font();
		markDirty();
		if (redrawGlyphs) {
			GregFont.clearCache(f);
			editablePaths().forEach(pathStyle);
			renderGrid();
		}
		drawGuides();
		renderPreview();
	}

	function bindFontInputs() {
		$('font-name').addEventListener('change', function () {
			font().name = this.value.trim() || 'Untitled';
			refreshFontSelect();
			markDirty();
		});
		$('font-status').addEventListener('change', function () {
			font().status = this.value;
			refreshFontSelect();
			markDirty();
		});
		[['cell-width', 'width'], ['cell-height', 'height']].forEach(function (pair) {
			$(pair[0]).addEventListener('change', function () {
				var v = parseFloat(this.value);
				if (v > 0) { font().cell[pair[1]] = v; fontChanged(true); }
			});
			// while dragging, just redraw the cell; thumbnails catch up on release
			$(pair[0]).addEventListener('scrub', function () {
				var v = parseFloat(this.value);
				if (v > 0) { font().cell[pair[1]] = v; drawGuides(); }
			});
		});
		['cap', 'xHeight', 'descender'].forEach(function (k) {
			$('guide-' + k).addEventListener('change', function () {
				var v = parseFloat(this.value);
				font().guides[k] = isNaN(v) ? null : v;
				fontChanged(true);
			});
			// while dragging, only move the line; the thumbnails catch up on release
			$('guide-' + k).addEventListener('scrub', function () {
				var v = parseFloat(this.value);
				if (!isNaN(v)) { font().guides[k] = v; drawGuides(); }
			});
		});
		['strokeCap', 'strokeJoin'].forEach(function (k) {
			$('style-' + k).addEventListener('change', function () {
				font().style[k] = this.value;
				fontChanged(true);
			});
		});
		$('spacing-monospaced').addEventListener('change', function () {
			font().spacing.monospaced = this.checked;
			fontChanged(false);
			renderPreview();
		});
		['letterSpacing', 'lineHeight'].forEach(function (k) {
			function set() {
				var v = parseFloat(this.value);
				if (!isNaN(v)) { font().spacing[k] = v; fontChanged(false); }
			}
			$('spacing-' + k).addEventListener('change', set);
			$('spacing-' + k).addEventListener('scrub', set);
		});
	}

	// kerning

	// The pairs that include the current glyph.
	function renderKerning() {
		var f = font(), list = $('kerning-list'), ch = state.ch;
		$('kern-title').textContent = 'Kerning with ' + ch;
		$('kern-pair').placeholder = Array.from(ch).length === 1 ? ch + (ch === 'o' ? 'n' : 'o') : 'AV';
		list.innerHTML = '';
		Object.keys(f.kerning).filter(function (pair) {
			return Array.from(pair).indexOf(ch) >= 0;
		}).sort().forEach(function (pair) {
			var row = document.createElement('div');
			row.className = 'kern-row';
			var name = document.createElement('span');
			name.className = 'pair';
			name.textContent = pair;
			var field = document.createElement('label');
			field.className = 'field';
			field.dataset.scrub = 'x';
			field.title = 'Drag sideways or type';
			var input = document.createElement('input');
			input.type = 'number';
			input.step = '0.5';
			input.value = f.kerning[pair];
			input.setAttribute('aria-label', 'Kerning for ' + pair);
			field.appendChild(input);
			bindScrub(field);
			function set() {
				var v = parseFloat(input.value);
				if (!isNaN(v)) { f.kerning[pair] = v; markDirty(); renderPreview(); }
			}
			input.addEventListener('change', set);
			input.addEventListener('scrub', set);
			var del = document.createElement('button');
			del.type = 'button';
			del.textContent = '×';
			del.title = 'Remove';
			del.addEventListener('click', function () {
				delete f.kerning[pair];
				markDirty();
				renderKerning();
				renderPreview();
			});
			row.appendChild(name);
			row.appendChild(field);
			row.appendChild(del);
			list.appendChild(row);
		});
	}

	// ------------------------------------------------------------ preview

	// --- preview strip / specimen view

	function previewText() {
		var id = $('preview-sample').value;
		var sample = (window.GREGFONT_SAMPLES || []).find(function (s) { return s.id === id; });
		return sample ? sample.text : $('preview-text').value;
	}

	// The specimen slides up over the canvas like a sheet, and back down.
	var slide = null;

	function setSpecimen(on) {
		var bar = $('preview-bar'), body = document.body;
		if (slide) { slide.cancel(); slide = null; }
		body.classList.remove('sliding');
		$('preview-expand').setAttribute('aria-label', on ? 'Close the specimen view' : 'Expand the preview into a specimen view');
		$('preview-expand').title = on ? 'Back to the glyph (Esc)' : 'Expand into a specimen view (Esc closes it)';
		if (on && !isSpecimen()) resetSpecimenView();
		var still = !bar.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (on === isSpecimen() || still) {
			body.classList.toggle('specimen', on);
			renderPreview();
			return;
		}
		var easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
		body.classList.add('sliding');
		if (on) {
			var before = bar.getBoundingClientRect().top;
			bar.closedHeight = bar.getBoundingClientRect().height;
			body.classList.add('specimen');
			renderPreview();
			var rise = before - bar.getBoundingClientRect().top;
			var up = slide = bar.animate([{ transform: 'translateY(' + rise + 'px)' }, { transform: 'none' }], { duration: 320, easing: easing });
			up.onfinish = function () {
				if (slide !== up) return;   // replaced by a newer slide
				slide = null;
				body.classList.remove('sliding');
			};
		} else {
			// slide down until just the bar's normal height is showing, then swap back
			var drop = bar.getBoundingClientRect().height - (bar.closedHeight || 150);
			var down = slide = bar.animate([{ transform: 'none' }, { transform: 'translateY(' + drop + 'px)' }], { duration: 260, easing: easing, fill: 'forwards' });
			down.onfinish = function () {
				if (slide !== down) return;
				down.cancel();
				slide = null;
				body.classList.remove('sliding', 'specimen');
				renderPreview();
			};
		}
	}

	function isSpecimen() { return document.body.classList.contains('specimen'); }

	// The preview's own stroke weight (font units, remembered), and the
	// specimen's camera: zoom (screen pixels per font unit), pan (pixels),
	// and the width the text wraps at (font units), set when it opens.
	var previewView = { stroke: 2, extend: false, zoom: 1, panX: 0, panY: 0, wrap: null, w: 0, h: 0 };
	try {
		var savedView = JSON.parse(localStorage.getItem('gregfont-editor-preview') || 'null');
		if (savedView && savedView.stroke > 0) previewView.stroke = savedView.stroke;
		if (savedView) previewView.extend = !!savedView.extend;
	} catch (e) { /* ignore */ }

	// Space around the preview text, in font units. Fixed, so a thicker
	// stroke grows in place instead of moving the text.
	function previewMargin(f) { return Math.max(f.cell.height * 0.08, 2); }

	function savePreviewView() {
		try { localStorage.setItem('gregfont-editor-preview', JSON.stringify({ stroke: previewView.stroke, extend: previewView.extend })); } catch (e) { /* ignore */ }
	}

	var SPEC_PAD_X = 22, SPEC_PAD_Y = 18;   // screen pixels around the text

	// Opening the specimen: wrap the text to the view's width at 100%.
	function resetSpecimenView() {
		previewView.wrap = null;
		previewView.zoom = 1;
		previewView.panX = SPEC_PAD_X;
		previewView.panY = SPEC_PAD_Y;
	}

	function applySpecimenView() {
		var g = $('preview').querySelector('g.spec-view');
		if (g) g.setAttribute('transform', 'matrix(' + previewView.zoom + ' 0 0 ' + previewView.zoom + ' ' + previewView.panX + ' ' + previewView.panY + ')');
		$('specimen-zoom-reset').textContent = Math.round(previewView.zoom * 100) + '%';
	}

	// zoom around a point in the preview box (screen pixels), or its centre
	function zoomSpecimen(z, sx, sy) {
		var box = $('preview');
		if (sx === undefined) { sx = box.clientWidth / 2; sy = box.clientHeight / 2; }
		z = Math.min(Math.max(z, 0.05), 40);
		previewView.panX = sx - (sx - previewView.panX) * z / previewView.zoom;
		previewView.panY = sy - (sy - previewView.panY) * z / previewView.zoom;
		previewView.zoom = z;
		applySpecimenView();
	}

	function fitSpecimen() {
		var box = $('preview'), v = previewView;
		if (!v.w || !v.h) return;
		var bw = Math.max(box.clientWidth - SPEC_PAD_X * 2, 50), bh = Math.max(box.clientHeight - SPEC_PAD_Y * 2, 50);
		v.zoom = Math.min(bw / v.w, bh / v.h);
		v.panX = (box.clientWidth - v.w * v.zoom) / 2;
		v.panY = Math.max((box.clientHeight - v.h * v.zoom) / 2, SPEC_PAD_Y);
		applySpecimenView();
	}

	// The expanded specimen: laid out once (wrapped to the view's width when
	// it opened), then zoomed and panned like the canvas.
	function renderSpecimen(f, box, mono) {
		var v = previewView, pad = previewMargin(f);
		if (!v.wrap) v.wrap = Math.max(box.clientWidth - SPEC_PAD_X * 2, 100) / v.zoom - pad * 2;
		var result = GregFont.layoutBlock(P, f, previewText(), {
			monospace: mono, letterSpacing: f.spacing.letterSpacing, lineHeight: f.spacing.lineHeight,
			width: v.wrap
		});
		v.w = Math.max(result.inkWidth, 1) + pad * 2;   // the text, not the wrap width
		v.h = result.height + pad * 2;
		var svg = svgEl('svg');
		var g = svgEl('g', { class: 'spec-view' });
		var inner = svgEl('g', { transform: 'translate(' + pad + ' ' + pad + ')' });
		result.glyphs.forEach(function (placed) { inner.appendChild(previewGlyph(f, placed)); });
		g.appendChild(inner);
		svg.appendChild(g);
		box.appendChild(svg);
		applySpecimenView();
		box.title = 'Wheel zooms, drag to move around. Click a letter to edit it; Shift-click two letters to set up a kerning pair.';
	}

	// One clickable glyph for the preview or specimen.
	function previewGlyph(f, placed) {
		var top = -Math.max(f.guides.cap, f.cell.height) - previewMargin(f);
		var bottom = Math.max(-(f.guides.descender || 0), 0) + previewMargin(f);
		var g = svgEl('g', { transform: 'translate(' + placed.x + ' ' + placed.y + ')' });
		g.appendChild(glyphGroup(f, placed.char, previewView.stroke, false, previewView.extend));
		g.dataset.ch = placed.char;
		if (placed.char === state.ch) g.classList.add('current');
		if (state.kernPick === placed.char) g.classList.add('kern-pick');
		// a transparent box makes the whole letter clickable
		var ink = GregFont.inkBounds(P, f, placed.char);
		var bx = ink ? ink.left : 0, bw = ink ? ink.width : f.cell.width;
		g.insertBefore(svgEl('rect', { x: bx, y: top, width: Math.max(bw, 4), height: bottom - top, fill: 'transparent' }), g.firstChild);
		g.addEventListener('click', function (e) {
			if (e.shiftKey || e.altKey) { pickKernLetter(placed.char); return; }
			if (isSpecimen()) setSpecimen(false);
			selectGlyph(placed.char);
		});
		return g;
	}

	function renderPreview() {
		var f = font(), box = $('preview');
		box.innerHTML = '';
		if (!f) return;
		var mono = !!f.spacing.monospaced;
		if (isSpecimen()) { renderSpecimen(f, box, mono); return; }
		// one line, at the strip's height; anything past the right edge is cut off
		var text = previewText().replace(/\s*\n\s*/g, ' ').slice(0, 240);
		var result = GregFont.layout(P, f, text, {
			monospace: mono,
			letterSpacing: f.spacing.letterSpacing,
			lineHeight: f.spacing.lineHeight,
			tracking: 0,
			margin: 0
		});
		// heights around each glyph's baseline, in screen orientation
		var top = -Math.max(f.guides.cap, f.cell.height) - previewMargin(f);
		var bottom = Math.max(-(f.guides.descender || 0), 0) + previewMargin(f);
		var baseline = result.glyphs.length ? result.glyphs[0].y : f.cell.height;
		var right = 0, left = 0;
		var svg = svgEl('svg');
		result.glyphs.forEach(function (placed) {
			svg.appendChild(previewGlyph(f, placed));
			var ink = GregFont.inkBounds(P, f, placed.char);
			right = Math.max(right, placed.x + (ink ? ink.right : f.cell.width));
			left = Math.min(left, placed.x + (ink ? ink.left : 0));
		});
		var pad = previewMargin(f);
		var vbW = Math.max(right - left + pad * 2, 1), vbH = bottom - top;
		var h = Math.max(box.clientHeight - 12, 10);   // the strip's inner height
		svg.setAttribute('viewBox', [left - pad, baseline + top, vbW, vbH].join(' '));
		svg.setAttribute('height', h);
		svg.setAttribute('width', vbW * h / vbH);
		box.appendChild(svg);
		box.title = 'Click a letter to edit it. Shift-click two letters to set up a kerning pair.';
	}

	function pickKernLetter(ch) {
		if (!state.kernPick) {
			state.kernPick = ch;
			setStatus('Kerning: Shift-click the second letter');
		} else {
			$('kern-pair').value = state.kernPick + ch;
			$('kern-value').value = font().kerning[state.kernPick + ch] || '';
			$('kern-value').focus();
			state.kernPick = null;
			setStatus('');
		}
		renderPreview();
	}

	// ---------------------------------------------------- fonts: load/save

	function markDirty() {
		if (!state.entry.dirty) {
			state.entry.dirty = true;
			refreshFontSelect();
		}
	}

	function refreshFontSelect() {
		var select = $('font-select');
		select.innerHTML = '';
		// grouped Final, Proof, Draft, then ways to start a font
		GregFont.groupByStatus(state.entries, function (e) { return e.font; }).forEach(function (group) {
			var og = document.createElement('optgroup');
			og.label = group.label;
			group.items.forEach(function (entry) {
				var opt = document.createElement('option');
				opt.value = state.entries.indexOf(entry);
				opt.textContent = entry.font.name + (entry.dirty ? ' *' : '');   // the group heading says the status
				og.appendChild(opt);
			});
			select.appendChild(og);
		});
		var start = document.createElement('optgroup');
		start.label = 'New';
		[['new', '+ New font'], ['new-svg', '+ New font from SVG…'], ['new-shapes', '+ New font from shapes…']].forEach(function (pair) {
			var opt = document.createElement('option');
			opt.value = pair[0];
			opt.textContent = pair[1];
			start.appendChild(opt);
		});
		select.appendChild(start);
		select.value = state.entries.indexOf(state.entry);
		document.title = (state.entry && state.entry.dirty ? '* ' : '') + 'gregfont editor';
	}

	function openEntry(entry) {
		finishPen();
		state.entry = entry;
		state.undo = [];
		state.redo = [];
		state.kernPick = null;
		state.added = [];
		var f = entry.font;
		if (!f.glyphs[state.ch]) {
			state.ch = ['a', 'A'].concat(Object.keys(f.glyphs)).find(function (ch) { return f.glyphs[ch]; }) || 'a';
		}
		try { localStorage.setItem('gregfont-editor-font', entry.file || ''); } catch (e) { /* ignore */ }
		refreshFontSelect();
		updateFontPanel();
		renderGrid();
		loadGlyph();
		fit();
		renderPreview();
	}

	function addEntry(f, file) {
		var entry = { file: file, font: f, dirty: !file };
		state.entries.push(entry);
		return entry;
	}

	function newFont() {
		var f = GregFont.normalize({
			format: GregFont.FORMAT,
			version: GregFont.VERSION,
			name: 'Untitled',
			status: 'draft',
			cell: { width: 40, height: 60 },
			guides: { cap: 60, xHeight: 30, descender: -20 },
			style: { strokeCap: 'round', strokeJoin: 'round', miterLimit: 10 },
			spacing: { monospaced: false, letterSpacing: 45, lineHeight: 90 },
			kerning: {},
			glyphs: {}
		});
		state.ch = 'a';
		openEntry(addEntry(f, null));
		setStatus('New font: name it, draw some glyphs, then Save.');
		// straight to naming it
		$('font-settings').open = true;
		$('font-name').focus();
		$('font-name').select();
	}

	// what the hidden file input is choosing a file for: 'new' or 'update'
	var importMode = 'new';

	function chooseSVG(mode) {
		importMode = mode;
		$('import-file').click();
	}

	// New font from shapes: an SVG that isn't sorted into char- layers. Each
	// group is a tile; you say which glyph each one is (js/shapeimport.js).
	function importShapes(file, text) {
		try {
			GregShapeImport.open({
				paper: P, svgText: text, fileName: file.name,
				onCreate: function (f) {
					state.ch = ['a', 'A'].concat(Object.keys(f.glyphs)).find(function (ch) { return f.glyphs[ch]; }) || 'a';
					openEntry(addEntry(f, null));
					setStatus('Made ' + f.name + ' with ' + Object.keys(f.glyphs).length + ' glyphs. Check the guides and spacing, then Save.');
				},
				onClose: function () { wrap.focus({ preventScroll: true }); }
			});
		} catch (err) {
			console.error(err);
			setStatus('Import failed: ' + err.message, true);
		}
	}

	function importSVG(file) {
		if (importMode === 'update') { updateFromSVG(file); return; }
		var reader = new FileReader();
		reader.onload = function () {
			if (importMode === 'shapes') { importShapes(file, reader.result); return; }
			try {
				var base = file.name.replace(/\.svg$/i, '').replace(/_all_\d+x\d+$/i, '').replace(/_grid$/i, '');
				var name = base.charAt(0).toUpperCase() + base.slice(1);
				var result = GregFont.fromSVG(P, reader.result, { name: name });
				var count = Object.keys(result.font.glyphs).length;
				if (!count) {
					// not sorted into char- layers: name the shapes by hand
					importShapes(file, reader.result);
					return;
				}
				openEntry(addEntry(result.font, null));
				setStatus('Imported ' + count + ' glyphs from ' + file.name +
					(result.warnings.length ? ' (' + result.warnings.length + ' warnings, see console)' : '') +
					'. Check spacing, then Save.');
			} catch (err) {
				console.error(err);
				setStatus('Import failed: ' + err.message, true);
			}
		};
		reader.readAsText(file);
	}

	// Replace the current font's shapes with the ones in an SVG (from
	// Illustrator), keeping spacing, kerning and settings. Glyphs that aren't
	// in the SVG are left alone; new ones are added with default spacing.
	function updateFromSVG(file) {
		var reader = new FileReader();
		reader.onload = function () {
			var result;
			try {
				result = GregFont.fromSVG(P, reader.result, {});
			} catch (err) {
				console.error(err);
				setStatus('Import failed: ' + err.message, true);
				return;
			}
			var src = result.font, f = font();
			var chars = Object.keys(src.glyphs);
			if (!chars.length) {
				setStatus('No char-<name> layers found in ' + file.name, true);
				return;
			}
			finishPen();
			var batch = [], changed = 0, added = 0;
			chars.forEach(function (ch) {
				// styles are stored relative to the font's, so re-base them on this font
				var paths = src.glyphs[ch].paths.map(function (e) {
					var out = { d: e.d };
					['strokeCap', 'strokeJoin', 'miterLimit'].forEach(function (k) {
						var v = e[k] !== undefined ? e[k] : src.style[k];
						if (v !== f.style[k]) out[k] = v;
					});
					if (e.group) out.group = e.group;
					return out;
				});
				var g = f.glyphs[ch];
				if (g && samePaths(g.paths, paths)) return;
				batch.push({ ch: ch, before: snapshot(ch) });
				if (g) { g.paths = paths; changed++; }
				else { f.glyphs[ch] = { lsb: defaultBearing(), rsb: defaultBearing(), paths: paths }; added++; }
				GregFont.clearCache(f, ch);
			});
			if (!batch.length) {
				setStatus('No changes: the shapes in ' + file.name + ' match this font');
				return;
			}
			state.undo.push({ batch: batch });
			state.redo = [];
			markDirty();
			renderGrid();
			loadGlyph();
			renderPreview();
			var cellNote = (src.cell.width !== f.cell.width || src.cell.height !== f.cell.height)
				? ' Note: the SVG\u2019s cell is ' + src.cell.width + '\u00d7' + src.cell.height + ', this font\u2019s is ' + f.cell.width + '\u00d7' + f.cell.height + '.'
				: '';
			setStatus('Updated ' + changed + ' glyph' + (changed === 1 ? '' : 's') + (added ? ', added ' + added : '') +
				' from ' + file.name + ' (Ctrl+Z undoes it).' + cellNote, !!cellNote);
		};
		reader.readAsText(file);
	}

	// Path data written by different tools differs in formatting, so compare
	// shapes after a round trip through Paper, to 2 decimals.
	function normalizedD(d) {
		var item = P.PathItem.create(d);
		item.remove();
		return item.getPathData(null, 2);
	}

	// Same shapes, styles and grouping? (Group numbers may differ.)
	function samePaths(a, b) {
		if (a.length !== b.length) return false;
		var groupMap = {};
		return a.every(function (pa, i) {
			var pb = b[i];
			var sameStyle = ['strokeCap', 'strokeJoin', 'miterLimit'].every(function (k) { return pa[k] === pb[k]; });
			var ga = pa.group || 0, gb = pb.group || 0;
			if (!ga !== !gb) return false;
			if (ga) {
				if (groupMap[ga] === undefined) groupMap[ga] = gb;
				else if (groupMap[ga] !== gb) return false;
			}
			return sameStyle && normalizedD(pa.d) === normalizedD(pb.d);
		});
	}

	function exportSVG() {
		finishPen();
		var f = font();
		var svg = GregFont.toSVG(P, f, { strokeWidth: state.strokeWidth });
		var blob = new Blob([svg], { type: 'image/svg+xml' });
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = slug(f.name) + '_grid.svg';
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		setStatus('Exported ' + a.download + '. Edit it in Illustrator, then use File \u2192 Update shapes from SVG.');
	}

	function save() {
		finishPen();
		var entry = state.entry;
		if (!entry.file) {
			var taken = state.entries.map(function (e) { return e.file; });
			var base = slug(entry.font.name), file = base + '.json', n = 2;
			while (taken.indexOf(file) >= 0) file = base + '-' + (n++) + '.json';
			entry.file = file;
		}
		// this save's revision and date go in the file; put back if it fails
		var f = entry.font, before = { revision: f.revision, modified: f.modified };
		var now = new Date();
		f.revision = (f.revision || 0) + 1;
		f.modified = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
		function failed() {
			if (before.revision === undefined) delete f.revision; else f.revision = before.revision;
			if (before.modified === undefined) delete f.modified; else f.modified = before.modified;
		}
		function saved(where) {
			entry.dirty = false;
			refreshFontSelect();
			updateFontPanel();
			setStatus('Saved ' + where + entry.file + ' (rev ' + f.revision + ') at ' + now.toLocaleTimeString());
		}
		// From the dev server: save through it. Opened from disk: write into
		// the fonts folder (Chrome/Edge ask for it once). Otherwise download.
		var viaServer = location.protocol === 'file:' ? Promise.resolve(false) : GregFont.saveToServer(entry.file, entry.font);
		viaServer.then(function (ok) {
			if (ok) { saved('fonts/'); return; }
			if (!window.showDirectoryPicker) { downloadFont(entry); return; }
			saveToFolder(entry).then(function (dirName) {
				saved(dirName + '/');
			}, function (err) {
				failed();
				if (err && err.name === 'AbortError') { setStatus('Not saved: no folder chosen', true); return; }
				console.error(err);
				setStatus('Not saved: ' + err.message, true);
			});
		});
	}

	function downloadFont(entry) {
		var blob = new Blob([GregFont.stringify(entry.font)], { type: 'application/json' });
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = entry.file;
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		setStatus('This browser can\u2019t write to folders, so the font was downloaded. Put it in src/fonts/, add it to fonts.json, and run python tools/build_fonts.py.', true);
	}

	// --- saving into the fonts folder (File System Access API)

	var fontsDir = null;

	// The chosen folder is remembered in IndexedDB, so it's only picked once.
	function rememberedDir(value) {
		return new Promise(function (resolve) {
			try {
				var req = indexedDB.open('gregfont-editor', 1);
				req.onupgradeneeded = function () { req.result.createObjectStore('handles'); };
				req.onerror = function () { resolve(null); };
				req.onsuccess = function () {
					var tx = req.result.transaction('handles', 'readwrite');
					var store = tx.objectStore('handles');
					if (value) { store.put(value, 'fonts'); tx.oncomplete = function () { resolve(value); }; }
					else {
						var get = store.get('fonts');
						get.onsuccess = function () { resolve(get.result || null); };
						get.onerror = function () { resolve(null); };
					}
				};
			} catch (e) { resolve(null); }
		});
	}

	function withPermission(dir) {
		var opts = { mode: 'readwrite' };
		return dir.queryPermission(opts).then(function (p) {
			return p === 'granted' ? p : dir.requestPermission(opts);
		}).then(function (p) {
			if (p !== 'granted') throw new Error('no permission to write to the ' + dir.name + ' folder');
			return dir;
		});
	}

	function pickFontsDir() {
		setStatus('Choose the src/fonts folder to save into\u2026');
		return window.showDirectoryPicker({ id: 'gregfont-fonts', mode: 'readwrite' }).then(function (dir) {
			return dir.getFileHandle('fonts.json').then(function () { return dir; }, function () {
				throw new Error('that folder has no fonts.json; choose the src/fonts folder');
			});
		}).then(function (dir) {
			rememberedDir(dir);
			return dir;
		});
	}

	function getFontsDir() {
		if (fontsDir) return withPermission(fontsDir);
		return rememberedDir().then(function (dir) {
			return dir ? withPermission(dir).catch(pickFontsDir) : pickFontsDir();
		}).then(function (dir) {
			fontsDir = dir;
			return dir;
		});
	}

	function readText(dir, name) {
		return dir.getFileHandle(name).then(function (h) { return h.getFile(); }).then(function (f) { return f.text(); });
	}

	function writeText(dir, name, text) {
		return dir.getFileHandle(name, { create: true }).then(function (h) { return h.createWritable(); }).then(function (w) {
			return w.write(text).then(function () { return w.close(); });
		});
	}

	// Write the font, add it to fonts.json if new, and rebuild fonts.js from
	// the files on disk. Resolves to the folder's name.
	function saveToFolder(entry) {
		return getFontsDir().then(function (dir) {
			return writeText(dir, entry.file, GregFont.stringify(entry.font))
				.then(function () { return readText(dir, 'fonts.json'); })
				.then(function (text) {
					var manifest = JSON.parse(text);
					if (manifest.fonts.indexOf(entry.file) >= 0) return manifest;
					manifest.fonts.push(entry.file);
					return writeText(dir, 'fonts.json', JSON.stringify(manifest, null, '\t') + '\n').then(function () { return manifest; });
				})
				.then(function (manifest) {
					return Promise.all(manifest.fonts.map(function (file) {
						return readText(dir, file).then(function (t) { return [file, t]; }, function () { return null; });
					}));
				})
				.then(function (pairs) {
					return writeText(dir, 'fonts.js', GregFont.bundleScript(pairs.filter(Boolean)));
				})
				.then(function () { return dir.name; });
		});
	}

	function loadAll() {
		return GregFont.loadAll('fonts/').then(function (list) {
			list.forEach(function (item) { addEntry(item.font, item.file); });
		});
	}

	// ----------------------------------------------------------------- wire up

	function bindUI() {
		document.querySelectorAll('.tool').forEach(function (b) {
			b.addEventListener('click', function () { setTool(b.dataset.tool); });
			// keep keyboard focus on the canvas, so Enter/Space don't press the button
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
		});
		buildMenus();
		$('snap').addEventListener('change', function () { state.snap = this.checked; });
		$('snap-path').addEventListener('change', function () { state.snapPath = this.checked; });
		$('auto-slice').addEventListener('change', function () { state.autoSlice = this.checked; });
		document.querySelectorAll('#shape-options [data-shape]').forEach(function (b) {
			b.classList.toggle('active', b.dataset.shape === state.shapeKind);
			b.addEventListener('click', function () { useShape(b.dataset.shape); });
		});
		// remember which foldable sections are open
		GregUI.rememberFolds(document, 'gregfont-editor-open-');
		function setGrid() {
			var v = parseFloat(this.value);
			if (v > 0) { state.grid = v; drawGuides(); }
		}
		function setStrokeWidth() {
			var v = parseFloat(this.value);
			if (v > 0) { state.strokeWidth = v; editablePaths().forEach(pathStyle); drawExtensions(); renderPreview(); }
		}
		['change', 'scrub'].forEach(function (type) {
			$('grid-size').addEventListener(type, setGrid);
			$('stroke-width').addEventListener(type, setStrokeWidth);
		});

		$('font-select').addEventListener('change', function () {
			var v = this.value;
			if (v === 'new' || v === 'new-svg' || v === 'new-shapes') {
				this.value = state.entries.indexOf(state.entry);   // until the new font exists
				if (v === 'new') newFont(); else chooseSVG(v === 'new-shapes' ? 'shapes' : 'new');
				return;
			}
			openEntry(state.entries[Number(v)]);
		});
		$('import-file').addEventListener('change', function () {
			if (this.files[0]) importSVG(this.files[0]);
			this.value = '';
		});
		$('save').addEventListener('click', save);

		['lsb', 'rsb'].forEach(function (key) {
			$('glyph-' + key).addEventListener('change', function () {
				var v = parseFloat(this.value);
				if (fieldEdit) {
					// the end of a drag on the field: it opened the step, so it closes it
					var glyph = font().glyphs[state.ch];
					if (glyph && !isNaN(v)) glyph[key] = v;
					fieldEdit = false;
					endEdit();
					drawGuides();
					renderPreview();
				} else {
					setBearing(key, v);
				}
			});
		});
		[['path-cap', 'strokeCap'], ['path-join', 'strokeJoin']].forEach(function (pair) {
			$(pair[0]).querySelectorAll('button').forEach(function (b) {
				b.addEventListener('click', function () { setPathStyle(pair[1], b.dataset.value); updatePathStyleRow(); });
			});
		});
		// bearings: one undo step for a whole drag
		bindPositionFields();
		$('align-buttons').querySelectorAll('button').forEach(function (b) {
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
			b.addEventListener('click', function () { align(b.dataset.align); });
		});
		$('align-to').querySelectorAll('button').forEach(function (b) {
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
			b.addEventListener('click', function () { setAlignTo(b.dataset.value); });
		});
		setAlignTo(alignTo);
		['lsb', 'rsb'].forEach(function (key) {
			var input = $('glyph-' + key);
			input.addEventListener('scrubstart', function () { beginEdit(); fieldEdit = true; });
			input.addEventListener('scrub', function () {
				var glyph = font().glyphs[state.ch], v = parseFloat(this.value);
				if (!glyph || isNaN(v)) return;
				glyph[key] = v;
				drawGuides();
				renderPreview();
			});
		});
		$('theme-toggle').addEventListener('click', toggleTheme);
		tips = new GregUI.Tips($('tip'), 'gregfont-editor-tips');
		$('play-strokes').addEventListener('click', playStrokes);
		$('optimize-strokes').addEventListener('click', optimizeStrokes);
		$('reverse-strokes').addEventListener('click', reverseSelection);
		$('show-order').addEventListener('change', function () { setShowOrder(this.checked); });
		document.querySelectorAll('.field[data-scrub]').forEach(bindScrub);
		$('clear-glyph').addEventListener('click', function () {
			if (!editablePaths().length) return;
			edit(function () { glyphLayer.removeChildren(); });
		});
		$('delete-glyph').addEventListener('click', function () {
			var f = font();
			if (!f.glyphs[state.ch]) return;
			beginEdit();
			glyphLayer.removeChildren();
			delete f.glyphs[state.ch];
			GregFont.clearCache(f, state.ch);
			var after = null;
			if (after !== pending.before) { state.undo.push(pending); state.redo = []; markDirty(); }
			pending = null;
			renderGrid();
			loadGlyph();
			renderPreview();
			setStatus('Deleted "' + state.ch + '" (Ctrl+Z to undo)');
		});

		$('add-glyph').addEventListener('submit', function (e) {
			e.preventDefault();
			var v = $('add-glyph-input').value.trim();
			if (!v) return;
			// a symbol's name ("question") means that symbol
			var ch = Array.from(v).length === 1 ? v : (GregFont.charFromLayerName('char-' + v) || v);
			$('add-glyph-input').value = '';
			if (glyphChars().indexOf(ch) < 0) {
				// show it in the grid right away, even before anything is drawn
				state.added.push(ch);
				renderGrid();
			}
			selectGlyph(ch);
		});

		$('add-kern').addEventListener('submit', function (e) {
			e.preventDefault();
			var pair = $('kern-pair').value;
			var v = parseFloat($('kern-value').value);
			if (Array.from(pair).length !== 2 || isNaN(v)) {
				setStatus('Kerning needs two characters and a number', true);
				return;
			}
			font().kerning[pair] = v;
			markDirty();
			$('kern-pair').value = '';
			$('kern-value').value = '';
			renderKerning();
			renderPreview();
		});

		$('preview-text').addEventListener('input', function () {
			$('preview-sample').value = '';   // typing means your own text again
			renderPreview();
		});
		$('preview-stroke').value = previewView.stroke;
		$('extend-ends').checked = previewView.extend;
		$('extend-ends').addEventListener('change', function () {
			previewView.extend = this.checked;
			savePreviewView();
			drawExtensions();
			renderPreview();
		});
		['change', 'scrub'].forEach(function (type) {
			$('preview-stroke').addEventListener(type, function () {
				var v = parseFloat(this.value);
				if (!(v > 0)) return;
				previewView.stroke = v;
				savePreviewView();
				renderPreview();
			});
		});
		(window.GREGFONT_SAMPLES || []).forEach(function (s) {
			var opt = document.createElement('option');
			opt.value = s.id;
			opt.textContent = s.name;
			$('preview-sample').appendChild(opt);
		});
		$('preview-sample').addEventListener('change', function () {
			if (this.value && !isSpecimen()) setSpecimen(true);   // samples are long: show them big
			else renderPreview();
		});
		$('preview-expand').addEventListener('click', function () { setSpecimen(!isSpecimen()); });
		// specimen zoom: buttons, the wheel anywhere over it (Ctrl or not, so
		// a trackpad pinch works too, and never the browser's zoom)
		$('specimen-zoom-in').addEventListener('click', function () { zoomSpecimen(previewView.zoom * 1.25); });
		$('specimen-zoom-out').addEventListener('click', function () { zoomSpecimen(previewView.zoom / 1.25); });
		$('specimen-zoom-reset').addEventListener('click', function () { zoomSpecimen(1); });
		$('specimen-zoom-fit').addEventListener('click', fitSpecimen);
		$('preview-bar').addEventListener('wheel', function (e) {
			if (!isSpecimen()) return;
			e.preventDefault();
			var r = $('preview').getBoundingClientRect();
			zoomSpecimen(previewView.zoom * Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
		}, { passive: false });
		// drag anywhere to move around; a click without moving still picks a letter
		var specDrag = null;
		$('preview').addEventListener('pointerdown', function (e) {
			if (!isSpecimen() || (e.button !== 0 && e.button !== 1)) return;
			if (e.button === 1) e.preventDefault();
			specDrag = { x: e.clientX, y: e.clientY, px: previewView.panX, py: previewView.panY, moved: false, id: e.pointerId };
		});
		$('preview').addEventListener('pointermove', function (e) {
			if (!specDrag) return;
			var dx = e.clientX - specDrag.x, dy = e.clientY - specDrag.y;
			if (!specDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
			if (!specDrag.moved) {
				specDrag.moved = true;
				$('preview').classList.add('panning');
				try { $('preview').setPointerCapture(specDrag.id); } catch (err) { /* ignore */ }
			}
			previewView.panX = specDrag.px + dx;
			previewView.panY = specDrag.py + dy;
			applySpecimenView();
		});
		function endSpecDrag() {
			if (!specDrag) return;
			if (specDrag.moved) {
				// swallow the click that follows a drag, so it doesn't pick a letter
				window.addEventListener('click', function swallow(ev) { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
				setTimeout(function () { $('preview').classList.remove('panning'); }, 0);
			}
			specDrag = null;
		}
		$('preview').addEventListener('pointerup', endSpecDrag);
		$('preview').addEventListener('pointercancel', endSpecDrag);

		// glyph canvas zoom controls
		$('canvas-zoom-in').addEventListener('click', function () { zoomCanvas(P.view.zoom * 1.25); });
		$('canvas-zoom-out').addEventListener('click', function () { zoomCanvas(P.view.zoom / 1.25); });
		$('canvas-zoom-reset').addEventListener('click', function () { zoomCanvas(1); });
		$('canvas-zoom-fit').addEventListener('click', fit);
		['canvas-zoom-in', 'canvas-zoom-out', 'canvas-zoom-reset', 'canvas-zoom-fit', 'specimen-zoom-in', 'specimen-zoom-out', 'specimen-zoom-reset', 'specimen-zoom-fit'].forEach(function (id) {
			$(id).addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep keyboard focus put
		});

		// Ctrl+= / Ctrl+- / Ctrl+0: the specimen when it's open, otherwise the canvas
		document.addEventListener('keydown', function (e) {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e)) return;
			var k = e.key, spec = isSpecimen();
			if (k !== '=' && k !== '+' && k !== '-' && k !== '0') return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (k === '0') { if (spec) fitSpecimen(); else fit(); return; }
			var f = k === '-' ? 0.8 : 1.25;
			if (spec) zoomSpecimen(previewView.zoom * f); else zoomCanvas(P.view.zoom * f);
		}, true);
		new ResizeObserver(function () { renderPreview(); }).observe($('preview'));
		bindFontInputs();

		window.addEventListener('beforeunload', function (e) {
			if (state.entries.some(function (en) { return en.dirty; })) {
				e.preventDefault();
				e.returnValue = '';
			}
		});
	}

	loadShow();
	bindUI();
	setTool('select');
	loadAll().then(function () {
		var last = null;
		try { last = localStorage.getItem('gregfont-editor-font'); } catch (e) { /* ignore */ }
		var entry = state.entries.find(function (en) { return en.file === last; }) || state.entries[0];
		if (entry) openEntry(entry); else newFont();
	}).catch(function (err) {
		console.error(err);
		newFont();
		// after newFont(), which sets its own status
		setStatus('Could not load fonts: ' + err.message +
			(location.protocol === 'file:' ? ' (fonts/fonts.js is missing; run python tools/build_fonts.py)' : ''), true);
	});
})();
