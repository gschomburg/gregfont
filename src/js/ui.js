/*
 * ui.js: pieces of interface shared by the editor and the typesetter
 * (global GregUI): the menu bar, draggable number fields, the tip line,
 * light / dark theme, and foldable sections that remember being open.
 */
(function (global) {
	'use strict';

	// --- menu bar
	//
	// menus: [{ title, items: [item | '-'] }], item: { label, key, run,
	// enabled(), checked() }. The keys are only labels; each page handles its
	// own shortcuts. focusEl gets keyboard focus back after a command.
	function buildMenus(bar, menus, focusEl) {
		var openMenu = null;

		function close() {
			if (openMenu) openMenu.classList.remove('open');
			openMenu = null;
		}

		function open(m) {
			close();
			m.querySelectorAll('.menu-item').forEach(function (b) {
				var item = b.item;
				b.disabled = item.enabled ? !item.enabled() : false;
				b.classList.toggle('checked', !!(item.checked && item.checked()));
			});
			m.classList.add('open');
			openMenu = m;
		}

		menus.forEach(function (menu) {
			var m = document.createElement('div');
			m.className = 'menu';
			var title = document.createElement('button');
			title.type = 'button';
			title.className = 'menu-title';
			title.textContent = menu.title;
			// mousedown (with preventDefault) so keyboard focus stays put
			title.addEventListener('mousedown', function (e) {
				e.preventDefault();
				if (openMenu === m) close(); else open(m);
			});
			title.addEventListener('mouseenter', function () {
				if (openMenu && openMenu !== m) open(m);
			});
			var list = document.createElement('div');
			list.className = 'menu-items';
			menu.items.forEach(function (item) {
				if (item === '-') {
					var sep = document.createElement('div');
					sep.className = 'menu-sep';
					list.appendChild(sep);
					return;
				}
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'menu-item';
				b.item = item;
				var label = document.createElement('span');
				label.textContent = item.label;
				var key = document.createElement('span');
				key.className = 'shortcut';
				key.textContent = item.key || '';
				b.appendChild(label);
				b.appendChild(key);
				b.addEventListener('mousedown', function (e) { e.preventDefault(); });
				b.addEventListener('click', function () {
					close();
					if (focusEl) focusEl.focus({ preventScroll: true });
					item.run();
				});
				list.appendChild(b);
			});
			m.appendChild(title);
			m.appendChild(list);
			bar.appendChild(m);
		});

		document.addEventListener('mousedown', function (e) {
			if (openMenu && !bar.contains(e.target)) close();
		}, true);
		document.addEventListener('keydown', function (e) {
			if (openMenu && e.key === 'Escape') { close(); e.stopPropagation(); }
		}, true);
	}

	// --- draggable number fields
	//
	// Fields marked data-scrub="x" (sideways) or "y" (up raises the value) can
	// be dragged to change them; a click without dragging still lets you type.
	// While dragging, the input gets 'scrubstart' and 'scrub' events, then one
	// 'change' when the mouse is released. Shift drags in bigger steps, Alt in
	// smaller ones.
	function bindScrub(field) {
		var input = field.querySelector('input');
		if (!input || field.dataset.scrubBound) return;
		field.dataset.scrubBound = '1';
		var vertical = field.dataset.scrub === 'y';
		field.addEventListener('pointerdown', function (e) {
			if (e.button !== 0 || input.disabled || document.activeElement === input) return;
			e.preventDefault();
			var x0 = e.clientX, y0 = e.clientY, start = parseFloat(input.value) || 0;
			var step = parseFloat(input.step) || 1, min = parseFloat(input.min), scrubbing = false;
			try { field.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
			function move(ev) {
				var d = vertical ? y0 - ev.clientY : ev.clientX - x0;
				if (!scrubbing && Math.abs(d) < 3) return;
				if (!scrubbing) {
					scrubbing = true;
					field.classList.add('scrubbing');
					input.dispatchEvent(new Event('scrubstart'));
				}
				var mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
				var v = start + Math.round(d / 3) * step * mult;
				if (!isNaN(min)) v = Math.max(min, v);
				v = Math.round(v * 1000) / 1000;
				if (String(v) !== input.value) {
					input.value = v;
					input.dispatchEvent(new Event('scrub'));
				}
			}
			function up() {
				field.removeEventListener('pointermove', move);
				field.removeEventListener('pointerup', up);
				field.removeEventListener('pointercancel', up);
				field.classList.remove('scrubbing');
				if (scrubbing) {
					field.dataset.justScrubbed = '1';
					input.dispatchEvent(new Event('change'));
				} else {
					input.focus();
					input.select();
				}
			}
			field.addEventListener('pointermove', move);
			field.addEventListener('pointerup', up);
			field.addEventListener('pointercancel', up);
		});
		// the label's own click would focus the input after a drag
		field.addEventListener('click', function (e) {
			if (field.dataset.justScrubbed) { e.preventDefault(); delete field.dataset.justScrubbed; }
		});
	}

	// --- tips: one at a time, cycling
	function Tips(el, storageKey) {
		var self = this;
		this.el = el;
		this.key = storageKey;
		this.list = [];
		this.i = 0;
		this.timer = 0;
		this.on = true;
		try { this.on = localStorage.getItem(storageKey) !== '0'; } catch (e) { /* ignore */ }
		el.addEventListener('click', function () { self.next(); });
		el.addEventListener('mousedown', function (e) { e.preventDefault(); });
	}
	Tips.prototype.setList = function (list) {
		this.list = list;
		this.i = 0;
		this.show(false);
	};
	Tips.prototype.show = function (fade) {
		var self = this, el = this.el;
		clearTimeout(this.timer);
		if (!this.on || !this.list.length) { el.textContent = ''; el.classList.add('off'); return; }
		el.classList.remove('off');
		var text = this.list[this.i % this.list.length];
		function put() {
			el.textContent = text;
			el.classList.remove('fading');
		}
		if (fade) { el.classList.add('fading'); setTimeout(put, 250); } else put();
		this.timer = setTimeout(function () { self.i++; self.show(true); }, 8000);
	};
	Tips.prototype.next = function () {
		this.i++;
		this.show(true);
	};
	Tips.prototype.setOn = function (on) {
		this.on = on;
		try { localStorage.setItem(this.key, on ? '1' : '0'); } catch (e) { /* ignore */ }
		this.show(false);
	};

	// --- light / dark (shared by both pages)
	var THEME_KEY = 'gregfont-theme';

	function currentTheme() {
		return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	}

	function setTheme(theme) {
		document.documentElement.dataset.theme = theme;
		try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
	}

	// --- foldable sections: <details data-remember="name"> keep their state
	function rememberFolds(root, prefix) {
		(root || document).querySelectorAll('details[data-remember]').forEach(function (d) {
			var key = prefix + d.dataset.remember;
			try {
				var saved = localStorage.getItem(key);
				if (saved !== null) d.open = saved === '1';
			} catch (e) { /* ignore */ }
			d.addEventListener('toggle', function () {
				try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) { /* ignore */ }
			});
		});
	}

	// --- the version, on hover over the name in the top bar
	function showVersion() {
		var v = global.GREGFONT_VERSION, brand = document.querySelector('#topbar .brand');
		if (!v || !brand) return;
		brand.title = 'gregfont ' + v.version + ' · ' + v.date;
	}
	showVersion();

	global.GregUI = {
		buildMenus: buildMenus,
		bindScrub: bindScrub,
		Tips: Tips,
		THEME_KEY: THEME_KEY,
		currentTheme: currentTheme,
		setTheme: setTheme,
		rememberFolds: rememberFolds
	};
})(window);
