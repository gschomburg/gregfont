/*
 * gregfont typesetter: lay out text boxes on a page and export them as SVG,
 * for pen plotters.
 *
 * Everything is in pixels (96 per inch). A document is a page plus a list
 * of text boxes; each box has its own font and settings. The page is drawn
 * as SVG; every glyph stroke is flattened into page coordinates with an
 * offscreen Paper.js scope, which is also what gets saved. Saving writes
 * the layout into the SVG (a <metadata> block), so a saved SVG opens again.
 */
(function () {
	'use strict';

	var $ = function (id) { return document.getElementById(id); };
	var NS = 'http://www.w3.org/2000/svg';
	var P = new paper.PaperScope();
	P.setup(document.createElement('canvas'));   // offscreen, for geometry only

	var STORE_KEY = 'gregfont-typesetter-document';
	var LAYOUT_ID = 'gregfont-layout';
	var PRESETS = [
		{ id: 'a4', name: 'A4', w: 794, h: 1123 },
		{ id: 'a3', name: 'A3', w: 1123, h: 1587 },
		{ id: 'a5', name: 'A5', w: 559, h: 794 },
		{ id: 'letter', name: 'US Letter', w: 816, h: 1056 },
		{ id: 'tabloid', name: 'Tabloid', w: 1056, h: 1632 },
		{ id: 'square', name: 'Square 1000', w: 1000, h: 1000 }
	];
	var PEN_COLOURS = ['#141414', '#1d4ed8', '#c2410c', '#15803d'];
	var TIPS = [
		'Text tool: click to type, or drag to make a box that wraps',
		'Drag a box’s side handles to set where its text wraps',
		'Double-click a text to edit it · Esc stops editing',
		'Number fields can be dragged sideways',
		'Save SVG keeps the layout inside the file, so Open can bring it back',
		'Plot preview shows the pen-up moves; Order strokes cuts them down',
		'Wheel zooms · Space-drag or the hand tool pans · Ctrl+0 fits the page',
		'Each text box has its own font, size, pen and colour'
	];

	var fonts = [];   // [{ file, font }]
	var doc = null;
	var state = {
		tool: 'select',
		selected: null,     // a box id
		editing: false,
		zoom: 1, panX: 0, panY: 0,
		showBoxes: true,
		plotPreview: false,
		undo: [], redo: [],
		drag: null,
		play: null,
		fileHandle: null,
		defaults: null      // settings for the next new box
	};
	var cache = {};          // box id -> { key, lay, strokes }
	var tips = null;

	// ------------------------------------------------------------- helpers

	function el(tag, attrs, parent) {
		var e = document.createElementNS(NS, tag);
		Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
		if (parent) parent.appendChild(e);
		return e;
	}

	function round(n, step) {
		step = step || 0.1;
		return Math.round(Math.round(n / step) * step * 1000) / 1000;
	}

	function setStatus(msg, isError) {
		var s = $('status');
		s.textContent = msg || '';
		s.className = isError ? 'error' : '';
		clearTimeout(setStatus.t);
		if (msg && !isError) setStatus.t = setTimeout(function () { s.textContent = ''; }, 6000);
	}

	function fontEntry(file) {
		return fonts.find(function (f) { return f.file === file; }) || fonts[0];
	}

	function fontOf(box) { return fontEntry(box.font).font; }

	function boxById(id) {
		return doc.boxes.find(function (b) { return b.id === id; }) || null;
	}

	function selectedBox() { return state.selected === null ? null : boxById(state.selected); }

	// The box being edited in the left panel: the selected one, or the
	// settings the next new box will get.
	function current() { return selectedBox() || state.defaults; }

	function isTyping(e) {
		var t = e.target;
		return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
	}

	// ------------------------------------------------------------ document

	function newDoc() {
		return {
			format: LAYOUT_ID, version: 1,
			page: { preset: 'a4', width: 1123, height: 794, margin: 48 },
			plot: { optimize: false },
			boxes: [], nextId: 1
		};
	}

	function makeDefaults(file) {
		var f = fontEntry(file).font;
		return {
			font: fontEntry(file).file, size: 60, pen: 2, cap: 'font', colour: PEN_COLOURS[0],
			letterSpacing: f.spacing.letterSpacing, tracking: 0, lineHeight: f.spacing.lineHeight,
			mono: !!f.spacing.monospaced, align: 'left', textCase: 'none', rotation: 0
		};
	}

	var BOX_SETTINGS = ['font', 'size', 'pen', 'cap', 'colour', 'letterSpacing', 'tracking', 'lineHeight', 'mono', 'align', 'textCase'];

	function newBox(x, y, width, text) {
		var b = { id: doc.nextId++, text: text || '', x: x, y: y, width: width || null, rotation: 0 };
		BOX_SETTINGS.forEach(function (k) { b[k] = state.defaults[k]; });
		doc.boxes.push(b);
		return b;
	}

	function starterDoc() {
		var d = newDoc();
		doc = d;
		newBox(96, 96, 900, 'Single line type for pen plotters. Every letter is one stroke, so the pen draws it without filling anything in.');
		return d;
	}

	// ------------------------------------------------------------ undo

	function snapshot() { return JSON.stringify(doc); }

	function pushUndo() {
		state.undo.push(snapshot());
		if (state.undo.length > 200) state.undo.shift();
		state.redo = [];
	}

	function restore(from, to) {
		if (state.editing) stopEditing();
		var s = from.pop();
		if (!s) return;
		to.push(snapshot());
		doc = JSON.parse(s);
		cache = {};
		if (state.selected !== null && !selectedBox()) state.selected = null;
		changed();
		refreshPanels();
	}

	function undo() { restore(state.undo, state.redo); }
	function redo() { restore(state.redo, state.undo); }

	var saveTimer = 0;
	function changed() {
		render();
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch (e) { /* ignore */ }
		}, 400);
	}

	// ------------------------------------------------------------ layout

	function applyCase(text, c) {
		return c === 'upper' ? text.toUpperCase() : c === 'lower' ? text.toLowerCase() : text;
	}

	// Lay a box out, and flatten its strokes into page coordinates. Cached
	// until the box (or its font) changes.
	function boxData(b) {
		var key = JSON.stringify(b);
		var c = cache[b.id];
		if (c && c.key === key) return c;
		var f = fontOf(b);
		var s = b.size / f.cell.height;
		var text = applyCase(b.text, b.textCase);
		var lay = GregFont.layoutBlock(P, f, text, {
			monospace: b.mono, letterSpacing: b.letterSpacing, lineHeight: b.lineHeight,
			tracking: b.tracking, width: b.width ? b.width / s : null, align: b.align
		});
		var m = new P.Matrix().translate(b.x, b.y).rotate(b.rotation || 0).scale(s);
		var strokes = [];
		lay.glyphs.forEach(function (g) {
			var glyph = f.glyphs[g.char];
			if (!glyph) return;
			var gm = m.clone().translate(g.x, g.y).scale(1, -1);   // font units are y-up
			glyph.paths.forEach(function (entry) {
				var item = P.PathItem.create(entry.d);
				item.remove();
				item.transform(gm);
				var parts = item instanceof P.CompoundPath ? item.children.slice() : [item];
				parts.forEach(function (part) {
					if (part.segments.length < 2) return;
					strokes.push({
						item: part, closed: part.closed,
						start: part.firstSegment.point, end: part.closed ? part.firstSegment.point : part.lastSegment.point,
						d: part.getPathData(null, 2),
						cap: b.cap === 'font' ? entry.strokeCap || f.style.strokeCap : b.cap,
						join: entry.strokeJoin || f.style.strokeJoin,
						miter: entry.miterLimit || f.style.miterLimit,
						width: b.pen, colour: b.colour, box: b.id
					});
				});
			});
		});
		c = cache[b.id] = {
			key: key, lay: lay, scale: s, strokes: strokes, text: text,
			w: b.width || Math.max(lay.width * s, b.size * 0.5), h: lay.height * s
		};
		if (lay.missing.length) setStatus(f.name + ' has no glyph for: ' + lay.missing.join(' '), true);
		return c;
	}

	// box-local pixels (before rotation) <-> page
	function toPage(b, lx, ly) {
		var a = (b.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
		return { x: b.x + lx * cos - ly * sin, y: b.y + lx * sin + ly * cos };
	}

	function toLocal(b, px, py) {
		var a = -(b.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
		var dx = px - b.x, dy = py - b.y;
		return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
	}

	// Every stroke on the page, in plotting order.
	function plotStrokes(optimize) {
		var all = [];
		doc.boxes.forEach(function (b) { all = all.concat(boxData(b).strokes); });
		if (!optimize) return all.map(function (s) { return { s: s, reverse: false }; });
		// nearest-next from the page's top-left, flipping open strokes as needed
		var left = all.slice(), pos = new P.Point(0, 0), out = [];
		while (left.length) {
			var best = null;
			for (var i = 0; i < left.length; i++) {
				var s = left[i];
				var d1 = pos.getDistance(s.start);
				if (!best || d1 < best.d) best = { d: d1, i: i, reverse: false };
				if (!s.closed) {
					var d2 = pos.getDistance(s.end);
					if (d2 < best.d) best = { d: d2, i: i, reverse: true };
				}
			}
			var pick = left.splice(best.i, 1)[0];
			out.push({ s: pick, reverse: best.reverse });
			pos = best.reverse ? pick.start : pick.end;
		}
		return out;
	}

	function strokeStart(o) { return o.reverse ? o.s.end : o.s.start; }
	function strokeEnd(o) { return o.reverse ? o.s.start : o.s.end; }

	function travelOf(order) {
		var pos = new P.Point(0, 0), total = 0;
		order.forEach(function (o) { total += pos.getDistance(strokeStart(o)); pos = strokeEnd(o); });
		return total;
	}

	function reversedD(s) {
		var c = s.item.clone({ insert: false });
		c.reverse();
		return c.getPathData(null, 2);
	}

	// ------------------------------------------------------------ drawing

	var svg = $('stage');
	var view = el('g', { id: 'view' }, svg);
	var pageLayer = el('g', {}, view);
	var inkLayer = el('g', {}, view);
	var travelLayer = el('g', {}, view);
	var playLayer = el('g', {}, view);
	var uiLayer = el('g', {}, view);

	function applyView() {
		view.setAttribute('transform', 'matrix(' + state.zoom + ' 0 0 ' + state.zoom + ' ' + state.panX + ' ' + state.panY + ')');
		$('zoom-fit').textContent = Math.round(state.zoom * 100) + '%';
		renderUI();
	}

	function px(n) { return n / state.zoom; }   // screen pixels -> page pixels

	function render() {
		var page = doc.page;
		pageLayer.innerHTML = '';
		el('rect', { x: 2, y: 3, width: page.width, height: page.height, fill: '#000', opacity: 0.12 }, pageLayer);
		el('rect', { x: 0, y: 0, width: page.width, height: page.height, fill: '#ffffff' }, pageLayer);

		inkLayer.innerHTML = '';
		doc.boxes.forEach(function (b) {
			var g = el('g', { 'data-box': b.id }, inkLayer);
			boxData(b).strokes.forEach(function (s) {
				el('path', {
					d: s.d, fill: 'none', stroke: s.colour, 'stroke-width': s.width,
					'stroke-linecap': s.cap, 'stroke-linejoin': s.join, 'stroke-miterlimit': s.miter
				}, g);
			});
		});
		renderTravel();
		renderUI();
		renderTextList();
		updatePlotInfo();
	}

	function renderTravel() {
		travelLayer.innerHTML = '';
		if (!state.plotPreview) return;
		var order = plotStrokes(doc.plot.optimize), pos = null, d = '';
		order.forEach(function (o) {
			var a = strokeStart(o);
			if (pos && pos.getDistance(a) > 0.5) d += 'M' + round(pos.x) + ',' + round(pos.y) + 'L' + round(a.x) + ',' + round(a.y);
			pos = strokeEnd(o);
		});
		if (d) el('path', { d: d, fill: 'none', stroke: '#e11d74', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke', opacity: 0.85 }, travelLayer);
	}

	function updatePlotInfo() {
		var order = plotStrokes(doc.plot.optimize);
		$('plot-info').textContent = order.length + ' strokes · pen-up travel ' +
			Math.round(travelOf(order)).toLocaleString() + ' px';
	}

	function renderUI() {
		uiLayer.innerHTML = '';
		var page = doc.page, accent = getComputedStyle(document.documentElement).getPropertyValue('--select').trim() || '#2f6fe0';
		if (state.showBoxes && page.margin > 0) {
			el('rect', {
				x: page.margin, y: page.margin, width: Math.max(page.width - page.margin * 2, 0), height: Math.max(page.height - page.margin * 2, 0),
				fill: 'none', stroke: '#9db7e8', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke'
			}, uiLayer);
		}
		doc.boxes.forEach(function (b) {
			var data = boxData(b), sel = b.id === state.selected;
			if (!state.showBoxes && !sel) return;
			var g = el('g', { transform: 'translate(' + b.x + ' ' + b.y + ') rotate(' + (b.rotation || 0) + ')' }, uiLayer);
			el('rect', {
				x: 0, y: 0, width: data.w, height: Math.max(data.h, b.size), fill: 'none', stroke: sel ? accent : '#9db7e8',
				'stroke-width': sel ? 1.5 : 1, 'stroke-dasharray': sel ? '' : '3 3', 'vector-effect': 'non-scaling-stroke'
			}, g);
			if (sel && !state.play) {
				var hs = px(8), h = Math.max(data.h, b.size);
				[0, data.w].forEach(function (x) {
					el('rect', { x: x - hs / 2, y: h / 2 - hs, width: hs, height: hs * 2, rx: hs / 4, fill: accent }, g);
				});
				if (state.editing) drawCaret(b, data, g, accent);
			}
		});
	}

	// the caret and selection, in box-local pixels
	function drawCaret(b, data, g, accent) {
		var ta = $('text-input'), s = data.scale, f = fontOf(b);
		var carets = data.lay.carets;
		var a = Math.min(ta.selectionStart, carets.length - 1), z = Math.min(ta.selectionEnd, carets.length - 1);
		var top = -f.cell.height * s, bottom = Math.max(-(f.guides.descender || 0), f.cell.height * 0.15) * s;
		if (a !== z) {
			for (var i = a; i < z; i++) {
				var c1 = carets[i], c2 = carets[i + 1];
				if (!c1 || !c2 || c1.line !== c2.line) continue;
				el('rect', {
					x: Math.min(c1.x, c2.x) * s, y: c1.y * s + top, width: Math.abs(c2.x - c1.x) * s, height: bottom - top,
					fill: accent, opacity: 0.22
				}, g);
			}
		}
		var c = carets[ta.selectionDirection === 'backward' ? a : z] || { x: 0, y: f.cell.height, line: 0 };
		el('line', {
			class: 'caret', x1: c.x * s, x2: c.x * s, y1: c.y * s + top, y2: c.y * s + bottom,
			stroke: accent, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke'
		}, g);
	}

	// ------------------------------------------------------------ view

	function fitPage() {
		var r = svg.getBoundingClientRect(), page = doc.page;
		if (!r.width || !r.height) return;
		state.zoom = Math.min((r.width - 100) / page.width, (r.height - 80) / page.height);
		state.zoom = Math.max(state.zoom, 0.05);
		state.panX = (r.width - page.width * state.zoom) / 2;
		state.panY = (r.height - page.height * state.zoom) / 2;
		applyView();
	}

	function zoomBy(factor, cx, cy) {
		var r = svg.getBoundingClientRect();
		if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
		var z = Math.min(Math.max(state.zoom * factor, 0.05), 40);
		state.panX = cx - (cx - state.panX) * z / state.zoom;
		state.panY = cy - (cy - state.panY) * z / state.zoom;
		state.zoom = z;
		applyView();
	}

	function eventPoint(e) {
		var r = svg.getBoundingClientRect();
		return { sx: e.clientX - r.left, sy: e.clientY - r.top, x: (e.clientX - r.left - state.panX) / state.zoom, y: (e.clientY - r.top - state.panY) / state.zoom };
	}

	// ------------------------------------------------------------ hit testing

	function boxAt(pt) {
		for (var i = doc.boxes.length - 1; i >= 0; i--) {
			var b = doc.boxes[i], d = boxData(b), l = toLocal(b, pt.x, pt.y), pad = px(4);
			if (l.x >= -pad && l.x <= d.w + pad && l.y >= -pad && l.y <= Math.max(d.h, b.size) + pad) return b;
		}
		return null;
	}

	function handleAt(pt) {
		var b = selectedBox();
		if (!b) return null;
		var d = boxData(b), l = toLocal(b, pt.x, pt.y), h = Math.max(d.h, b.size), tol = px(8);
		if (Math.abs(l.y - h / 2) > Math.max(h / 2, tol)) return null;
		if (Math.abs(l.x) < tol) return { box: b, side: 'left' };
		if (Math.abs(l.x - d.w) < tol) return { box: b, side: 'right' };
		return null;
	}

	// the text index nearest a page point inside box b
	function indexAt(b, pt) {
		var d = boxData(b), l = toLocal(b, pt.x, pt.y), s = d.scale, f = fontOf(b);
		var ux = l.x / s, uy = l.y / s, carets = d.lay.carets;
		var bestLine = 0, bestDy = Infinity;
		carets.forEach(function (c) {
			var mid = c.y - f.cell.height / 2, dy = Math.abs(uy - mid);
			if (dy < bestDy) { bestDy = dy; bestLine = c.line; }
		});
		var best = carets.length - 1, bestDx = Infinity;
		carets.forEach(function (c, i) {
			if (c.line !== bestLine) return;
			var dx = Math.abs(ux - c.x);
			if (dx < bestDx) { bestDx = dx; best = i; }
		});
		return best;
	}

	// ------------------------------------------------------------ editing text

	function select(id) {
		if (state.editing && id !== state.selected) stopEditing();
		state.selected = id;
		refreshPanels();
		renderUI();
		renderTextList();
	}

	function startEditing(b, index) {
		if (state.editing && state.selected !== b.id) stopEditing();
		select(b.id);
		if (!state.editing) pushUndo();
		state.editing = true;
		var ta = $('text-input');
		ta.value = b.text;
		ta.focus({ preventScroll: true });
		var i = index === undefined ? b.text.length : index;
		ta.setSelectionRange(i, i);
		renderUI();
	}

	function stopEditing() {
		if (!state.editing) return;
		state.editing = false;
		$('text-input').blur();
		var b = selectedBox();
		if (b && !b.text.trim()) {
			doc.boxes.splice(doc.boxes.indexOf(b), 1);
			state.selected = null;
			refreshPanels();
		}
		$('canvas-wrap').focus({ preventScroll: true });
		changed();
	}

	// ------------------------------------------------------------ tools + mouse

	function setTool(name) {
		if (name !== 'text' && state.editing) stopEditing();
		state.tool = name;
		document.querySelectorAll('.tool').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === name); });
		$('canvas-wrap').classList.toggle('tool-text', name === 'text');
		$('canvas-wrap').classList.toggle('tool-hand', name === 'hand');
	}

	var spaceDown = false;

	svg.addEventListener('pointerdown', function (e) {
		if (state.play) stopPlay();
		var pt = eventPoint(e);
		$('canvas-wrap').focus({ preventScroll: true });
		if (e.button === 1 || state.tool === 'hand' || spaceDown) {
			state.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
			$('canvas-wrap').classList.add('panning');
		} else if (e.button !== 0) {
			return;
		} else if (state.editing && boxAt(pt) && boxAt(pt).id === state.selected) {
			// place the caret / start selecting text
			var b = selectedBox(), i = indexAt(b, pt), ta = $('text-input');
			ta.focus({ preventScroll: true });
			if (e.shiftKey) {
				var anchor = ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart;
				ta.setSelectionRange(Math.min(anchor, i), Math.max(anchor, i), i < anchor ? 'backward' : 'forward');
				state.drag = { mode: 'textsel', anchor: anchor };
			} else {
				ta.setSelectionRange(i, i);
				state.drag = { mode: 'textsel', anchor: i };
			}
			renderUI();
		} else if (state.tool === 'text') {
			var hit = boxAt(pt);
			if (hit) { startEditing(hit, indexAt(hit, pt)); state.drag = { mode: 'textsel', anchor: indexAt(hit, pt) }; }
			else state.drag = { mode: 'create', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
		} else {
			var handle = handleAt(pt);
			if (handle) {
				pushUndo();
				var hb = handle.box, d = boxData(hb);
				state.drag = { mode: 'width', box: hb, side: handle.side, w0: d.w, x0: hb.x, y0: hb.y, start: pt };
			} else {
				var box = boxAt(pt);
				if (box) {
					if (state.editing && box.id !== state.selected) stopEditing();
					select(box.id);
					pushUndo();
					state.drag = { mode: 'move', box: box, x0: box.x, y0: box.y, start: pt, moved: false };
				} else {
					if (state.editing) stopEditing();
					select(null);
				}
			}
		}
		if (state.drag) svg.setPointerCapture(e.pointerId);
	});

	svg.addEventListener('pointermove', function (e) {
		var pt = eventPoint(e), drag = state.drag;
		$('cursor-pos').textContent = 'x ' + Math.round(pt.x) + '  y ' + Math.round(pt.y) + ' px';
		if (!drag) {
			var wrap = $('canvas-wrap');
			var over = state.tool === 'select' && !state.editing && !spaceDown;
			wrap.classList.toggle('over-handle', over && !!handleAt(pt));
			wrap.classList.toggle('over-box', over && !handleAt(pt) && !!boxAt(pt));
			return;
		}
		if (drag.mode === 'pan') {
			state.panX = drag.px + e.clientX - drag.sx;
			state.panY = drag.py + e.clientY - drag.sy;
			applyView();
		} else if (drag.mode === 'move') {
			var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
			if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
			drag.box.x = Math.round(drag.x0 + dx);
			drag.box.y = Math.round(drag.y0 + dy);
			drag.moved = true;
			render();
			refreshPanels();
		} else if (drag.mode === 'width') {
			var b = drag.box, a = (b.rotation || 0) * Math.PI / 180;
			var along = (pt.x - drag.start.x) * Math.cos(a) + (pt.y - drag.start.y) * Math.sin(a);
			var w = drag.side === 'right' ? drag.w0 + along : drag.w0 - along;
			w = Math.max(Math.round(w), 10);
			if (drag.side === 'left') {
				var shift = drag.w0 - w;
				b.x = Math.round(drag.x0 + shift * Math.cos(a));
				b.y = Math.round(drag.y0 + shift * Math.sin(a));
			}
			b.width = w;
			render();
			refreshPanels();
		} else if (drag.mode === 'create') {
			drag.x1 = pt.x;
			drag.y1 = pt.y;
			uiLayer.querySelectorAll('.creating').forEach(function (n) { n.remove(); });
			el('rect', {
				class: 'creating', x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1),
				width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
				fill: 'none', stroke: '#2f6fe0', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke'
			}, uiLayer);
		} else if (drag.mode === 'textsel') {
			var sb = selectedBox();
			if (!sb) return;
			var i = indexAt(sb, pt), ta = $('text-input');
			ta.setSelectionRange(Math.min(drag.anchor, i), Math.max(drag.anchor, i), i < drag.anchor ? 'backward' : 'forward');
			renderUI();
		}
	});

	svg.addEventListener('pointerup', function () {
		var drag = state.drag;
		state.drag = null;
		$('canvas-wrap').classList.remove('panning');
		if (!drag) return;
		if (drag.mode === 'move' && !drag.moved) state.undo.pop();   // just a click
		if (drag.mode === 'move' || drag.mode === 'width') changed();
		if (drag.mode === 'create') {
			if (state.editing) stopEditing();
			pushUndo();
			var dragged = Math.abs(drag.x1 - drag.x0) > px(6);
			var b;
			if (dragged) {
				b = newBox(Math.round(Math.min(drag.x0, drag.x1)), Math.round(Math.min(drag.y0, drag.y1)), Math.round(Math.abs(drag.x1 - drag.x0)));
			} else {
				// a click: the text's baseline sits where you clicked
				b = newBox(Math.round(drag.x0), Math.round(drag.y0 - state.defaults.size), null);
			}
			// the undo step above is the one for this new box, so startEditing
			// mustn't add another
			state.selected = b.id;
			state.editing = true;
			changed();
			startEditing(b, 0);
		}
	});

	svg.addEventListener('dblclick', function (e) {
		var pt = eventPoint(e), b = boxAt(pt);
		if (b && state.tool === 'select') startEditing(b, indexAt(b, pt));
	});

	$('canvas-wrap').addEventListener('wheel', function (e) {
		e.preventDefault();
		var pt = eventPoint(e);
		zoomBy(Math.pow(1.0015, -e.deltaY), pt.sx, pt.sy);
	}, { passive: false });

	// text input
	$('text-input').addEventListener('input', function () {
		var b = selectedBox();
		if (!b || !state.editing) return;
		b.text = this.value;
		changed();
		refreshPanels();
	});
	document.addEventListener('selectionchange', function () {
		if (state.editing && document.activeElement === $('text-input')) renderUI();
	});

	// ------------------------------------------------------------ commands

	function deleteSelected() {
		var b = selectedBox();
		if (!b) return;
		pushUndo();
		state.editing = false;
		doc.boxes.splice(doc.boxes.indexOf(b), 1);
		state.selected = null;
		changed();
		refreshPanels();
	}

	function duplicateSelected() {
		var b = selectedBox();
		if (!b) return;
		if (state.editing) stopEditing();
		pushUndo();
		var c = JSON.parse(JSON.stringify(b));
		c.id = doc.nextId++;
		c.x += 24;
		c.y += 24;
		doc.boxes.push(c);
		changed();
		select(c.id);
	}

	function nudge(dx, dy) {
		var b = selectedBox();
		if (!b) return;
		pushUndo();
		b.x += dx;
		b.y += dy;
		changed();
		refreshPanels();
	}

	function newDocument() {
		if (doc.boxes.length && !window.confirm('Start a new page? The current one is only kept if you’ve saved it.')) return;
		pushUndo();
		doc = newDoc();
		cache = {};
		state.selected = null;
		state.editing = false;
		state.fileHandle = null;
		changed();
		refreshPanels();
		fitPage();
		setTool('text');
		setStatus('New page. Click with the Text tool to start typing.');
	}

	// --- save / open: the layout travels inside the SVG

	function slugName() {
		var first = doc.boxes.find(function (b) { return b.text.trim(); });
		var base = first ? first.text.trim().slice(0, 24).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '') : '';
		return (base || 'gregfont') + '.svg';
	}

	function xmlEscape(s) {
		return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
	}

	function buildSVG() {
		var page = doc.page, order = plotStrokes(doc.plot.optimize);
		var out = ['<?xml version="1.0" encoding="UTF-8"?>',
			'<svg xmlns="http://www.w3.org/2000/svg" width="' + page.width + 'px" height="' + page.height + 'px" viewBox="0 0 ' + page.width + ' ' + page.height + '">'];
		var title = doc.boxes.map(function (b) { return b.text.trim(); }).filter(Boolean)[0] || 'gregfont';
		out.push('<title>' + xmlEscape(title.slice(0, 80)) + '</title>');
		// the layout, so Open can bring it back (fonts are referenced by file name)
		var layout = JSON.stringify(doc).replace(/]]>/g, ']]]]><![CDATA[>');
		out.push('<metadata id="' + LAYOUT_ID + '"><![CDATA[' + layout + ']]></metadata>');
		function pathTag(o) {
			var s = o.s;
			return '<path d="' + (o.reverse ? reversedD(s) : s.d) + '" fill="none" stroke="' + s.colour + '" stroke-width="' + s.width +
				'" stroke-linecap="' + s.cap + '" stroke-linejoin="' + s.join + '" stroke-miterlimit="' + s.miter + '"/>';
		}
		if (doc.plot.optimize) {
			out.push('<g id="plot">');
			order.forEach(function (o) { out.push(pathTag(o)); });
			out.push('</g>');
		} else {
			doc.boxes.forEach(function (b, i) {
				out.push('<g id="text-' + (i + 1) + '">');
				order.forEach(function (o) { if (o.s.box === b.id) out.push(pathTag(o)); });
				out.push('</g>');
			});
		}
		out.push('</svg>');
		return out.join('\n') + '\n';
	}

	function saveSVG() {
		if (state.editing) stopEditing();
		var text = buildSVG();
		if (window.showSaveFilePicker) {
			var handle = state.fileHandle;
			(handle ? Promise.resolve(handle) : window.showSaveFilePicker({
				suggestedName: slugName(),
				types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }]
			})).then(function (h) {
				state.fileHandle = h;
				return h.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); }).then(function () { return h.name; });
			}).then(function (name) {
				setStatus('Saved ' + name);
			}, function (err) {
				if (err && err.name === 'AbortError') return;
				console.error(err);
				download(text);
			});
			return;
		}
		download(text);
	}

	function download(text) {
		var a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
		a.download = slugName();
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		setStatus('Downloaded ' + a.download);
	}

	function copySVG() {
		var text = buildSVG();
		var done = function () { setStatus('Copied the page as SVG'); };
		if (navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(done, fallback);
		} else fallback();
		function fallback() {
			var t = document.createElement('textarea');
			t.value = text;
			document.body.appendChild(t);
			t.select();
			document.execCommand('copy');
			t.remove();
			done();
		}
	}

	function openText(text, name) {
		var parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
		var meta = parsed.getElementById(LAYOUT_ID);
		if (!meta) { setStatus(name + ' has no gregfont layout in it, so it can’t be opened for editing', true); return; }
		var data;
		try { data = JSON.parse(meta.textContent); } catch (e) { setStatus('The layout in ' + name + ' is damaged', true); return; }
		if (data.format !== LAYOUT_ID || !Array.isArray(data.boxes)) { setStatus(name + ' isn’t a gregfont layout', true); return; }
		if (state.editing) stopEditing();
		pushUndo();
		doc = Object.assign(newDoc(), data);
		cache = {};
		state.selected = null;
		var missing = doc.boxes.filter(function (b) { return !fonts.some(function (f) { return f.file === b.font; }); })
			.map(function (b) { return b.font; });
		changed();
		refreshPanels();
		fitPage();
		setStatus('Opened ' + name + (missing.length ? '. Missing fonts (shown in ' + fonts[0].font.name + '): ' + missing.join(', ') : ''), missing.length > 0);
	}

	function openSVG() {
		if (window.showOpenFilePicker) {
			window.showOpenFilePicker({ types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }] }).then(function (handles) {
				var h = handles[0];
				return h.getFile().then(function (file) { return file.text().then(function (t) { state.fileHandle = h; openText(t, file.name); }); });
			}, function () { /* cancelled */ });
			return;
		}
		$('open-file').click();
	}

	// --- Play: draw the page stroke by stroke

	function play() {
		if (state.play) { stopPlay(); return; }
		if (state.editing) stopEditing();
		var order = plotStrokes(doc.plot.optimize);
		if (!order.length) { setStatus('Nothing to plot yet'); return; }
		inkLayer.style.display = 'none';
		travelLayer.style.display = 'none';
		playLayer.innerHTML = '';
		var items = order.map(function (o) {
			var s = o.s;
			var p = el('path', {
				d: o.reverse ? reversedD(s) : s.d, fill: 'none', stroke: s.colour, 'stroke-width': s.width,
				'stroke-linecap': s.cap, 'stroke-linejoin': s.join, 'stroke-miterlimit': s.miter
			}, playLayer);
			var len = p.getTotalLength() || 0.01;
			p.style.strokeDasharray = len + ' ' + len;
			p.style.strokeDashoffset = len;
			p.style.visibility = 'hidden';
			return { el: p, len: len, o: o };
		});
		var total = items.reduce(function (n, it) { return n + it.len; }, 0);
		var speed = total / Math.min(Math.max(total / 1500, 3), 20);   // px per second
		state.play = { items: items, i: 0, t0: performance.now(), speed: speed, done: 0, raf: 0, pos: null };
		$('play').textContent = '■ Stop';
		renderUI();
		state.play.raf = requestAnimationFrame(playFrame);
	}

	function playFrame() {
		var pl = state.play;
		if (!pl) return;
		var drawn = (performance.now() - pl.t0) / 1000 * pl.speed;
		while (pl.i < pl.items.length) {
			var it = pl.items[pl.i];
			if (it.el.style.visibility === 'hidden') {
				it.el.style.visibility = 'visible';
				var a = strokeStart(it.o);
				if (pl.pos && pl.pos.getDistance(a) > 0.5) {
					el('line', { x1: pl.pos.x, y1: pl.pos.y, x2: a.x, y2: a.y, stroke: '#e11d74', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke', opacity: 0.6 }, playLayer);
				}
			}
			var f = Math.min(1, (drawn - pl.done) / it.len);
			it.el.style.strokeDashoffset = it.len * (1 - f);
			if (f < 1) break;
			pl.done += it.len;
			pl.pos = strokeEnd(it.o);
			pl.i++;
		}
		if (pl.i >= pl.items.length) { setTimeout(stopPlay, 600); return; }
		pl.raf = requestAnimationFrame(playFrame);
	}

	function stopPlay() {
		if (!state.play) return;
		cancelAnimationFrame(state.play.raf);
		state.play = null;
		playLayer.innerHTML = '';
		inkLayer.style.display = '';
		travelLayer.style.display = '';
		$('play').textContent = '▶ Play';
		renderUI();
	}

	// ------------------------------------------------------------ panels

	function setSegmented(id, value) {
		$(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.value === value); });
	}

	function setField(id, v) {
		var input = $(id);
		if (document.activeElement === input || input.closest('.scrubbing')) return;
		input.value = v;
	}

	function refreshPanels() {
		var b = current(), sel = selectedBox(), entry = fontEntry(b.font), f = entry.font;
		var s = b.size / f.cell.height;
		$('type-title').textContent = sel ? 'Text ' + (doc.boxes.indexOf(sel) + 1) + ' of ' + doc.boxes.length : 'New text';
		$('type-sub').textContent = sel ? '' : 'settings for the next box';
		$('font-select').value = entry.file;
		$('font-meta').textContent = Object.keys(f.glyphs).length + ' glyphs · cell ' + f.cell.width + '×' + f.cell.height;
		setField('t-size', round(b.size));
		setField('t-pen', round(b.pen));
		setSegmented('t-cap', b.cap);
		setField('t-letter', round(b.letterSpacing * s));
		setField('t-track', round(b.tracking * s));
		setField('t-line', round(b.lineHeight * s));
		$('t-mono').checked = !!b.mono;
		setSegmented('t-align', b.align);
		setSegmented('t-case', b.textCase);
		document.querySelectorAll('#t-colours .swatch-button').forEach(function (btn) {
			btn.classList.toggle('active', btn.dataset.colour.toLowerCase() === String(b.colour).toLowerCase());
		});
		$('t-colour').value = /^#[0-9a-f]{6}$/i.test(b.colour) ? b.colour : '#141414';
		['t-x', 't-y', 't-w', 't-rot'].forEach(function (id) { $(id).disabled = !sel; });
		setField('t-x', sel ? Math.round(sel.x) : '');
		setField('t-y', sel ? Math.round(sel.y) : '');
		setField('t-w', sel && sel.width ? Math.round(sel.width) : '');
		setField('t-rot', sel ? round(sel.rotation || 0) : '');
		// page
		var page = doc.page;
		$('page-preset').value = page.preset || 'custom';
		setSegmented('page-orient', page.width >= page.height ? 'landscape' : 'portrait');
		setField('page-w', page.width);
		setField('page-h', page.height);
		setField('page-m', page.margin);
		$('plot-optimize').checked = !!doc.plot.optimize;
	}

	function renderTextList() {
		var list = $('text-list');
		list.innerHTML = '';
		doc.boxes.forEach(function (b) {
			var item = document.createElement('button');
			item.type = 'button';
			item.className = 'text-item' + (b.id === state.selected ? ' active' : '');
			var name = document.createElement('span');
			name.className = 'name';
			name.textContent = b.text.trim().split('\n')[0] || 'Empty text';
			var meta = document.createElement('span');
			meta.className = 'meta';
			meta.textContent = fontEntry(b.font).font.name + ' · ' + round(b.size) + ' px' + (b.width ? ' · wraps at ' + Math.round(b.width) : '');
			var remove = document.createElement('span');
			remove.className = 'remove';
			remove.textContent = '×';
			remove.title = 'Delete this text';
			remove.addEventListener('click', function (e) { e.stopPropagation(); select(b.id); deleteSelected(); });
			item.appendChild(name);
			item.appendChild(meta);
			item.appendChild(remove);
			item.addEventListener('click', function () { select(b.id); });
			item.addEventListener('dblclick', function () { setTool('select'); startEditing(b); });
			list.appendChild(item);
		});
	}

	// A change to the left panel: to the selected box (with undo) or to the
	// defaults for the next box.
	function changeSetting(fn, skipUndo) {
		var b = selectedBox();
		if (b && !skipUndo) pushUndo();
		fn(current());
		if (b) changed();
		refreshPanels();
	}

	// number fields: typing is one undo step, a whole drag is one undo step
	function bindNumber(id, apply) {
		var input = $(id), scrubbing = false;
		input.addEventListener('scrubstart', function () { if (selectedBox()) pushUndo(); scrubbing = true; });
		input.addEventListener('scrub', function () {
			var v = parseFloat(input.value);
			if (!isNaN(v)) changeSetting(function (b) { apply(b, v); }, true);
		});
		input.addEventListener('change', function () {
			var v = parseFloat(input.value);
			changeSetting(function (b) { apply(b, v); }, scrubbing);
			scrubbing = false;
		});
	}

	function scaleOf(b) { return b.size / fontEntry(b.font).font.cell.height; }

	function bindPanels() {
		document.querySelectorAll('.field[data-scrub]').forEach(GregUI.bindScrub);
		$('font-select').addEventListener('change', function () {
			var file = this.value;
			changeSetting(function (b) {
				var f = fontEntry(file).font;
				b.font = file;
				b.letterSpacing = f.spacing.letterSpacing;
				b.lineHeight = f.spacing.lineHeight;
				b.mono = !!f.spacing.monospaced;
			});
		});
		bindNumber('t-size', function (b, v) { if (v > 0) b.size = v; });
		bindNumber('t-pen', function (b, v) { if (v > 0) b.pen = v; });
		bindNumber('t-letter', function (b, v) { if (!isNaN(v)) b.letterSpacing = v / scaleOf(b); });
		bindNumber('t-track', function (b, v) { if (!isNaN(v)) b.tracking = v / scaleOf(b); });
		bindNumber('t-line', function (b, v) { if (v >= 0) b.lineHeight = v / scaleOf(b); });
		bindNumber('t-x', function (b, v) { if (!isNaN(v) && b.id) b.x = v; });
		bindNumber('t-y', function (b, v) { if (!isNaN(v) && b.id) b.y = v; });
		bindNumber('t-w', function (b, v) { if (b.id) b.width = isNaN(v) || v <= 0 ? null : v; });
		bindNumber('t-rot', function (b, v) { if (!isNaN(v) && b.id) b.rotation = v; });
		$('t-mono').addEventListener('change', function () {
			var on = this.checked;
			changeSetting(function (b) { b.mono = on; });
		});
		[['t-cap', 'cap'], ['t-align', 'align'], ['t-case', 'textCase']].forEach(function (pair) {
			$(pair[0]).querySelectorAll('button').forEach(function (btn) {
				btn.addEventListener('click', function () {
					changeSetting(function (b) { b[pair[1]] = btn.dataset.value; });
				});
			});
		});
		PEN_COLOURS.forEach(function (c) {
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'swatch-button';
			btn.dataset.colour = c;
			btn.style.background = c;
			btn.setAttribute('aria-label', 'Pen colour ' + c);
			btn.addEventListener('click', function () { changeSetting(function (b) { b.colour = c; }); });
			$('t-colours').insertBefore(btn, $('t-colours').lastElementChild);
		});
		$('t-colour').addEventListener('change', function () {
			var c = this.value;
			changeSetting(function (b) { b.colour = c; });
		});

		// page
		PRESETS.forEach(function (p) {
			var opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.name;
			$('page-preset').appendChild(opt);
		});
		var custom = document.createElement('option');
		custom.value = 'custom';
		custom.textContent = 'Custom';
		$('page-preset').appendChild(custom);
		function setPage(fn) {
			pushUndo();
			fn(doc.page);
			changed();
			refreshPanels();
		}
		$('page-preset').addEventListener('change', function () {
			var p = PRESETS.find(function (x) { return x.id === this.value; }, this);
			if (!p) { setPage(function (page) { page.preset = 'custom'; }); return; }
			setPage(function (page) {
				var landscape = page.width >= page.height;
				page.preset = p.id;
				page.width = landscape ? p.h : p.w;
				page.height = landscape ? p.w : p.h;
			});
			fitPage();
		});
		$('page-orient').querySelectorAll('button').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var page = doc.page, landscape = btn.dataset.value === 'landscape';
				if ((page.width >= page.height) === landscape) return;
				setPage(function (pg) { var w = pg.width; pg.width = pg.height; pg.height = w; });
				fitPage();
			});
		});
		[['page-w', 'width'], ['page-h', 'height'], ['page-m', 'margin']].forEach(function (pair) {
			var input = $(pair[0]), scrubbing = false;
			function apply() {
				var v = parseFloat(input.value);
				if (isNaN(v) || v < 0 || (pair[1] !== 'margin' && v < 10)) return;
				doc.page[pair[1]] = v;
				if (pair[1] !== 'margin') doc.page.preset = 'custom';
				changed();
			}
			input.addEventListener('scrubstart', function () { pushUndo(); scrubbing = true; });
			input.addEventListener('scrub', apply);
			input.addEventListener('change', function () { if (!scrubbing) pushUndo(); scrubbing = false; apply(); refreshPanels(); });
		});
		$('plot-optimize').addEventListener('change', function () {
			pushUndo();
			doc.plot.optimize = this.checked;
			changed();
		});
		$('play').addEventListener('click', play);
		$('copy-svg').addEventListener('click', copySVG);
		$('add-text').addEventListener('click', function (e) {
			e.preventDefault();
			setTool('text');
			setStatus('Click the page to place the text, or drag to make a box that wraps');
		});
	}

	// ------------------------------------------------------------ menus + keys

	function hasSelection() { return !!selectedBox(); }

	function setShowBoxes(on) { state.showBoxes = on; $('show-boxes').checked = on; renderUI(); }
	function setPlotPreview(on) { state.plotPreview = on; $('plot-preview').checked = on; renderTravel(); }
	function changeAlign(a) { changeSetting(function (b) { b.align = a; }); }
	function changeCase(c) { changeSetting(function (b) { b.textCase = c; }); }

	var MENUS = [
		{ title: 'File', items: [
			{ label: 'New page', run: newDocument },
			{ label: 'Open SVG…', key: 'Ctrl+O', run: openSVG },
			'-',
			{ label: 'Save SVG', key: 'Ctrl+S', run: saveSVG },
			{ label: 'Save SVG as…', key: 'Ctrl+Shift+S', run: function () { state.fileHandle = null; saveSVG(); } },
			{ label: 'Copy SVG', run: copySVG }
		] },
		{ title: 'Edit', items: [
			{ label: 'Undo', key: 'Ctrl+Z', run: undo, enabled: function () { return state.undo.length > 0; } },
			{ label: 'Redo', key: 'Ctrl+Shift+Z', run: redo, enabled: function () { return state.redo.length > 0; } },
			'-',
			{ label: 'Edit text', key: 'Enter', run: function () { var b = selectedBox(); if (b) startEditing(b); }, enabled: hasSelection },
			{ label: 'Duplicate text', key: 'Ctrl+D', run: duplicateSelected, enabled: hasSelection },
			{ label: 'Delete text', key: 'Del', run: deleteSelected, enabled: hasSelection },
			'-',
			{ label: 'Deselect', key: 'Esc', run: function () { if (state.editing) stopEditing(); select(null); }, enabled: hasSelection }
		] },
		{ title: 'Text', items: [
			{ label: 'New text box', key: 'T', run: function () { setTool('text'); } },
			'-',
			{ label: 'Align left', run: function () { changeAlign('left'); }, checked: function () { return current().align === 'left'; } },
			{ label: 'Align centre', run: function () { changeAlign('center'); }, checked: function () { return current().align === 'center'; } },
			{ label: 'Align right', run: function () { changeAlign('right'); }, checked: function () { return current().align === 'right'; } },
			'-',
			{ label: 'As typed', run: function () { changeCase('none'); }, checked: function () { return current().textCase === 'none'; } },
			{ label: 'UPPER CASE', run: function () { changeCase('upper'); }, checked: function () { return current().textCase === 'upper'; } },
			{ label: 'lower case', run: function () { changeCase('lower'); }, checked: function () { return current().textCase === 'lower'; } },
			'-',
			{ label: 'Monospaced', run: function () { changeSetting(function (b) { b.mono = !b.mono; }); }, checked: function () { return !!current().mono; } }
		] },
		{ title: 'View', items: [
			{ label: 'Zoom in', key: 'Ctrl+=', run: function () { zoomBy(1.25); } },
			{ label: 'Zoom out', key: 'Ctrl+-', run: function () { zoomBy(0.8); } },
			{ label: 'Fit page', key: 'Ctrl+0', run: fitPage },
			{ label: 'Actual size', key: 'Ctrl+1', run: function () { zoomBy(1 / state.zoom); } },
			'-',
			{ label: 'Show boxes', run: function () { setShowBoxes(!state.showBoxes); }, checked: function () { return state.showBoxes; } },
			{ label: 'Plot preview', run: function () { setPlotPreview(!state.plotPreview); }, checked: function () { return state.plotPreview; } },
			{ label: 'Play plot', run: play },
			'-',
			{ label: 'Light mode', run: toggleTheme, checked: function () { return GregUI.currentTheme() === 'light'; } }
		] },
		{ title: 'Help', items: [
			{ label: 'Show tips', run: function () { tips.setOn(!tips.on); }, checked: function () { return tips.on; } },
			{ label: 'Next tip', run: function () { tips.next(); }, enabled: function () { return tips.on; } }
		] }
	];

	function toggleTheme() {
		GregUI.setTheme(GregUI.currentTheme() === 'dark' ? 'light' : 'dark');
		renderUI();
	}

	document.addEventListener('keydown', function (e) {
		var ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
		if (e.code === 'Space' && !isTyping(e) && !spaceDown) { spaceDown = true; $('canvas-wrap').classList.add('panning'); e.preventDefault(); return; }
		if (ctrl && key === 's') { e.preventDefault(); if (e.shiftKey) state.fileHandle = null; saveSVG(); return; }
		if (ctrl && key === 'o') { e.preventDefault(); openSVG(); return; }
		if (state.editing && e.target === $('text-input')) {
			if (e.key === 'Escape') { e.preventDefault(); stopEditing(); setTool('select'); }
			return;   // the textarea handles everything else, undo included
		}
		if (isTyping(e)) return;
		if (ctrl && (key === '=' || key === '+')) { e.preventDefault(); zoomBy(1.25); return; }
		if (ctrl && key === '-') { e.preventDefault(); zoomBy(0.8); return; }
		if (ctrl && key === '0') { e.preventDefault(); fitPage(); return; }
		if (ctrl && key === '1') { e.preventDefault(); zoomBy(1 / state.zoom); return; }
		if (ctrl && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
		if (ctrl && key === 'y') { e.preventDefault(); redo(); return; }
		if (ctrl && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
		if (ctrl) return;
		var step = e.shiftKey ? 10 : 1;
		switch (key) {
			case 'v': setTool('select'); break;
			case 't': setTool('text'); break;
			case 'h': setTool('hand'); break;
			case 'enter': { var b = selectedBox(); if (b) { e.preventDefault(); startEditing(b); } break; }
			case 'escape': if (state.play) stopPlay(); else select(null); break;
			case 'delete': case 'backspace': e.preventDefault(); deleteSelected(); break;
			case 'arrowleft': e.preventDefault(); nudge(-step, 0); break;
			case 'arrowright': e.preventDefault(); nudge(step, 0); break;
			case 'arrowup': e.preventDefault(); nudge(0, -step); break;
			case 'arrowdown': e.preventDefault(); nudge(0, step); break;
			default: return;
		}
	});
	document.addEventListener('keyup', function (e) {
		if (e.code === 'Space') { spaceDown = false; $('canvas-wrap').classList.remove('panning'); }
	});

	// ------------------------------------------------------------ start

	function start(list) {
		fonts = list;
		if (!fonts.length) { setStatus('No fonts found', true); return; }
		fonts.forEach(function (f) {
			var opt = document.createElement('option');
			opt.value = f.file;
			opt.textContent = f.font.name;
			$('font-select').appendChild(opt);
		});
		var saved = null;
		try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* ignore */ }
		state.defaults = makeDefaults(fonts[0].file);
		if (saved && saved.format === LAYOUT_ID && Array.isArray(saved.boxes)) doc = Object.assign(newDoc(), saved);
		else starterDoc();
		bindPanels();
		GregUI.buildMenus($('menubar'), MENUS, $('canvas-wrap'));
		GregUI.rememberFolds(document, 'gregfont-typesetter-open-');
		tips = new GregUI.Tips($('tip'), 'gregfont-typesetter-tips');
		tips.setList(TIPS);
		document.querySelectorAll('.tool').forEach(function (b) {
			b.addEventListener('click', function () { setTool(b.dataset.tool); });
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
		});
		$('theme-toggle').addEventListener('click', toggleTheme);
		$('save').addEventListener('click', saveSVG);
		$('open-file').addEventListener('change', function () {
			var file = this.files[0];
			this.value = '';
			if (file) file.text().then(function (t) { openText(t, file.name); });
		});
		$('show-boxes').addEventListener('change', function () { setShowBoxes(this.checked); });
		$('plot-preview').addEventListener('change', function () { setPlotPreview(this.checked); });
		$('zoom-in').addEventListener('click', function () { zoomBy(1.25); });
		$('zoom-out').addEventListener('click', function () { zoomBy(0.8); });
		$('zoom-fit').addEventListener('click', fitPage);
		setTool('select');
		render();
		refreshPanels();
		fitPage();
		new ResizeObserver(function () { applyView(); }).observe($('canvas-wrap'));
	}

	GregFont.loadAll('fonts/').then(start).catch(function (err) {
		console.error(err);
		setStatus('Could not load fonts: ' + err.message, true);
	});
})();
