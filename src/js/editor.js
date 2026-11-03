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
		cell: '#9a9a9a',
		guide: { cap: '#2f8cff', xHeight: '#20a37a', baseline: '#e07b00', descender: '#9b59b6' },
		bearing: '#d6337a',
		select: '#2f8cff',
		overlay: '#2f8cff'
	};

	var state = {
		entries: [],      // [{ file, font, dirty }] in dropdown order; file is null until first save
		entry: null,
		ch: 'a',
		tool: 'select',
		snap: true,
		grid: 5,
		strokeWidth: 2,
		undo: [],
		redo: [],
		clipboard: null,
		kernPick: null,
		added: []          // glyphs added from the sidebar but not drawn yet
	};

	// ---------------------------------------------------------------- setup

	var canvas = $('editor-canvas');
	var wrap = $('canvas-wrap');
	P.setup(canvas);
	P.settings.handleSize = 7;

	var guidesLayer = P.project.activeLayer;
	var glyphLayer = new P.Layer();
	var overlayLayer = new P.Layer();
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
		finishPen();
		glyphLayer.removeChildren();
		var glyph = font().glyphs[state.ch];
		if (glyph) {
			glyph.paths.forEach(function (entry) {
				var style = {};
				['strokeCap', 'strokeJoin', 'miterLimit'].forEach(function (k) {
					if (entry[k] !== undefined) style[k] = entry[k];
				});
				var item = P.PathItem.create(entry.d);
				var parts = item instanceof P.CompoundPath ? item.removeChildren() : [item];
				item.remove();
				parts.forEach(function (path) {
					path.data.style = Object.assign({}, style);
					pathStyle(path);
					glyphLayer.addChild(path);
				});
			});
		}
		drawGuides();
		updateGlyphPanel();
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
			var entry = { d: p.getPathData(null, 3) };
			var style = p.data.style || {};
			Object.keys(style).forEach(function (k) { if (style[k] !== undefined && style[k] !== '') entry[k] = style[k]; });
			return entry;
		});
		GregFont.clearCache(f, state.ch);
		drawGuides();
		updateThumb(state.ch);
		renderPreview();
		updateGlyphPanel();
	}

	// ---------------------------------------------------------- undo / redo

	var pending = null;

	function snapshot(ch) {
		var g = font().glyphs[ch];
		return g ? JSON.stringify(g) : null;
	}

	function beginEdit() {
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

	function restore(from, to) {
		finishPen();   // may add the pen stroke as its own undo step first
		var e = from.pop();
		if (!e) return;
		to.push({ ch: e.ch, before: snapshot(e.ch) });
		var f = font();
		if (e.before === null) delete f.glyphs[e.ch];
		else f.glyphs[e.ch] = JSON.parse(e.before);
		GregFont.clearCache(f, e.ch);
		markDirty();
		if (e.ch !== state.ch) selectGlyph(e.ch);
		else loadGlyph();
		updateThumb(e.ch);
		renderPreview();
	}

	function undo() { restore(state.undo, state.redo); }
	function redo() { restore(state.redo, state.undo); }

	// Glyph-level edit wrapped as one undo step.
	function edit(fn) {
		beginEdit();
		fn();
		endEdit();
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
			fontFamily: 'Raleway, sans-serif', justification: justification || 'left', insert: false
		});
		guidesLayer.addChild(t);
	}

	function drawGuides() {
		guidesLayer.removeChildren();
		var f = font();
		if (!f) return;
		var vb = P.view.bounds;

		// grid: thin out the lines when zoomed out
		var step = state.grid;
		while (step * P.view.zoom < 8) step *= 2;
		var major = step * 10;
		for (var x = Math.floor(vb.left / step) * step; x <= vb.right; x += step) {
			line([x, vb.top], [x, vb.bottom], Math.abs(x % major) < 1e-6 ? COLORS.gridMajor : COLORS.grid);
		}
		for (var y = Math.floor(vb.top / step) * step; y <= vb.bottom; y += step) {
			line([vb.left, y], [vb.right, y], Math.abs(y % major) < 1e-6 ? COLORS.gridMajor : COLORS.grid);
		}

		// cell box
		var cell = new P.Path.Rectangle({ point: [0, 0], size: [f.cell.width, f.cell.height], strokeColor: COLORS.cell, insert: false });
		cell.strokeScaling = false;
		guidesLayer.addChild(cell);

		// font guides
		Object.keys(COLORS.guide).forEach(function (key) {
			var gy = f.guides[key];
			if (gy === null || gy === undefined) return;
			line([vb.left, gy], [vb.right, gy], COLORS.guide[key]);
			label(key === 'xHeight' ? 'x-height' : key, [vb.left + px(6), gy - px(4)], COLORS.guide[key]);
		});

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
	}

	function bearingLines() {
		var glyph = font().glyphs[state.ch];
		var ink = inkBounds();
		if (!glyph || !ink) return null;
		return { lsb: ink.left - glyph.lsb, rsb: ink.right + glyph.rsb, ink: ink };
	}

	function fit() {
		var f = font();
		if (!f) return;
		var ink = inkBounds();
		var left = Math.min(0, ink ? ink.left : 0);
		var right = Math.max(f.cell.width, ink ? ink.right : 0);
		var top = Math.min(f.guides.cap, 0, ink ? ink.top : 0);
		var bottom = Math.max(f.guides.descender || 0, f.cell.height, ink ? ink.bottom : 0);
		var w = right - left, h = bottom - top;
		var region = new P.Rectangle(left - w * 0.6, top - h * 0.15, w * 2.2, h * 1.3);
		var vs = P.view.viewSize;
		P.view.zoom = Math.min(vs.width / region.width, vs.height / region.height);
		P.view.center = region.center;
		drawGuides();
	}

	// ----------------------------------------------------------------- tools

	var tool = new P.Tool();
	var drag = null;          // what the current mouse drag is doing
	var penPath = null;       // path being drawn with the pen
	var rubber = null;        // pen preview segment
	var spaceDown = false;
	var panning = null;

	function setTool(name) {
		finishPen();
		state.tool = name;
		document.querySelectorAll('.tool').forEach(function (b) {
			b.classList.toggle('active', b.dataset.tool === name);
		});
		wrap.className = 'tool-' + name;
	}

	function selectedSegments() {
		var out = [];
		editablePaths().forEach(function (p) {
			p.segments.forEach(function (s) { if (s.selected) out.push(s); });
		});
		return out;
	}

	function selectedPaths() {
		return editablePaths().filter(function (p) { return p.selected || p.segments.some(function (s) { return s.selected; }); });
	}

	function deselectAll() {
		editablePaths().forEach(function (p) { p.selected = false; });
	}

	function selectPath(p) {
		p.segments.forEach(function (s) { s.selected = true; });
	}

	function hitHandle(point) {
		var tol = px(6), best = null;
		selectedSegments().forEach(function (s) {
			['handleIn', 'handleOut'].forEach(function (k) {
				if (s[k].isZero()) return;
				var d = s.point.add(s[k]).getDistance(point);
				if (d < tol && (!best || d < best.d)) best = { segment: s, which: k, d: d };
			});
		});
		return best;
	}

	function hitGlyph(point, opts) {
		return glyphLayer.hitTest(point, Object.assign({ segments: true, stroke: true, fill: false, tolerance: px(6) }, opts));
	}

	function hitBearing(point) {
		var b = bearingLines();
		if (!b) return null;
		var tol = px(5);
		if (Math.abs(point.x - b.lsb) < tol) return 'lsb';
		if (Math.abs(point.x - b.rsb) < tol) return 'rsb';
		return null;
	}

	function isSmooth(s) {
		if (s.handleIn.isZero() || s.handleOut.isZero()) return false;
		return s.handleIn.normalize().add(s.handleOut.normalize()).length < 0.05;
	}

	tool.onMouseMove = function (e) {
		$('cursor-pos').textContent = round(e.point.x, 0.1) + ', ' + round(e.point.y, 0.1);
		if (state.tool === 'pen' && penPath) {
			if (rubber) rubber.remove();
			rubber = line(penPath.lastSegment.point, snap(e.point), COLORS.overlay, true, overlayLayer);
		}
		if (state.tool === 'select' && !drag) {
			wrap.style.cursor = hitBearing(e.point) ? 'ew-resize' : '';
		}
	};

	tool.onMouseDown = function (e) {
		if (panning || e.event.button !== 0) return;
		if (state.tool === 'select') selectDown(e);
		else if (state.tool === 'pen') penDown(e);
		else if (state.tool === 'ellipse') drag = { mode: 'ellipse', start: snap(e.point) };
	};

	tool.onMouseDrag = function (e) {
		if (panning || !drag) return;
		$('cursor-pos').textContent = round(e.point.x, 0.1) + ', ' + round(e.point.y, 0.1);
		var p = snap(e.point);
		if (drag.mode === 'points') {
			var delta = p.subtract(drag.anchorStart);
			drag.segments.forEach(function (s, i) { s.point = drag.starts[i].add(delta); });
			commit();
		} else if (drag.mode === 'handle') {
			var s = drag.segment;
			var v = p.subtract(s.point);
			s[drag.which] = v;
			if (drag.mirror && !e.modifiers.alt && !v.isZero()) {
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
		} else if (drag.mode === 'pen-handle') {
			var h = p.subtract(drag.segment.point);
			drag.segment.handleOut = h;
			drag.segment.handleIn = h.multiply(-1);
		} else if (drag.mode === 'ellipse') {
			if (drag.preview) drag.preview.remove();
			drag.preview = ellipseFrom(drag.start, p, e.modifiers.shift);
			if (drag.preview) {
				pathStyle(drag.preview);
				drag.preview.strokeColor = COLORS.overlay;
				overlayLayer.addChild(drag.preview);
			}
		}
	};

	tool.onMouseUp = function (e) {
		if (!drag) return;
		if (drag.mode === 'marquee') {
			if (drag.box) {
				var rect = drag.box.bounds;
				drag.box.remove();
				editablePaths().forEach(function (path) {
					path.segments.forEach(function (s) { if (rect.contains(s.point)) s.selected = true; });
				});
			}
			updatePathStyleRow();
		} else if (drag.mode === 'ellipse') {
			if (drag.preview) drag.preview.remove();
			var shape = ellipseFrom(drag.start, snap(e.point), e.modifiers.shift);
			if (shape) {
				edit(function () {
					shape.data.style = {};
					pathStyle(shape);
					glyphLayer.addChild(shape);
					deselectAll();
					selectPath(shape);
				});
			}
		} else if (drag.mode === 'pen-handle') {
			commit();
		} else {
			endEdit();
		}
		drag = null;
	};

	function ellipseFrom(a, b, square) {
		var w = b.x - a.x, h = b.y - a.y;
		if (square) {
			var size = Math.max(Math.abs(w), Math.abs(h));
			w = w < 0 ? -size : size;
			h = h < 0 ? -size : size;
		}
		if (Math.abs(w) < 0.01 || Math.abs(h) < 0.01) return null;
		return new P.Path.Ellipse({ rectangle: new P.Rectangle(a, a.add([w, h])), insert: false });
	}

	function selectDown(e) {
		var point = e.point;
		var shift = e.modifiers.shift;

		var handle = hitHandle(point);
		if (handle) {
			beginEdit();
			var s = handle.segment;
			var other = handle.which === 'handleIn' ? 'handleOut' : 'handleIn';
			drag = { mode: 'handle', segment: s, which: handle.which, mirror: isSmooth(s), otherLength: s[other].length };
			return;
		}

		var hit = hitGlyph(point);
		if (hit && hit.type === 'segment') {
			var seg = hit.segment;
			if (shift) seg.selected = !seg.selected;
			else if (!seg.selected) { deselectAll(); seg.selected = true; }
			startPointDrag(seg.point);
			return;
		}

		var bearing = hitBearing(point);
		if (bearing) {
			beginEdit();
			drag = { mode: bearing, ink: bearingLines().ink };
			return;
		}

		if (hit && (hit.type === 'stroke' || hit.type === 'curve')) {
			var path = hit.item;
			var allSelected = path.segments.every(function (x) { return x.selected; });
			if (shift && allSelected) { path.selected = false; drag = null; return; }
			if (!shift && !allSelected) deselectAll();
			selectPath(path);
			startPointDrag(path.firstSegment.point);
			return;
		}

		if (!shift) deselectAll();
		drag = { mode: 'marquee', start: point };
		updatePathStyleRow();
	}

	function startPointDrag(anchor) {
		beginEdit();
		var segs = selectedSegments();
		drag = {
			mode: 'points',
			segments: segs,
			starts: segs.map(function (s) { return s.point.clone(); }),
			anchorStart: anchor.clone()
		};
		updatePathStyleRow();
	}

	// pen

	function penDown(e) {
		var p = snap(e.point);
		var tol = px(7);
		if (!penPath) {
			beginEdit();
			// clicking the end of an open path continues it
			var hit = hitGlyph(e.point, { stroke: false });
			if (hit && hit.type === 'segment' && !hit.item.closed) {
				var path = hit.item, seg = hit.segment;
				if (seg.index === 0 || seg.index === path.segments.length - 1) {
					if (seg.index === 0 && path.segments.length > 1) path.reverse();
					penPath = path;
					deselectAll();
					penPath.lastSegment.selected = true;
					return;
				}
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
		penPath.add(p);
		deselectAll();
		penPath.lastSegment.selected = true;
		drag = { mode: 'pen-handle', segment: penPath.lastSegment };
	}

	function finishPen() {
		if (rubber) { rubber.remove(); rubber = null; }
		if (!penPath) return;
		if (penPath.segments.length < 2) penPath.remove();
		penPath = null;
		deselectAll();
		endEdit();
	}

	// double-click: toggle point smooth/corner, or add a point on a line
	canvas.addEventListener('dblclick', function (e) {
		if (state.tool !== 'select') return;
		var point = P.view.viewToProject(new P.Point(e.offsetX, e.offsetY));
		var hit = hitGlyph(point);
		if (!hit) return;
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
	});

	// zoom + pan
	wrap.addEventListener('wheel', function (e) {
		e.preventDefault();
		var rect = canvas.getBoundingClientRect();
		var mouse = P.view.viewToProject(new P.Point(e.clientX - rect.left, e.clientY - rect.top));
		var old = P.view.zoom;
		var zoom = Math.min(Math.max(old * Math.pow(1.0015, -e.deltaY), 0.2), 200);
		var center = mouse.add(P.view.center.subtract(mouse).multiply(old / zoom));
		P.view.zoom = zoom;
		P.view.center = center;
		drawGuides();
	}, { passive: false });

	wrap.addEventListener('mousedown', function (e) {
		// take keyboard focus from whatever button was clicked last, so
		// Enter/Space don't press it again
		wrap.focus({ preventScroll: true });
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
		if (panning) { panning = null; wrap.classList.remove('panning'); }
	});

	// ------------------------------------------------------------ keyboard

	function nudge(dx, dy) {
		var segs = selectedSegments();
		if (!segs.length) return;
		edit(function () {
			segs.forEach(function (s) { s.point = s.point.add([dx, dy]); });
		});
	}

	function deleteSelection() {
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
	}

	function copySelection() {
		var paths = selectedPaths();
		if (!paths.length) paths = editablePaths();
		state.clipboard = paths.map(function (p) {
			return { d: p.getPathData(null, 3), style: Object.assign({}, p.data.style) };
		});
		setStatus('Copied ' + paths.length + ' path' + (paths.length === 1 ? '' : 's'));
	}

	function paste() {
		if (!state.clipboard) return;
		edit(function () {
			deselectAll();
			state.clipboard.forEach(function (c) {
				var item = P.PathItem.create(c.d);
				var parts = item instanceof P.CompoundPath ? item.removeChildren() : [item];
				item.remove();
				parts.forEach(function (p) {
					p.data.style = Object.assign({}, c.style);
					pathStyle(p);
					glyphLayer.addChild(p);
					selectPath(p);
				});
			});
		});
	}

	document.addEventListener('keydown', function (e) {
		if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; e.preventDefault(); return; }
		var ctrl = e.ctrlKey || e.metaKey;
		var key = e.key.toLowerCase();

		if (ctrl && key === 's') { e.preventDefault(); save(); return; }
		if (isTyping(e)) return;

		if (ctrl && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
		if (ctrl && key === 'y') { e.preventDefault(); redo(); return; }
		if (ctrl && key === 'a') {
			e.preventDefault();
			editablePaths().forEach(selectPath);
			updatePathStyleRow();
			return;
		}
		if (ctrl && key === 'c') { copySelection(); return; }
		if (ctrl && key === 'v') { paste(); return; }
		if (ctrl) return;

		var step = e.shiftKey ? state.grid : 1;
		switch (e.key) {
			case 'v': case 'V': setTool('select'); break;
			case 'p': case 'P': setTool('pen'); break;
			case 'e': case 'E': setTool('ellipse'); break;
			case 'g': case 'G': setSnap(!state.snap); break;
			case 'f': case 'F': fit(); break;
			case 'Enter': finishPen(); break;
			case 'Escape':
				if (penPath) finishPen(); else { deselectAll(); updatePathStyleRow(); }
				break;
			case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
			case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); break;
			case 'ArrowRight': e.preventDefault(); nudge(step, 0); break;
			case 'ArrowUp': e.preventDefault(); nudge(0, -step); break;
			case 'ArrowDown': e.preventDefault(); nudge(0, step); break;
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

	// --------------------------------------------------------- glyph grid

	function svgEl(tag, attrs) {
		var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
		return el;
	}

	// <g> with a glyph's paths, styled like the font.
	function glyphGroup(f, ch, strokeWidth, nonScaling) {
		var g = svgEl('g');
		var glyph = f.glyphs[ch];
		if (!glyph) return g;
		glyph.paths.forEach(function (p) {
			var attrs = {
				d: p.d, fill: 'none', stroke: COLORS.ink, 'stroke-width': strokeWidth,
				'stroke-linecap': p.strokeCap || f.style.strokeCap,
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
		if (glyph) {
			var ink = GregFont.inkBounds(P, f, ch);
			var left = Math.min(0, ink ? ink.left : 0), right = Math.max(f.cell.width, ink ? ink.right : 0);
			var top = Math.min(f.guides.cap, ink ? ink.top : 0);
			var bottom = Math.max(f.guides.descender || f.cell.height, ink ? ink.bottom : 0);
			var pad = (bottom - top) * 0.05;
			var svg = svgEl('svg', { viewBox: [left - pad, top - pad, right - left + pad * 2, bottom - top + pad * 2].join(' ') });
			svg.appendChild(glyphGroup(f, ch, 1.5, true));
			btn.appendChild(svg);
		}
		btn.appendChild(lbl);
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
		var f = font(), glyph = f.glyphs[state.ch];
		$('glyph-title').textContent = glyphLabel(state.ch) + (glyph ? '' : ' (empty)');
		$('glyph-lsb').value = glyph ? glyph.lsb : '';
		$('glyph-rsb').value = glyph ? glyph.rsb : '';
		$('glyph-lsb').disabled = $('glyph-rsb').disabled = !glyph;
		$('glyph-layer-name').textContent = 'Illustrator layer: char-' + GregFont.charToName(state.ch);
		updatePathStyleRow();
	}

	function updatePathStyleRow() {
		var paths = selectedPaths();
		$('path-style-row').classList.toggle('disabled', !paths.length);
		$('path-cap').disabled = $('path-join').disabled = !paths.length;
		var first = paths[0] && paths[0].data.style || {};
		$('path-cap').value = first.strokeCap || '';
		$('path-join').value = first.strokeJoin || '';
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
		$('font-file').textContent = state.entry.file ? 'fonts/' + state.entry.file : 'not saved yet';
		$('cell-width').value = f.cell.width;
		$('cell-height').value = f.cell.height;
		['cap', 'xHeight', 'baseline', 'descender'].forEach(function (k) {
			$('guide-' + k).value = f.guides[k] === null ? '' : f.guides[k];
		});
		$('style-strokeCap').value = f.style.strokeCap;
		$('style-strokeJoin').value = f.style.strokeJoin;
		$('spacing-monospaced').checked = f.spacing.monospaced;
		$('spacing-letterSpacing').value = f.spacing.letterSpacing;
		$('spacing-lineHeight').value = f.spacing.lineHeight;
		$('preview-mono').checked = f.spacing.monospaced;
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
		[['cell-width', 'width'], ['cell-height', 'height']].forEach(function (pair) {
			$(pair[0]).addEventListener('change', function () {
				var v = parseFloat(this.value);
				if (v > 0) { font().cell[pair[1]] = v; fontChanged(true); }
			});
		});
		['cap', 'xHeight', 'baseline', 'descender'].forEach(function (k) {
			$('guide-' + k).addEventListener('change', function () {
				var v = parseFloat(this.value);
				font().guides[k] = isNaN(v) ? null : v;
				fontChanged(true);
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
			$('preview-mono').checked = this.checked;
			fontChanged(false);
		});
		['letterSpacing', 'lineHeight'].forEach(function (k) {
			$('spacing-' + k).addEventListener('change', function () {
				var v = parseFloat(this.value);
				if (!isNaN(v)) { font().spacing[k] = v; fontChanged(false); }
			});
		});
	}

	// kerning

	function renderKerning() {
		var f = font(), list = $('kerning-list');
		list.innerHTML = '';
		Object.keys(f.kerning).sort().forEach(function (pair) {
			var row = document.createElement('div');
			row.className = 'kern-row';
			var name = document.createElement('span');
			name.className = 'pair';
			name.textContent = pair;
			var input = document.createElement('input');
			input.type = 'number';
			input.step = '0.5';
			input.value = f.kerning[pair];
			input.addEventListener('change', function () {
				var v = parseFloat(input.value);
				if (!isNaN(v)) { f.kerning[pair] = v; markDirty(); renderPreview(); }
			});
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
			row.appendChild(input);
			row.appendChild(del);
			list.appendChild(row);
		});
	}

	// ------------------------------------------------------------ preview

	function renderPreview() {
		var f = font(), box = $('preview');
		box.innerHTML = '';
		if (!f) return;
		var mono = $('preview-mono').checked;
		var result = GregFont.layout(P, f, $('preview-text').value, {
			monospace: mono,
			letterSpacing: f.spacing.letterSpacing,
			lineHeight: f.spacing.lineHeight,
			tracking: 0,
			margin: 0
		});
		var top = Math.min(f.guides.cap, 0) - state.strokeWidth;
		var bottom = Math.max(f.guides.descender || 0, f.cell.height) + state.strokeWidth;
		var right = 0, left = 0;
		var svg = svgEl('svg');
		result.glyphs.forEach(function (placed) {
			var g = glyphGroup(f, placed.char, state.strokeWidth, false);
			g.setAttribute('transform', 'translate(' + placed.x + ' ' + placed.y + ')');
			g.dataset.ch = placed.char;
			if (placed.char === state.ch) g.classList.add('current');
			if (state.kernPick === placed.char) g.classList.add('kern-pick');
			// a transparent box makes the whole letter clickable
			var ink = GregFont.inkBounds(P, f, placed.char);
			var bx = ink ? ink.left : 0, bw = ink ? ink.width : f.cell.width;
			g.insertBefore(svgEl('rect', { x: bx, y: top, width: Math.max(bw, 4), height: bottom - top, fill: 'transparent' }), g.firstChild);
			g.addEventListener('click', function (e) {
				if (e.shiftKey || e.altKey) pickKernLetter(placed.char);
				else selectGlyph(placed.char);
			});
			svg.appendChild(g);
			right = Math.max(right, placed.x + (ink ? ink.right : f.cell.width));
			left = Math.min(left, placed.x + (ink ? ink.left : 0));
		});
		var pad = state.strokeWidth * 2;
		svg.setAttribute('viewBox', [left - pad, top, Math.max(right - left + pad * 2, 1), bottom - top].join(' '));
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
		state.entries.forEach(function (entry, i) {
			var opt = document.createElement('option');
			opt.value = i;
			opt.textContent = entry.font.name + (entry.dirty ? ' *' : '');
			select.appendChild(opt);
		});
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
			cell: { width: 40, height: 60 },
			guides: { cap: 0, xHeight: 30, baseline: 60, descender: 80 },
			style: { strokeCap: 'round', strokeJoin: 'round', miterLimit: 10 },
			spacing: { monospaced: false, letterSpacing: 45, lineHeight: 90 },
			kerning: {},
			glyphs: {}
		});
		state.ch = 'a';
		openEntry(addEntry(f, null));
		setStatus('New font. Draw some glyphs, then Save.');
	}

	function importSVG(file) {
		var reader = new FileReader();
		reader.onload = function () {
			try {
				var base = file.name.replace(/\.svg$/i, '').replace(/_all_\d+x\d+$/i, '');
				var name = base.charAt(0).toUpperCase() + base.slice(1);
				var result = GregFont.fromSVG(P, reader.result, { name: name });
				var count = Object.keys(result.font.glyphs).length;
				if (!count) {
					setStatus('No char-<name> layers found in ' + file.name, true);
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

	function save() {
		finishPen();
		var entry = state.entry;
		if (!entry.file) {
			var taken = state.entries.map(function (e) { return e.file; });
			var base = slug(entry.font.name), file = base + '.json', n = 2;
			while (taken.indexOf(file) >= 0) file = base + '-' + (n++) + '.json';
			entry.file = file;
		}
		GregFont.saveToServer(entry.file, entry.font).then(function (ok) {
			if (ok) {
				entry.dirty = false;
				refreshFontSelect();
				updateFontPanel();
				setStatus('Saved fonts/' + entry.file + ' at ' + new Date().toLocaleTimeString());
				return;
			}
			// No dev server: download the file instead.
			var blob = new Blob([GregFont.stringify(entry.font)], { type: 'application/json' });
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = entry.file;
			a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
			setStatus('Dev server not running, so the font was downloaded. Put it in src/fonts/ and add it to fonts.json.', true);
		});
	}

	function loadAll() {
		return fetch('fonts/fonts.json', { cache: 'no-store' })
			.then(function (res) { return res.json(); })
			.then(function (manifest) {
				return Promise.all(manifest.fonts.map(function (file) {
					return GregFont.load('fonts/' + file).then(function (f) { addEntry(f, file); });
				}));
			});
	}

	// ----------------------------------------------------------------- wire up

	function bindUI() {
		document.querySelectorAll('.tool').forEach(function (b) {
			b.addEventListener('click', function () { setTool(b.dataset.tool); });
		});
		$('snap').addEventListener('change', function () { state.snap = this.checked; });
		$('grid-size').addEventListener('change', function () {
			var v = parseFloat(this.value);
			if (v > 0) { state.grid = v; drawGuides(); }
		});
		$('stroke-width').addEventListener('change', function () {
			var v = parseFloat(this.value);
			if (v > 0) { state.strokeWidth = v; editablePaths().forEach(pathStyle); renderPreview(); }
		});
		$('undo').addEventListener('click', undo);
		$('redo').addEventListener('click', redo);
		$('fit').addEventListener('click', fit);

		$('font-select').addEventListener('change', function () {
			openEntry(state.entries[Number(this.value)]);
		});
		$('new-font').addEventListener('click', newFont);
		$('import-svg').addEventListener('click', function () { $('import-file').click(); });
		$('import-file').addEventListener('change', function () {
			if (this.files[0]) importSVG(this.files[0]);
			this.value = '';
		});
		$('save').addEventListener('click', save);

		$('glyph-lsb').addEventListener('change', function () { setBearing('lsb', parseFloat(this.value)); });
		$('glyph-rsb').addEventListener('change', function () { setBearing('rsb', parseFloat(this.value)); });
		$('path-cap').addEventListener('change', function () { setPathStyle('strokeCap', this.value); });
		$('path-join').addEventListener('change', function () { setPathStyle('strokeJoin', this.value); });
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

		$('preview-text').addEventListener('input', renderPreview);
		$('preview-mono').addEventListener('change', renderPreview);
		bindFontInputs();

		window.addEventListener('beforeunload', function (e) {
			if (state.entries.some(function (en) { return en.dirty; })) {
				e.preventDefault();
				e.returnValue = '';
			}
		});
	}

	bindUI();
	setTool('select');
	loadAll().then(function () {
		var last = null;
		try { last = localStorage.getItem('gregfont-editor-font'); } catch (e) { /* ignore */ }
		var entry = state.entries.find(function (en) { return en.file === last; }) || state.entries[0];
		if (entry) openEntry(entry); else newFont();
	}).catch(function (err) {
		console.error(err);
		setStatus('Could not load fonts: ' + err.message, true);
		newFont();
	});
})();
