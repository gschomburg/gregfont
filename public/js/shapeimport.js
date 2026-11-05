/*
 * New font from shapes (global GregShapeImport): a window over the editor
 * that shows every shape in an SVG as a tile. Select a tile and press the
 * key for its glyph; it moves to the end and the next shape is selected.
 *
 * GregShapeImport.open({ paper, svgText, fileName, onCreate(font), onClose() })
 */
(function (global) {
	'use strict';

	var $ = function (id) { return document.getElementById(id); };
	var NS = 'http://www.w3.org/2000/svg';
	var TILE_W = 80, TILE_H = 96;

	var st = null;   // the open import, or null

	function el(tag, attrs, parent) {
		var e = document.createElementNS(NS, tag);
		Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
		if (parent) parent.appendChild(e);
		return e;
	}

	function shapeById(id) { return st.shapes.find(function (s) { return s.id === id; }); }

	function baselineOf(s) { return st.rows[s.row].baseline + (st.rows[s.row].shift || 0); }

	function label(ch) {
		if (ch.length > 1) return ch;
		var name = GregFont.GLYPH_NAMES[ch];
		return name ? ch + '  ' + name : ch;
	}

	// --- order: to do (reading order), then done (in the order named), then skipped
	function todo() { return st.shapes.filter(function (s) { return !st.assign[s.id] && !st.skip[s.id]; }); }
	function done() { return st.doneOrder.map(shapeById); }
	function skipped() { return st.shapes.filter(function (s) { return st.skip[s.id]; }); }
	function visual() { return todo().concat(done(), skipped()); }

	function nextTodoAfter(s) {
		var list = todo();
		if (!list.length) return null;
		var after = list.find(function (t) { return st.shapes.indexOf(t) > st.shapes.indexOf(s); });
		return after || list[0];
	}

	// --- naming
	function assign(id, ch) {
		var note = '';
		Object.keys(st.assign).forEach(function (other) {
			if (st.assign[other] === ch && Number(other) !== id) {
				delete st.assign[other];
				st.doneOrder = st.doneOrder.filter(function (x) { return x !== Number(other); });
				note = label(ch) + ' moved from shape ' + other + ', which is back in To do';
			}
		});
		st.assign[id] = ch;
		delete st.skip[id];
		st.doneOrder = st.doneOrder.filter(function (x) { return x !== id; });
		st.doneOrder.push(id);
		var next = nextTodoAfter(shapeById(id));
		st.sel = next ? next.id : id;
		st.multi = {};
		render();
		hint(note);
	}

	function clear(id) {
		delete st.assign[id];
		delete st.skip[id];
		st.doneOrder = st.doneOrder.filter(function (x) { return x !== id; });
		render();
	}

	function toggleSkip(id) {
		if (st.skip[id]) { delete st.skip[id]; render(); return; }
		delete st.assign[id];
		st.doneOrder = st.doneOrder.filter(function (x) { return x !== id; });
		st.skip[id] = true;
		var next = nextTodoAfter(shapeById(id));
		if (next) st.sel = next.id;
		render();
	}

	// an i and its dot drawn as separate shapes: make them one
	function merge() {
		var ids = Object.keys(st.multi).map(Number);
		if (ids.indexOf(st.sel) < 0) ids.push(st.sel);
		if (ids.length < 2) { hint('Shift-click the shapes to merge, then Ctrl+G'); return; }
		ids.sort(function (a, b) { return st.shapes.indexOf(shapeById(a)) - st.shapes.indexOf(shapeById(b)); });
		var keep = shapeById(ids[0]), groupBase = 0;
		keep.entries.forEach(function (e) { groupBase = Math.max(groupBase, e.group || 0); });
		ids.slice(1).forEach(function (id) {
			var s = shapeById(id), top = 0;
			s.entries.forEach(function (e) {
				var c = Object.assign({}, e);
				if (c.group) { c.group += groupBase; top = Math.max(top, c.group); }
				keep.entries.push(c);
			});
			groupBase = Math.max(groupBase, top);
			keep.ink = keep.ink.unite(s.ink);
			st.shapes.splice(st.shapes.indexOf(s), 1);
			delete st.assign[id];
			delete st.skip[id];
			st.doneOrder = st.doneOrder.filter(function (x) { return x !== id; });
		});
		st.multi = {};
		st.sel = keep.id;
		computeScale();
		render();
		hint('Merged ' + ids.length + ' shapes into shape ' + keep.id);
	}

	// --- drawing
	function computeScale() {
		var upMax = 1, downMax = 0, wMax = 1;
		st.shapes.forEach(function (s) {
			var b = baselineOf(s);
			upMax = Math.max(upMax, b - s.ink.y);
			downMax = Math.max(downMax, s.ink.y + s.ink.height - b);
			wMax = Math.max(wMax, s.ink.width);
		});
		var pad = 8;
		st.scale = Math.min((TILE_H - pad * 2) / (upMax + downMax), (TILE_W - pad * 2) / wMax);
		st.baseY = pad + upMax * st.scale;
	}

	function tile(s) {
		var ch = st.assign[s.id], isSkip = !!st.skip[s.id];
		var btn = document.createElement('div');
		btn.className = 'si-tile' + (s.id === st.sel ? ' selected' : '') + (st.multi[s.id] ? ' picked' : '') +
			(ch ? ' named' : '') + (isSkip ? ' skipped' : '');
		btn.dataset.id = s.id;
		btn.setAttribute('role', 'option');
		btn.setAttribute('aria-selected', s.id === st.sel ? 'true' : 'false');
		btn.title = 'Shape ' + s.id + ' (row ' + (s.row + 1) + ')';
		var svg = el('svg', { width: TILE_W, height: TILE_H, viewBox: '0 0 ' + TILE_W + ' ' + TILE_H, 'aria-hidden': 'true' });
		var b = baselineOf(s), k = st.scale;
		var cx = TILE_W / 2 - (s.ink.x + s.ink.width / 2) * k;
		var line = el('line', { x1: 0, x2: TILE_W, y1: st.baseY, y2: st.baseY, class: 'si-baseline' }, svg);
		line.dataset.row = s.row;
		var g = el('g', { transform: 'translate(' + cx + ' ' + (st.baseY - b * k) + ') scale(' + k + ')' }, svg);
		s.entries.forEach(function (e) {
			el('path', {
				d: e.d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke',
				'stroke-linecap': e.strokeCap || 'round', 'stroke-linejoin': e.strokeJoin || 'round'
			}, g);
		});
		// a fat invisible line over the baseline, to drag it
		var grab = el('line', { x1: 0, x2: TILE_W, y1: st.baseY, y2: st.baseY, class: 'si-baseline-grab' }, svg);
		grab.dataset.row = s.row;
		btn.appendChild(svg);
		var cap = document.createElement('div');
		cap.className = 'si-caption';
		var num = document.createElement('span');
		num.className = 'si-num';
		num.textContent = s.id;
		var name = document.createElement('span');
		name.className = 'si-char';
		name.textContent = isSkip ? 'skip' : ch ? (ch.length > 1 ? ch : ch === ' ' ? 'space' : ch) : '?';
		cap.appendChild(num);
		cap.appendChild(name);
		btn.appendChild(cap);
		return btn;
	}

	function section(title, list, box) {
		if (!list.length) return;
		var h = document.createElement('div');
		h.className = 'si-group panel-heading';
		h.textContent = title + ' · ' + list.length;
		box.appendChild(h);
		list.forEach(function (s) { box.appendChild(tile(s)); });
	}

	function render() {
		computeScale();
		var box = $('si-tiles'), scroll = box.scrollTop;
		box.innerHTML = '';
		section('To do', todo(), box);
		section('Done', done(), box);
		section('Skipped', skipped(), box);
		box.scrollTop = scroll;
		var selEl = box.querySelector('.si-tile.selected');
		if (selEl) selEl.scrollIntoView({ block: 'nearest' });
		renderSide();
	}

	function renderSide() {
		var s = shapeById(st.sel);
		var named = Object.keys(st.assign).length, skips = Object.keys(st.skip).length, left = todo().length;
		$('si-count').textContent = named + ' named · ' + left + ' to do' + (skips ? ' · ' + skips + ' skipped' : '');
		$('si-create').textContent = named ? 'Create font with ' + named + ' glyph' + (named === 1 ? '' : 's') : 'Create font';
		$('si-create').disabled = !named;
		if (s) {
			var ch = st.assign[s.id];
			$('si-selected').textContent = 'Shape ' + s.id + ' · row ' + (s.row + 1) + ' · ' +
				(st.skip[s.id] ? 'skipped' : ch ? label(ch) : 'no glyph yet');
			var input = $('si-baseline');
			if (document.activeElement !== input) input.value = st.rows[s.row].shift || 0;
		}
		// the character map
		var map = $('si-map');
		map.innerHTML = '';
		var used = {};
		Object.keys(st.assign).forEach(function (id) { used[st.assign[id]] = Number(id); });
		var chars = GregFont.STANDARD_ORDER.concat(Object.keys(used).filter(function (c) { return GregFont.STANDARD_ORDER.indexOf(c) < 0; }));
		chars.forEach(function (c) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'si-map-cell' + (used[c] ? ' filled' : '') + (s && st.assign[s.id] === c ? ' current' : '');
			b.textContent = c.length > 1 ? c : c;
			b.title = used[c] ? label(c) + ': shape ' + used[c] + ' (click to go to it)' : label(c) + ': not drawn yet (click to give it to the selected shape)';
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
			b.addEventListener('click', function () {
				if (used[c]) { st.sel = used[c]; st.multi = {}; render(); }
				else if (st.sel) assign(st.sel, c);
			});
			map.appendChild(b);
		});
	}

	function hint(text) {
		var h = $('si-hint');
		h.textContent = text || h.dataset.default;
		h.classList.toggle('note', !!text);
	}

	// --- keys: everything typed goes to the tiles, not the editor
	function onKey(e) {
		if (!st) return;
		var t = e.target;
		var typing = t && $('shape-import').contains(t) && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
		if (typing) {
			if (e.key === 'Escape') { t.blur(); e.preventDefault(); }
			e.stopImmediatePropagation();        // the field gets it; the editor doesn't
			return;
		}
		var ctrl = e.ctrlKey || e.metaKey;
		// leave the browser's own reload and dev tools alone
		if (e.key === 'F5' || e.key === 'F12' || (ctrl && (e.key === 'r' || e.key === 'R')) || (ctrl && e.shiftKey && /^[ij]$/i.test(e.key))) return;
		e.stopImmediatePropagation();
		var s = shapeById(st.sel);
		if (ctrl && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); merge(); return; }
		if (ctrl && e.key === 'Enter') { e.preventDefault(); create(); return; }
		if (ctrl || e.altKey) { if (ctrl) e.preventDefault(); return; }
		if (e.key === 'Escape') {
			e.preventDefault();
			if (Object.keys(st.multi).length) { st.multi = {}; render(); }
			else if (!Object.keys(st.assign).length) close();
			else hint('Cancel closes without making a font; Create font makes it');
			return;
		}
		if (!s) return;
		if (e.key === 'Backspace') { e.preventDefault(); clear(s.id); return; }
		if (e.key === 'Delete') { e.preventDefault(); toggleSkip(s.id); return; }
		if (/^Arrow/.test(e.key)) { e.preventDefault(); move(e.key); return; }
		if (e.key === 'Tab') {
			e.preventDefault();
			var next = e.shiftKey ? null : nextTodoAfter(s);
			if (next) { st.sel = next.id; render(); }
			return;
		}
		if (e.key.length === 1 && e.key !== ' ') { e.preventDefault(); assign(s.id, e.key); }
	}

	function move(key) {
		var list = visual(), i = list.indexOf(shapeById(st.sel));
		var box = $('si-tiles'), first = box.querySelector('.si-tile');
		var cols = first ? Math.max(1, Math.floor((box.clientWidth - 28) / (first.offsetWidth + 8))) : 1;
		var d = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : cols;
		var j = Math.min(Math.max(i + d, 0), list.length - 1);
		st.sel = list[j].id;
		st.multi = {};
		render();
	}

	// --- clicks and the baseline drag
	function onPointerDown(e) {
		var grab = e.target.closest && e.target.closest('.si-baseline-grab');
		var t = e.target.closest && e.target.closest('.si-tile');
		if (!t) return;
		var id = Number(t.dataset.id);
		if (grab) {
			e.preventDefault();
			var row = st.rows[Number(grab.dataset.row)], y0 = e.clientY, shift0 = row.shift || 0;
			st.sel = id;
			var moveFn = function (ev) {
				row.shift = Math.round((shift0 + (y0 - ev.clientY) / st.scale) * 2) / 2;   // up raises the line
				render();
			};
			var upFn = function () { window.removeEventListener('pointermove', moveFn); window.removeEventListener('pointerup', upFn); };
			window.addEventListener('pointermove', moveFn);
			window.addEventListener('pointerup', upFn);
			render();
			return;
		}
		if (e.shiftKey) {
			if (st.multi[id]) delete st.multi[id]; else st.multi[id] = true;
			if (st.sel && st.sel !== id) st.multi[st.sel] = true;
		} else {
			st.multi = {};
		}
		st.sel = id;
		document.activeElement && document.activeElement.blur && $('shape-import').contains(document.activeElement) && document.activeElement.blur();
		render();
	}

	// --- open / create / close
	function create() {
		var picks = Object.keys(st.assign).map(function (id) {
			var s = shapeById(Number(id));
			return { ch: st.assign[id], entries: s.entries, ink: s.ink, baseline: baselineOf(s) };
		});
		if (!picks.length) { hint('Name at least one shape first'); return; }
		var font = GregFont.fontFromShapes(st.paper, picks, { name: $('si-name').value.trim() || 'Untitled' });
		var cb = st.onCreate;
		close();
		cb(font);
	}

	function close() {
		if (!st) return;
		var cb = st.onClose;
		st = null;
		$('shape-import').hidden = true;
		$('si-tiles').innerHTML = '';
		if (cb) cb();
	}

	function cancel() {
		if (st && Object.keys(st.assign).length > 3 && !window.confirm('Close without making the font? The names you’ve given the shapes will be lost.')) return;
		close();
	}

	var bound = false;
	function bindOnce() {
		if (bound) return;
		bound = true;
		document.addEventListener('keydown', onKey, true);
		$('si-tiles').addEventListener('pointerdown', onPointerDown);
		$('si-close').addEventListener('click', cancel);
		$('si-cancel').addEventListener('click', cancel);
		$('si-create').addEventListener('click', create);
		$('si-name-form').addEventListener('submit', function (e) {
			e.preventDefault();
			var v = $('si-glyph-name').value.trim();
			if (!v || !st.sel) return;
			$('si-glyph-name').value = '';
			$('si-glyph-name').blur();
			assign(st.sel, v.length === 1 ? v : (GregFont.charFromLayerName('char-' + v) || v));
		});
		var input = $('si-baseline');
		GregUI.bindScrub(input.closest('.field'));
		['scrub', 'change'].forEach(function (type) {
			input.addEventListener(type, function () {
				var s = st && shapeById(st.sel), v = parseFloat(input.value);
				if (!s || isNaN(v)) return;
				st.rows[s.row].shift = v;
				render();
			});
		});
		$('si-hint').dataset.default = $('si-hint').textContent;
	}

	function open(opts) {
		bindOnce();
		var result = GregFont.shapesFromSVG(opts.paper, opts.svgText);
		if (!result.shapes.length) throw new Error('No shapes found in ' + opts.fileName);
		st = {
			paper: opts.paper, onCreate: opts.onCreate, onClose: opts.onClose,
			shapes: result.shapes, rows: result.rows.map(function (r) { return { baseline: r.baseline, shift: 0 }; }),
			assign: {}, skip: {}, doneOrder: [], multi: {}, sel: result.shapes[0].id
		};
		var base = opts.fileName.replace(/\.svg$/i, '');
		$('si-name').value = base.charAt(0).toUpperCase() + base.slice(1);
		$('si-file').textContent = opts.fileName + ' · ' + result.shapes.length + ' shapes · ' + result.rows.length + ' row' + (result.rows.length === 1 ? '' : 's');
		$('si-warnings').textContent = result.warnings.join('. ');
		$('si-warnings').hidden = !result.warnings.length;
		$('shape-import').hidden = false;
		computeScale();
		hint('');
		render();
		if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
	}

	global.GregShapeImport = { open: open, isOpen: function () { return !!st; } };
})(window);
