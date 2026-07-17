// ==UserScript==
// @name         linux.do 等级贴过滤
// @namespace    https://github.com/airline233/linuxdo-level-filter
// @version      1.2.0
// @description  按用户等级(Lv1/Lv2/Lv3)统一过滤帖子列表,一处开关搞定所有受限子版块
// @author       airline233
// @match        https://linux.do/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ld-level-filter-v2';
  const LEVELS = ['public', '1', '2', '3'];
  const LABELS = { public: '公开', 1: 'Lv1', 2: 'Lv2', 3: 'Lv3' };

  // 明确的非列表路由前缀。帖子详情(/t/) 底部的相关推荐也有 .topic-list,
  // 所以不能单靠 DOM 判断,必须先用路径挡掉。
  const NON_LIST_RE =
    /^\/(t|u|my|admin|g|groups|badges|about|faq|tos|privacy|login|signup|auth|session|review|chat|search|invites|email|guidelines|rules|user-api-key|wizard|tag-groups|static)\b/i;

  // 主列表容器。用 #list-area / .list-container 定位,天然避开
  // 帖子详情页底部 #suggested-topics / .more-topics 里的相关推荐。
  const LIST_SEL = '#list-area .topic-list, .list-container .topic-list';
  const ITEM_SEL = '.topic-list-item, tr.topic-list-item';

  // ---- 状态(单一 storage) ----
  const DEFAULTS = {
    levels: { public: true, 1: true, 2: true, 3: true },
    kw: { mode: 'white', text: '' },
    collapsed: false,
    pos: null,
  };

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && typeof raw === 'object') {
        return {
          levels: { ...DEFAULTS.levels, ...(raw.levels || {}) },
          kw: {
            mode: raw.kw?.mode === 'black' ? 'black' : 'white',
            text: raw.kw?.text || '',
          },
          collapsed: !!raw.collapsed,
          pos:
            raw.pos &&
            typeof raw.pos.left === 'number' &&
            typeof raw.pos.top === 'number'
              ? raw.pos
              : null,
        };
      }
    } catch (e) {}

    // 兼容 v1 的分散 key
    try {
      const legacy = {
        levels: JSON.parse(localStorage.getItem('ld-level-filter')),
        kw: JSON.parse(localStorage.getItem('ld-level-filter-kw')),
        collapsed: localStorage.getItem('ld-level-filter-collapse') === '1',
        pos: JSON.parse(localStorage.getItem('ld-level-filter-pos')),
      };
      if (legacy.levels || legacy.kw || legacy.pos) {
        const migrated = {
          levels: { ...DEFAULTS.levels, ...(legacy.levels || {}) },
          kw: {
            mode: legacy.kw?.mode === 'black' ? 'black' : 'white',
            text: legacy.kw?.text || '',
          },
          collapsed: !!legacy.collapsed,
          pos:
            legacy.pos &&
            typeof legacy.pos.left === 'number' &&
            typeof legacy.pos.top === 'number'
              ? legacy.pos
              : null,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (e) {}

    return structuredClone
      ? structuredClone(DEFAULTS)
      : JSON.parse(JSON.stringify(DEFAULTS));
  }

  let store = loadState();
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

  // ---- 工具 ----
  function parseKeywords(str) {
    return (str || '')
      .split(/[,，\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function isFilterActive() {
    return (
      LEVELS.some((lv) => !store.levels[lv]) ||
      parseKeywords(store.kw.text).length > 0
    );
  }

  // ---- 等级识别: 只在打标时算一次 ----
  function levelOf(item) {
    const badges = item.querySelectorAll(
      '.badge-category.restricted, .badge-category--restricted'
    );
    let level = null;
    badges.forEach((b) => {
      let m = (b.getAttribute('title') || '').match(/(\d+)\s*级用户/);
      if (!m) m = (b.textContent || '').match(/Lv\s*(\d)/i);
      if (!m) {
        const link = b.closest('a[href]');
        if (link) m = (link.getAttribute('href') || '').match(/-lv(\d)/i);
      }
      if (m) {
        const n = parseInt(m[1], 10);
        if (level === null || n > level) level = n;
      } else if (level === null) {
        level = 0; // 有锁但没读到数字
      }
    });
    if (level === null) return 'public';
    if (level >= 1 && level <= 3) return String(level);
    return 'public'; // 未知档暂归公开,避免误杀
  }

  function titleOf(item) {
    const el = item.querySelector(
      '.title, .topic-list-item-title, a.raw-topic-link, .link-top-line a'
    );
    return (el ? el.textContent : item.textContent || '').toLowerCase();
  }

  // 增量打标: WeakSet 记已处理节点,新帖只算一次等级
  const tagged = new WeakSet();

  function tagItems(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const items =
      scope === document || scope.matches?.(ITEM_SEL)
        ? [
            ...(scope.matches?.(ITEM_SEL) ? [scope] : []),
            ...scope.querySelectorAll(ITEM_SEL),
          ]
        : [...scope.querySelectorAll(ITEM_SEL)];

    for (const item of items) {
      if (tagged.has(item)) continue;
      item.dataset.ldLevel = levelOf(item);
      tagged.add(item);
    }
  }

  // ---- 过滤 ----
  // 等级: body class 驱动 CSS 隐藏,切换 O(1)
  // 关键词: 动态文本匹配,仍走 JS,用 data-ld-kw-hide 标记
  function syncLevelClasses() {
    const body = document.body;
    for (const lv of LEVELS) {
      body.classList.toggle(`ldf-hide-${lv}`, !store.levels[lv]);
    }
  }

  function applyKeywords() {
    const words = parseKeywords(store.kw.text);
    const items = document.querySelectorAll(ITEM_SEL);

    if (!words.length) {
      items.forEach((item) => item.removeAttribute('data-ld-kw-hide'));
      return;
    }

    items.forEach((item) => {
      const hit = words.some((w) => titleOf(item).includes(w));
      const pass = store.kw.mode === 'white' ? hit : !hit;
      if (pass) item.removeAttribute('data-ld-kw-hide');
      else item.setAttribute('data-ld-kw-hide', '1');
    });
  }

  function apply() {
    tagItems(document);
    syncLevelClasses();
    applyKeywords();
    updateActiveDot();
  }

  function updateActiveDot() {
    const bar = document.getElementById('ld-level-filter-bar');
    if (bar) bar.classList.toggle('is-active', isFilterActive());
  }

  // ---- 页面判定 ----
  // 路径优先挡住帖子详情/用户页等;再确认主列表容器存在。
  // 绝不能用裸 .topic-list —— 详情页相关推荐也用这个 class。
  function isListPage() {
    const path = location.pathname || '/';
    if (NON_LIST_RE.test(path)) return false;
    if (document.querySelector(LIST_SEL)) return true;
    // 兜底: 有 .topic-list 但不在相关推荐容器里
    for (const list of document.querySelectorAll('.topic-list')) {
      if (!list.closest('#suggested-topics, .more-topics, .suggested-topics')) {
        return true;
      }
    }
    return false;
  }

  function toggleBar() {
    const bar = document.getElementById('ld-level-filter-bar');
    if (bar) bar.style.display = isListPage() ? '' : 'none';
  }

  // ---- UI ----
  function buildBar() {
    if (document.getElementById('ld-level-filter-bar')) return;

    const style = document.createElement('style');
    style.id = 'ld-level-filter-style';
    style.textContent = `
      /* 等级过滤: body class + data 属性,O(1) 切换 */
      body.ldf-hide-public .topic-list-item[data-ld-level="public"],
      body.ldf-hide-1 .topic-list-item[data-ld-level="1"],
      body.ldf-hide-2 .topic-list-item[data-ld-level="2"],
      body.ldf-hide-3 .topic-list-item[data-ld-level="3"],
      .topic-list-item[data-ld-kw-hide="1"] {
        display: none !important;
      }

      #ld-level-filter-bar {
        --ldlf-h: 28px;
        --ldlf-r: 12px;
        --ldlf-pad: 10px;
        --ldlf-gap: 8px;
        --ldlf-accent: var(--tertiary, #0088cc);
        --ldlf-fg: var(--primary, #1a1a1a);
        --ldlf-muted: color-mix(in srgb, var(--ldlf-fg) 42%, transparent);
        --ldlf-border: color-mix(in srgb, var(--ldlf-fg) 10%, transparent);
        --ldlf-surface: color-mix(in srgb, var(--secondary, #fff) 78%, transparent);
        --ldlf-chip-bg: color-mix(in srgb, var(--ldlf-fg) 5%, transparent);
        --ldlf-field-bg: color-mix(in srgb, var(--ldlf-fg) 4%, transparent);
        position: fixed;
        top: 70px;
        left: 12px;
        z-index: 9999;
        width: 268px;
        box-sizing: border-box;
        padding: 0;
        border-radius: var(--ldlf-r);
        color: var(--ldlf-fg);
        background: var(--ldlf-surface);
        border: 1px solid var(--ldlf-border);
        box-shadow:
          0 1px 2px rgba(0,0,0,.04),
          0 8px 24px rgba(0,0,0,.10);
        backdrop-filter: blur(14px) saturate(1.2);
        -webkit-backdrop-filter: blur(14px) saturate(1.2);
        font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        user-select: none;
        transition: box-shadow .18s ease, width .18s ease;
      }
      #ld-level-filter-bar:hover {
        box-shadow:
          0 1px 2px rgba(0,0,0,.05),
          0 12px 32px rgba(0,0,0,.14);
      }

      #ld-level-filter-bar .ldlf-head {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 var(--ldlf-pad);
        cursor: grab;
        border-bottom: 1px solid var(--ldlf-border);
      }
      #ld-level-filter-bar.is-collapsed .ldlf-head { border-bottom: none; }
      #ld-level-filter-bar .ldlf-head:active { cursor: grabbing; }
      #ld-level-filter-bar .ldlf-handle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 16px;
        color: var(--ldlf-muted);
        opacity: .55;
        flex: none;
        transition: opacity .15s ease, color .15s ease;
      }
      #ld-level-filter-bar .ldlf-head:hover .ldlf-handle { opacity: .9; }
      #ld-level-filter-bar .ldlf-title {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .02em;
        color: var(--ldlf-fg);
        opacity: .72;
      }
      #ld-level-filter-bar .ldlf-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--ldlf-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ldlf-accent) 22%, transparent);
        opacity: 0;
        transform: scale(.6);
        transition: opacity .15s ease, transform .15s ease;
        flex: none;
      }
      #ld-level-filter-bar.is-active .ldlf-dot {
        opacity: 1;
        transform: scale(1);
      }
      #ld-level-filter-bar .ldlf-spacer { flex: 1 1 auto; }
      #ld-level-filter-bar .ldlf-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin: 0;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--ldlf-muted);
        cursor: pointer;
        transition: background .12s ease, color .12s ease;
      }
      #ld-level-filter-bar .ldlf-icon-btn:hover {
        background: var(--ldlf-chip-bg);
        color: var(--ldlf-fg);
      }
      #ld-level-filter-bar .ldlf-collapse .ldlf-ico-max { display: none; }
      #ld-level-filter-bar.is-collapsed .ldlf-collapse .ldlf-ico-min { display: none; }
      #ld-level-filter-bar.is-collapsed .ldlf-collapse .ldlf-ico-max { display: block; }

      #ld-level-filter-bar .ldlf-body {
        display: flex;
        flex-direction: column;
        gap: var(--ldlf-gap);
        padding: var(--ldlf-pad);
      }
      #ld-level-filter-bar.is-collapsed .ldlf-body { display: none; }
      #ld-level-filter-bar.is-collapsed {
        width: auto;
        min-width: 0;
      }
      #ld-level-filter-bar .ldlf-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #ld-level-filter-bar .ldlf-chip {
        flex: 1 1 0;
        min-width: 0;
        height: var(--ldlf-h);
        margin: 0;
        padding: 0 6px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--ldlf-chip-bg);
        color: var(--ldlf-muted);
        font: inherit;
        font-weight: 600;
        letter-spacing: .01em;
        cursor: pointer;
        transition:
          background .12s ease,
          color .12s ease,
          border-color .12s ease,
          box-shadow .12s ease,
          transform .1s ease;
      }
      #ld-level-filter-bar .ldlf-chip:hover {
        color: var(--ldlf-fg);
        border-color: color-mix(in srgb, var(--ldlf-accent) 35%, transparent);
      }
      #ld-level-filter-bar .ldlf-chip:active { transform: scale(.97); }
      #ld-level-filter-bar .ldlf-chip.active {
        background: color-mix(in srgb, var(--ldlf-accent) 14%, transparent);
        color: var(--ldlf-accent);
        border-color: color-mix(in srgb, var(--ldlf-accent) 40%, transparent);
        box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ldlf-accent) 20%, transparent);
      }
      #ld-level-filter-bar .ldlf-chip.active:hover {
        background: color-mix(in srgb, var(--ldlf-accent) 20%, transparent);
      }

      #ld-level-filter-bar .ldlf-field {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        height: var(--ldlf-h);
        border-radius: 8px;
        border: 1px solid var(--ldlf-border);
        background: var(--ldlf-field-bg);
        transition: border-color .12s ease, box-shadow .12s ease, background .12s ease;
      }
      #ld-level-filter-bar .ldlf-field:focus-within {
        border-color: color-mix(in srgb, var(--ldlf-accent) 55%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ldlf-accent) 16%, transparent);
        background: color-mix(in srgb, var(--secondary, #fff) 90%, transparent);
      }
      #ld-level-filter-bar .ldlf-field-ico {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        flex: none;
        color: var(--ldlf-muted);
        pointer-events: none;
      }
      #ld-level-filter-bar .ldlf-kw-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        margin: 0;
        padding: 0 2px 0 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--ldlf-fg);
        font: inherit;
        font-weight: 500;
      }
      #ld-level-filter-bar .ldlf-kw-input::placeholder {
        color: var(--ldlf-muted);
        opacity: .85;
      }
      #ld-level-filter-bar .ldlf-clear {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin: 0 3px 0 0;
        padding: 0;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--ldlf-muted);
        cursor: pointer;
        flex: none;
        transition: background .12s ease, color .12s ease;
      }
      #ld-level-filter-bar .ldlf-clear:hover {
        background: var(--ldlf-chip-bg);
        color: var(--ldlf-fg);
      }
      #ld-level-filter-bar .ldlf-clear[hidden] { display: none; }

      #ld-level-filter-bar .ldlf-seg {
        display: inline-flex;
        flex: none;
        height: var(--ldlf-h);
        padding: 2px;
        gap: 2px;
        border-radius: 8px;
        border: 1px solid var(--ldlf-border);
        background: var(--ldlf-field-bg);
        box-sizing: border-box;
      }
      #ld-level-filter-bar .ldlf-seg .ldlf-mode {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 100%;
        margin: 0;
        padding: 0 8px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--ldlf-muted);
        font: inherit;
        font-weight: 700;
        letter-spacing: .02em;
        cursor: pointer;
        transition: background .12s ease, color .12s ease, box-shadow .12s ease;
      }
      #ld-level-filter-bar .ldlf-seg .ldlf-mode:hover { color: var(--ldlf-fg); }
      #ld-level-filter-bar .ldlf-seg .ldlf-mode.white.active {
        background: color-mix(in srgb, var(--success, #22a06b) 16%, transparent);
        color: var(--success, #22a06b);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success, #22a06b) 30%, transparent);
      }
      #ld-level-filter-bar .ldlf-seg .ldlf-mode.black.active {
        background: color-mix(in srgb, var(--danger, #e45735) 16%, transparent);
        color: var(--danger, #e45735);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger, #e45735) 30%, transparent);
      }
    `;
    document.head.appendChild(style);

    const chips = LEVELS.map(
      (lv) =>
        `<button type="button" class="ldlf-chip${
          store.levels[lv] ? ' active' : ''
        }" data-lv="${lv}">${LABELS[lv]}</button>`
    ).join('');

    const bar = document.createElement('div');
    bar.id = 'ld-level-filter-bar';
    if (store.collapsed) bar.classList.add('is-collapsed');
    bar.innerHTML = `
      <div class="ldlf-head">
        <span class="ldlf-handle" title="拖动">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
            <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
            <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
          </svg>
        </span>
        <span class="ldlf-title">过滤</span>
        <span class="ldlf-dot" title="过滤生效中"></span>
        <span class="ldlf-spacer"></span>
        <button type="button" class="ldlf-icon-btn ldlf-collapse" title="折叠 / 展开">
          <svg class="ldlf-ico-min" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M2.5 6h7"/>
          </svg>
          <svg class="ldlf-ico-max" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2.5 4.5h7M2.5 7.5h7"/>
          </svg>
        </button>
      </div>
      <div class="ldlf-body">
        <div class="ldlf-row ldlf-level-row">${chips}</div>
        <div class="ldlf-row ldlf-kw-row">
          <div class="ldlf-field">
            <span class="ldlf-field-ico">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <circle cx="5.2" cy="5.2" r="3.4"/><path d="M7.7 7.7L10.2 10.2"/>
              </svg>
            </span>
            <input class="ldlf-kw-input" type="text" placeholder="标题关键词…" spellcheck="false" />
            <button type="button" class="ldlf-clear" title="清空" hidden>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M2 2l6 6M8 2L2 8"/>
              </svg>
            </button>
          </div>
          <div class="ldlf-seg" role="group" aria-label="关键词模式">
            <button type="button" class="ldlf-mode white" data-mode="white" title="白名单：仅显示命中关键词的帖子">白</button>
            <button type="button" class="ldlf-mode black" data-mode="black" title="黑名单：隐藏命中关键词的帖子">黑</button>
          </div>
        </div>
      </div>
    `;

    const input = bar.querySelector('.ldlf-kw-input');
    const clearBtn = bar.querySelector('.ldlf-clear');
    input.value = store.kw.text;
    clearBtn.hidden = !store.kw.text;

    const renderMode = () => {
      bar.querySelectorAll('.ldlf-mode').forEach((btn) => {
        const on = btn.dataset.mode === store.kw.mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    renderMode();

    // 事件委托
    bar.addEventListener('click', (e) => {
      const chip = e.target.closest('.ldlf-chip[data-lv]');
      if (chip) {
        const lv = chip.dataset.lv;
        store.levels[lv] = !store.levels[lv];
        chip.classList.toggle('active', store.levels[lv]);
        save();
        syncLevelClasses();
        updateActiveDot();
        return;
      }

      if (e.target.closest('.ldlf-collapse')) {
        store.collapsed = !store.collapsed;
        bar.classList.toggle('is-collapsed', store.collapsed);
        save();
        return;
      }

      if (e.target.closest('.ldlf-clear')) {
        input.value = '';
        store.kw.text = '';
        clearBtn.hidden = true;
        save();
        applyKeywords();
        updateActiveDot();
        input.focus();
        return;
      }

      const modeBtn = e.target.closest('.ldlf-mode[data-mode]');
      if (modeBtn) {
        store.kw.mode = modeBtn.dataset.mode;
        renderMode();
        save();
        applyKeywords();
        updateActiveDot();
      }
    });

    input.addEventListener('input', () => {
      store.kw.text = input.value;
      clearBtn.hidden = !input.value;
      save();
      applyKeywords();
      updateActiveDot();
    });
    input.addEventListener('mousedown', (e) => e.stopPropagation());

    document.body.appendChild(bar);
    restorePos(bar);
    makeDraggable(bar, bar.querySelector('.ldlf-head'));
    updateActiveDot();
  }

  // ---- 拖动 ----
  function restorePos(bar) {
    if (store.pos) {
      bar.style.left = store.pos.left + 'px';
      bar.style.top = store.pos.top + 'px';
    }
  }

  function makeDraggable(bar, handle) {
    let startX, startY, startLeft, startTop, dragging = false;

    const onDown = (e) => {
      if (e.target.closest('button, input, a')) return;
      dragging = true;
      const rect = bar.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      let left = startLeft + (e.clientX - startX);
      let top = startTop + (e.clientY - startY);
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      left = Math.max(0, Math.min(left, window.innerWidth - w));
      top = Math.max(0, Math.min(top, window.innerHeight - h));
      bar.style.left = left + 'px';
      bar.style.top = top + 'px';
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const rect = bar.getBoundingClientRect();
      store.pos = { left: rect.left, top: rect.top };
      save();
    };

    handle.addEventListener('mousedown', onDown);
  }

  // ---- SPA: 路由钩子 + 窄范围列表观察 ----
  let listObserver = null;
  let observedList = null;
  let timer = null;
  let bootArmed = false;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(onTick, 100);
  }

  // document 级轻量观察: 只在「还没绑上列表」时开着,
  // 用来发现冷启动 / SPA 切回列表页时新冒出来的 DOM。
  const bootObserver = new MutationObserver(schedule);

  function armBoot() {
    if (bootArmed) return;
    bootObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    bootArmed = true;
  }

  function disarmBoot() {
    if (!bootArmed) return;
    bootObserver.disconnect();
    bootArmed = false;
  }

  function onTick() {
    const pathBlocked = NON_LIST_RE.test(location.pathname || '/');
    toggleBar();

    if (pathBlocked) {
      // 非列表路由: 卸掉列表观察,boot 也停,等下次 onRoute 再武装
      if (listObserver) {
        listObserver.disconnect();
        listObserver = null;
        observedList = null;
      }
      disarmBoot();
      return;
    }

    if (!isListPage()) {
      // 路径像列表但 DOM 还没出来,保持 boot 观察
      armBoot();
      return;
    }

    ensureListObserver();
    // 列表已绑上,收起 document 级观察,后续靠窄范围
    if (observedList) disarmBoot();

    // 增量打标 + 关键词;等级靠 CSS 已生效
    tagItems(observedList || document);
    applyKeywords();
    updateActiveDot();
  }

  function findListRoot() {
    return (
      document.querySelector('#list-area') ||
      document.querySelector('.list-container') ||
      document.querySelector(LIST_SEL) ||
      // 兜底: 第一个不在相关推荐里的 topic-list
      [...document.querySelectorAll('.topic-list')].find(
        (el) => !el.closest('#suggested-topics, .more-topics, .suggested-topics')
      ) ||
      null
    );
  }

  function ensureListObserver() {
    const list = findListRoot();
    if (!list || list === observedList) return;

    if (listObserver) listObserver.disconnect();
    observedList = list;
    listObserver = new MutationObserver(schedule);
    listObserver.observe(list, { childList: true, subtree: true });
  }

  function onRoute() {
    // 路由一切就立刻按路径藏/显,不用等 DOM
    const bar = document.getElementById('ld-level-filter-bar');
    if (bar && NON_LIST_RE.test(location.pathname || '/')) {
      bar.style.display = 'none';
    }
    // 列表容器会随路由重建,清掉旧绑定并重新武装 boot
    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
      observedList = null;
    }
    armBoot();
    schedule();
  }

  function hookHistory() {
    const wrap = (type) => {
      const orig = history[type];
      history[type] = function (...args) {
        const ret = orig.apply(this, args);
        onRoute();
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', onRoute);
  }

  buildBar();
  syncLevelClasses();
  hookHistory();
  armBoot();
  onTick();
})();
