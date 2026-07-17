// ==UserScript==
// @name         linux.do 等级贴过滤
// @namespace    https://github.com/airline233/linuxdo-level-filter
// @version      1.0.0
// @description  按用户等级(Lv1/Lv2/Lv3)统一过滤帖子列表,一处开关搞定所有受限子版块
// @author       airline233
// @match        https://linux.do/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ld-level-filter';
  const POS_KEY = 'ld-level-filter-pos';
  const KW_KEY = 'ld-level-filter-kw';
  // 可选档位: public(公开无锁) / 1 / 2 / 3
  const LEVELS = ['public', '1', '2', '3'];
  const LABELS = { public: '公开', 1: 'Lv1', 2: 'Lv2', 3: 'Lv3' };

  // 读取勾选状态,默认全选(不过滤)
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && typeof s === 'object') return s;
    } catch (e) {}
    return { public: true, 1: true, 2: true, 3: true };
  }
  let state = loadState();
  const saveState = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // 关键词过滤状态: mode = 'black'(命中即隐藏) | 'white'(仅显示命中), text = 原始输入
  function loadKw() {
    try {
      const s = JSON.parse(localStorage.getItem(KW_KEY));
      if (s && typeof s === 'object') {
        return { mode: s.mode === 'white' ? 'white' : 'black', text: s.text || '' };
      }
    } catch (e) {}
    return { mode: 'black', text: '' };
  }
  let kwState = loadKw();
  const saveKw = () => localStorage.setItem(KW_KEY, JSON.stringify(kwState));

  // 把输入拆成关键词数组(逗号/空格分隔)
  function parseKeywords(str) {
    return (str || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  }

  // 从一条帖子里判断它属于哪个档位: 返回 'public' | '1' | '2' | '3'
  function levelOf(item) {
    // 找所有受限分类徽章,取其中出现的最高等级
    const badges = item.querySelectorAll('.badge-category.restricted, .badge-category--restricted');
    let level = null;
    badges.forEach((b) => {
      // 途径1: title="此处为 1级用户 可见空间。"
      let m = (b.getAttribute('title') || '').match(/(\d+)\s*级用户/);
      // 途径2: 徽章文本尾部 Lv1
      if (!m) m = (b.textContent || '').match(/Lv\s*(\d)/i);
      // 途径3: 链接 slug 里的 -lv1
      if (!m) {
        const link = b.closest('a[href]');
        if (link) m = (link.getAttribute('href') || '').match(/-lv(\d)/i);
      }
      if (m) {
        const n = parseInt(m[1], 10);
        if (level === null || n > level) level = n;
      } else if (level === null) {
        level = 0; // 有 restricted 但没读到数字,记为受限但未知
      }
    });
    if (level === null) return 'public'; // 无锁 = 公开帖
    if (level >= 1 && level <= 3) return String(level);
    return 'public'; // 未知受限档暂归公开,避免误杀
  }

  // 取一条帖子的标题文本
  function titleOf(item) {
    const el = item.querySelector('.title, .topic-list-item-title, a.raw-topic-link, .link-top-line a');
    return (el ? el.textContent : item.textContent || '').toLowerCase();
  }

  // 关键词是否放行这条帖子
  function keywordPass(item) {
    const words = parseKeywords(kwState.text);
    if (!words.length) return true; // 无关键词 = 不生效
    const title = titleOf(item);
    const hit = words.some((w) => title.includes(w.toLowerCase()));
    return kwState.mode === 'white' ? hit : !hit;
  }

  function apply() {
    const items = document.querySelectorAll('.topic-list-item, tr.topic-list-item');
    items.forEach((item) => {
      const lv = levelOf(item);
      const show = state[lv] && keywordPass(item);
      item.style.display = show ? '' : 'none';
    });
  }

  // ---- 工具条 UI ----
  function buildBar() {
    if (document.getElementById('ld-level-filter-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'ld-level-filter-bar';

    const handle = document.createElement('span');
    handle.className = 'ldlf-handle';
    handle.textContent = '⠿';
    handle.title = '拖动';
    bar.appendChild(handle);

    const title = document.createElement('span');
    title.className = 'ldlf-title';
    title.textContent = '等级过滤';
    bar.appendChild(title);

    LEVELS.forEach((lv) => {
      const chip = document.createElement('button');
      chip.className = 'ldlf-chip' + (state[lv] ? ' active' : '');
      chip.textContent = LABELS[lv];
      chip.dataset.lv = lv;
      chip.addEventListener('click', () => {
        state[lv] = !state[lv];
        chip.classList.toggle('active', state[lv]);
        saveState();
        apply();
      });
      bar.appendChild(chip);
    });

    // 关键词过滤:黑/白两个独立按钮(互斥,高亮当前模式) + 输入框,与等级 chip 同一行
    const blackBtn = document.createElement('button');
    blackBtn.className = 'ldlf-mode black';
    blackBtn.textContent = '黑';
    blackBtn.title = '黑名单:隐藏标题命中关键词的帖子';
    const whiteBtn = document.createElement('button');
    whiteBtn.className = 'ldlf-mode white';
    whiteBtn.textContent = '白';
    whiteBtn.title = '白名单:仅显示标题命中关键词的帖子';
    const renderMode = () => {
      blackBtn.classList.toggle('active', kwState.mode === 'black');
      whiteBtn.classList.toggle('active', kwState.mode === 'white');
    };
    renderMode();
    blackBtn.addEventListener('click', () => {
      kwState.mode = 'black';
      renderMode();
      saveKw();
      apply();
    });
    whiteBtn.addEventListener('click', () => {
      kwState.mode = 'white';
      renderMode();
      saveKw();
      apply();
    });
    bar.appendChild(blackBtn);
    bar.appendChild(whiteBtn);

    const input = document.createElement('input');
    input.className = 'ldlf-kw-input';
    input.type = 'text';
    input.placeholder = '标题关键词,逗号或空格分隔';
    input.value = kwState.text;
    input.addEventListener('input', () => {
      kwState.text = input.value;
      saveKw();
      apply();
    });
    // 输入框内不触发拖动/快捷键冒泡
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    bar.appendChild(input);

    document.body.appendChild(bar);
    restorePos(bar);
    makeDraggable(bar, handle);

    const style = document.createElement('style');
    style.textContent = `
      #ld-level-filter-bar {
        position: fixed; top: 70px; left: 12px; z-index: 9999;
        display: flex; align-items: center; flex-wrap: nowrap; gap: 6px;
        padding: 6px 10px; border-radius: 8px; white-space: nowrap;
        background: var(--secondary, #fff); color: var(--primary, #222);
        box-shadow: 0 2px 8px rgba(0,0,0,.18); font-size: 13px;
        border: 1px solid var(--primary-low, #ddd);
        user-select: none;
      }
      #ld-level-filter-bar .ldlf-mode {
        cursor: pointer; white-space: nowrap; flex: none;
        border: 1px solid var(--primary-low, #ccc);
        background: transparent; color: inherit;
        padding: 2px 9px; border-radius: 12px; line-height: 1.6;
      }
      #ld-level-filter-bar .ldlf-mode.black.active {
        background: var(--danger, #e45735); color: #fff;
        border-color: var(--danger, #e45735);
      }
      #ld-level-filter-bar .ldlf-mode.white.active {
        background: var(--success, #4caf50); color: #fff;
        border-color: var(--success, #4caf50);
      }
      #ld-level-filter-bar .ldlf-kw-input {
        flex: 0 1 130px; min-width: 60px;
        padding: 3px 8px; border-radius: 6px; font-size: 12px;
        border: 1px solid var(--primary-low, #ccc);
        background: var(--secondary, #fff); color: var(--primary, #222);
      }
      #ld-level-filter-bar .ldlf-handle {
        cursor: grab; opacity: .5; margin-right: 2px; font-size: 14px;
      }
      #ld-level-filter-bar .ldlf-handle:active { cursor: grabbing; }
      #ld-level-filter-bar .ldlf-title { font-weight: 600; margin-right: 2px; opacity: .8; }
      #ld-level-filter-bar .ldlf-chip {
        cursor: pointer; border: 1px solid var(--primary-low, #ccc);
        background: transparent; color: inherit;
        padding: 2px 10px; border-radius: 12px; line-height: 1.6;
      }
      #ld-level-filter-bar .ldlf-chip.active {
        background: var(--tertiary, #0088cc); color: #fff;
        border-color: var(--tertiary, #0088cc);
      }
    `;
    document.head.appendChild(style);
  }

  // ---- 拖动 ----
  function restorePos(bar) {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      if (p && typeof p.left === 'number' && typeof p.top === 'number') {
        bar.style.left = p.left + 'px';
        bar.style.top = p.top + 'px';
      }
    } catch (e) {}
  }

  function makeDraggable(bar, handle) {
    let startX, startY, startLeft, startTop, dragging = false;

    const onDown = (e) => {
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
      // 限制在视口内
      const w = bar.offsetWidth, h = bar.offsetHeight;
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
      localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    };

    handle.addEventListener('mousedown', onDown);
  }

  // 仅在有帖子列表的页面显示工具条;个人资料页(/u/...)即便有活动列表也排除
  function isListPage() {
    if (/^\/u\//.test(location.pathname)) return false;
    return !!document.querySelector('.topic-list');
  }
  function toggleBar() {
    const bar = document.getElementById('ld-level-filter-bar');
    if (bar) bar.style.display = isListPage() ? '' : 'none';
  }

  // ---- 监听 SPA 列表变化 ----
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      toggleBar();
      apply();
    }, 120);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  buildBar();
  toggleBar();
  apply();
})();
