// editbar.js — 页面内容覆盖（站主「更改当前页面布局」）
//  - 所有访客加载时：拉取并应用当前页保存的文字/图片修改 + 内容块
//  - 站主点击浮动「更改当前页面布局」按钮 -> window.XLEdit.open() 进入编辑模式
//      · 点击已有文字元素 -> 就地编辑（contenteditable）
//      · 点击图片 -> 弹出输入新地址换图
//      · 工具栏分组：
//          插入 ＋ 一个大按钮，下拉菜单：文本框 / 图片 / 视频 / 文件（附件）
//          块   ⧉复制 / ↑上移 / ↓下移 / 🗑删除
//          尺寸 实时显示「宽 × 高」/ ⤢重置（改大小＝直接拖块的四角·四边，Microsoft 365 式：
//               图片·视频按比例缩放，文本框·附件自由改长宽；尺寸随块保存，访客看到同一尺寸）
//          格式 B / I / U / S / 对齐 / 🔗链接 / ⛓解除 / 字体 / 字号 / 颜色
//      · 快捷键：Ctrl/Cmd+S 保存 · Esc 退出 · Ctrl/Cmd+B/I/U 粗斜下划线
//                Delete/Backspace 删除选中块（未在输入时）
//      · 有未保存修改时，退出或刷新前会提示；保存按钮显示「未保存」圆点
//  - 保存 -> POST /api/page-edit；退出 -> 还原到已保存状态
(function () {
  'use strict';
  var OWNER = 'MC-Creator-Jerry';
  // 可编辑的文字元素（排除导航/浮动条/脚本等系统区域）
  var TEXT_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,label,figcaption,span,a,.editable';
  var EXCLUDE = '.topbar,.bar-right,nav,.float-actions,.fab,.modal-overlay,.modal,.settings-overlay,.settings-panel,.pop-menu,.user-popup,script,style,button,form,header.breadcrumb-bar';

  // 标准调色板（模块级：showUI 的 buildPanel 与 createMiniToolbar 的 buildMiniPanel 都要用，
  // 必须提升到 IIFE 作用域，否则 createMiniToolbar 内引用会 ReferenceError -> showUI 抛错 -> 编辑模式瘫痪）
  var STANDARD_COLORS = [
    '#000000','#404040','#808080','#a0a0a0','#d0d0d0','#ffffff',
    '#e60012','#ff6600','#ffcc00','#ffe800','#a8d600','#00b050',
    '#00b0f0','#0078d4','#002060','#5c0a8a','#d6006a','#a30000'
  ];
  var STANDARD_BG = [
    '#ffffff','#fff36d','#ffd966','#a4d2ff','#c5e0b4','#f4cccc',
    '#fff2cc','#e2efda','#d9e8f5','#fce4d6','#fad7d0','#e6b8af'
  ];

  function curPath() { return location.pathname || '/'; }
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function inExcluded(el) { return !!(el.closest && el.closest(EXCLUDE)); }
  function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // 编辑器样式：xiaolan/teahouse 已内联在 common.css；bookstation/pianyu 由本脚本按需注入 /assets/editbar.css
  function editbarCssReady() {
    try {
      var probe = document.createElement('div');
      probe.className = 'xl-edit-banner';
      probe.style.display = 'none';
      document.body.appendChild(probe);
      var pos = window.getComputedStyle(probe).position;
      document.body.removeChild(probe);
      return pos === 'fixed' || pos === 'absolute' || pos === 'sticky';
    } catch (e) { return false; }
  }
  function ensureEditbarCss() {
    if (editbarCssReady()) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/editbar.css?v=20260928-02';
    document.head.appendChild(link);
  }

  // 生成确定性 CSS 选择器（DOM 结构不变时稳定）
  function cssPath(el) {
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      var parent = node.parentNode;
      if (!parent) break;
      var tag = node.tagName.toLowerCase();
      var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
      var idx = Array.prototype.indexOf.call(sibs, node) + 1;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = parent;
    }
    return 'body > ' + parts.join(' > ');
  }

  // ---------- 稳定编辑键（Fix：避免新版本 HTML 结构变化导致 cssPath 失效、文字被覆盖） ----------
  // 思路：给每个可编辑元素分配一个「稳定 id」并写入 data-xl-id；保存时以 data-xl-id 为键，
  // 而非易碎的位置选择器（nth-of-type）。id 由「祖先稳定路径 + 标签 + 文档序」算出，
  // 同一浏览器下用 localStorage 映射缓存，保证多次加载（含上新版本）拿到相同 id。
  // 我们的部署只改 editbar.js、不动内容 HTML，因此文档序稳定 → id 稳定 → 已保存文字不被覆盖。
  function xlHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }
  function xlAncestorPath(el) {
    var parts = [];
    var n = el.parentElement;
    while (n && n.tagName !== 'BODY' && n.tagName !== 'HTML') {
      var t = n.tagName.toLowerCase();
      if (n.id) parts.unshift('#' + n.id);
      else if (n.className && typeof n.className === 'string' && n.className.trim()) {
        var cs = n.className.trim().split(/\s+/).slice(0, 2)
          .map(function (c) { return c.replace(/[^a-z0-9_-]/gi, ''); }).filter(Boolean);
        parts.unshift(t + (cs.length ? '.' + cs.join('.') : ''));
      } else { parts.unshift(t); }
      n = n.parentElement;
    }
    return parts.join('/');
  }
  function xlFingerprint(el) {
    var idx = -1;
    try {
      var all = document.querySelectorAll(TEXT_SEL);
      for (var i = 0; i < all.length; i++) { if (all[i] === el) { idx = i; break; } }
    } catch (e) {}
    return xlAncestorPath(el) + '|' + el.tagName.toLowerCase() + '|' + idx;
  }
  function xlMapKey() { return 'xl_idmap:' + curPath(); }
  function xlLoadMap() { try { return JSON.parse(localStorage.getItem(xlMapKey()) || '{}'); } catch (e) { return {}; } }
  function xlSaveMap(m) { try { localStorage.setItem(xlMapKey(), JSON.stringify(m)); } catch (e) {} }
  function ensureStableIds() {
    var map = xlLoadMap();
    document.querySelectorAll(TEXT_SEL).forEach(function (el) {
      if (inExcluded(el)) return;
      if (el.getAttribute('data-xl-id')) return;
      var fp = xlFingerprint(el);
      var id = map[fp];
      if (!id) { id = 'xl-' + xlHash(fp); map[fp] = id; }
      el.setAttribute('data-xl-id', id);
    });
    var imgs = document.querySelectorAll('img');
    for (var k = 0; k < imgs.length; k++) {
      var img = imgs[k];
      if (inExcluded(img)) continue;
      if (img.getAttribute('data-xl-id')) continue;
      // 必须带序号：同一容器内的多张图祖先路径完全相同，不带序号会撞同一个 id，
      // 导致只有第一张图能被回填，其余图片的修改丢失。
      var fp = xlAncestorPath(img) + '|img|' + k;
      var id = map[fp];
      if (!id) { id = 'xl-' + xlHash(fp); map[fp] = id; }
      img.setAttribute('data-xl-id', id);
    }
    xlSaveMap(map);
  }
  function xlKey(el) {
    var id = el.getAttribute && el.getAttribute('data-xl-id');
    if (id) return 'xlid:' + id;
    return 'css:' + cssPath(el);
  }
  function resolveEditNode(key) {
    if (key.indexOf('xlid:') === 0) {
      var id = key.slice(5);
      try { return document.querySelector('[data-xl-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }
      catch (e) { return null; }
    }
    try { return document.querySelector(key.indexOf('css:') === 0 ? key.slice(4) : key); } catch (e) { return null; }
  }

  // ---------- 英语适配（xl_lang 切换） ----------
  function xlT(zh, en) {
    try { if (localStorage.getItem('xl_lang') === 'en') return en; } catch (e) {}
    return zh;
  }
  // ---------- 双语节点（data-zh/data-en）支持 ----------
  function curLang() {
    try { return localStorage.getItem('xl_lang') === 'en' ? 'en' : 'zh'; } catch (e) { return 'zh'; }
  }
  function isBilingualNode(node) {
    return !!(node && node.hasAttribute && node.hasAttribute('data-zh'));
  }
  function stripHtmlToText(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ---------- 图标库（内联 SVG，currentColor 跟随主题） ----------
  var ICONS = {
    painter: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3l3 3-7 7-3-1 1-3 6-6z"/><path d="M14 6l3 3"/><path d="M5 17l3 3"/></svg>',
    find: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>',
    replace: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h12"/><path d="M12 4l3 2-3 2"/><path d="M21 18H9"/><path d="M12 16l-3 2 3 2"/></svg>',
    case: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V5h4"/><path d="M5 5l4 4"/><path d="M13 19h6v-4"/><path d="M19 19l-4-4"/></svg>',
    table: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/></svg>',
    symbol: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14M5 16h14M8 4v16M16 4v16"/></svg>',
    pagebreak: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16M4 16h16"/><path d="M12 4v4M12 16v4" stroke-dasharray="2 2"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    fontset: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 7l4 12M16 7l-4 12"/><path d="M9 7h6"/></svg>',
    spacing: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 19h16"/><path d="M4 12h16" stroke-dasharray="2 2"/></svg>',
    wordcount: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 10h16M4 14h10M4 18h13"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4z"/></svg>',
    spell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l4 4 9-12"/><path d="M14 5l4 4"/></svg>',
    zoomin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4M11 8v6M8 11h6"/></svg>',
    zoomout: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4M8 11h6"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/></svg>',
    toc: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="1"/></svg>'
    // columns / translate 已移除：没有任何功能引用它们，留着只是死代码
  };

  // ---------- 内容块容器 ----------
  function blocksContainer() {
    var c = document.getElementById('xl-edit-blocks');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'xl-edit-blocks';
    var host = document.querySelector('main.content') || document.querySelector('main') || document.querySelector('.content') || document.body;
    host.appendChild(c);
    return c;
  }

  // 视频地址 -> 嵌入方式
  function videoEmbed(url) {
    var m;
    // 本站上传的文件（/api/file?key=...）一律按可播放视频处理
    if (/^\/api\/file(\?.*)?$/i.test(url) || /\/api\/file\?/i.test(url)) {
      return { kind: 'video', src: url };
    }
    if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/))) {
      return { kind: 'iframe', src: 'https://www.youtube.com/embed/' + m[1] };
    }
    if (/^https?:\/\/.+\.(?:mp4|webm|ogg)(?:\?.*)?$/i.test(url) || /^\/.*\.(?:mp4|webm|ogg)$/i.test(url)) {
      return { kind: 'video', src: url };
    }
    return { kind: 'link', src: url };
  }

  function buildBlockEl(b) {
    var wrap = document.createElement('div');
    wrap.className = 'xl-block';
    wrap.dataset.bid = b.id || genId();
    wrap.dataset.type = b.type;
    if (b.type === 'textbox') {
      var inner = document.createElement('div');
      inner.className = 'xl-block-inner';
      inner.setAttribute('contenteditable', 'false');
      inner.setAttribute('data-placeholder', '在此输入文字…');
      inner.innerHTML = b.html || '';
      if (b.style) inner.setAttribute('style', b.style);
      wrap.appendChild(inner);
    } else if (b.type === 'image') {
      var img = document.createElement('img');
      img.src = b.src; img.alt = b.alt || ''; img.loading = 'lazy';
      wrap.appendChild(img);
    } else if (b.type === 'video') {
      wrap.dataset.url = b.url || '';
      var emb = videoEmbed(b.url || '');
      if (emb.kind === 'iframe') {
        var f = document.createElement('iframe');
        f.src = emb.src; f.allowFullscreen = true; f.loading = 'lazy';
        f.setAttribute('frameborder', '0'); f.className = 'xl-video';
        wrap.appendChild(f);
      } else if (emb.kind === 'video') {
        var v = document.createElement('video');
        v.src = emb.src; v.controls = true; v.className = 'xl-video'; v.setAttribute('preload', 'metadata');
        wrap.appendChild(v);
      } else {
        var a = document.createElement('a');
        a.href = b.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = b.url;
        wrap.appendChild(a);
      }
    } else if (b.type === 'file') {
      wrap.dataset.url = b.url || '';
      wrap.dataset.name = b.name || '';
      var link = document.createElement('a');
      link.className = 'xl-file';
      link.href = b.url || '#';
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('download', '');
      var ico = document.createElement('span');
      ico.className = 'xl-file-ico';
      ico.textContent = '📎';
      var nm = document.createElement('span');
      nm.className = 'xl-file-name';
      nm.textContent = b.name || '附件';
      link.appendChild(ico); link.appendChild(nm);
      wrap.appendChild(link);
    }
    applySizeTo(wrap, b.w, b.h);
    return wrap;
  }

  // 把保存的长宽写回块（0 / 空 = 自动，跟随内容）
  function applySizeTo(wrap, w, h) {
    w = parseInt(w, 10) || 0;
    h = parseInt(h, 10) || 0;
    if (w > 0) { wrap.style.width = w + 'px'; wrap.dataset.w = String(w); }
    if (h > 0) { wrap.style.height = h + 'px'; wrap.dataset.h = String(h); }
  }

  // ---------- 应用已保存覆盖（所有访客） ----------
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function nl2br(s) {
    return escHtml(s).replace(/\r?\n/g, '<br>');
  }
  function applySaved() {
    fetch('/api/page-edit?path=' + encodeURIComponent(curPath()))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var savedEdits = d.edits || {};
        var blocks = Array.isArray(d.blocks) ? d.blocks : [];
        // 记录服务器上已有的修改量：空保存保护要用（见 saveEdits）
        savedRemoteCount = Object.keys(savedEdits).length + blocks.length;
        // 回填已保存覆盖到内存表，避免保存时整键覆盖把历史修改清掉（Fix 1）
        Object.keys(savedEdits).forEach(function (sel) {
          var e = savedEdits[sel];
          if (!e) return;
          edits[sel] = { type: e.type, value: e.value };
          var node = resolveEditNode(sel);
          if (!node) return;
          try {
            if (e.type === 'img') { if (node.tagName === 'IMG') node.src = e.value; }
            else if (e.type === 'text' && isBilingualNode(node)) {
              // 双语节点：存档写进 data-zh / data-en 属性（而非直接覆盖文本），
              // 之后的语言切换（applyLang）按当前语言渲染，两种语言都不丢。
              // 旧存档没有 lang 字段，默认视为中文（历史上都是中文编辑的）。
              var blang = e.lang === 'en' ? 'en' : 'zh';
              var bzh = blang === 'zh' ? e.value : (e.alt != null && e.altLang === 'zh' ? e.alt : node.getAttribute('data-zh'));
              var ben = blang === 'en' ? e.value : (e.alt != null && e.altLang === 'en' ? e.alt : node.getAttribute('data-en'));
              if (bzh != null) node.setAttribute('data-zh', bzh);
              if (ben != null) node.setAttribute('data-en', ben);
              node.innerHTML = curLang() === 'en' ? (ben || '') : (bzh || '');
            }
            else { node.innerHTML = e.value; }   // 直接写回 HTML，保留字体/颜色/加粗等格式
          } catch (_) {}
        });
        // 幂等：先清空容器里已有的内容块，再按保存数据重建。
        // 原来只 append 不清空，而 applySaved() 会在「页载入」和「每次退出编辑」时各跑一次，
        // 于是同一批块被反复追加；保存又是从 DOM 全量收集 → 重复被写进 KV，每次更新翻一倍。
        var c = blocksContainer();
        $all('.xl-block', c).forEach(function (w) { w.remove(); });
        var seen = {};
        blocks.forEach(function (b) {
          var id = b && b.id;
          if (id) { if (seen[id]) return; seen[id] = 1; }
          c.appendChild(buildBlockEl(b));
        });
      })
      .catch(function () {});
  }

  // ---------- 编辑模式（站主） ----------
  var edits = {};            // cssPath -> {type,value}（legacy）
  var savedRemoteCount = -1; // 服务器上已有的 edits+blocks 总数（-1 = 还没拉到）；空保存保护用
  var active = false;
  var activeWrap = null;     // 当前选中的内容块
  var activeInner = null;    // 当前聚焦的文本框
  var savedRange = null;     // 文本框内选区
  var dirty = false;         // 是否有未保存修改
  var saving = false;        // 是否正在保存
  var banner = null;         // 顶部编辑条
  var saveBtn = null;
  // 调色板面板 DOM 引用（showUI 中填充，applyColor/applyHighlight 与 refreshRecents 访问）
  var fgPanel = null;
  var bgPanel = null;
  // 阻止默认行为的 helper（mousedown 在工具按钮上时不抢走 selection 焦点）
  function keepSel(e) { e.preventDefault(); }
  // 点工具栏前同时保存当前选区，避免点按钮时失焦丢选区
  function keepAndSave(e) { saveSel(); keepSel(e); }

  // ---------- 轻提示 ----------
  var toastTimer;
  function toast(msg, ms) {
    var t = document.querySelector('.xl-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'xl-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2000);
  }

  // ---------- 未保存状态 ----------
  function markDirty() {
    if (dirty) return;
    dirty = true;
    updateSaveBtn();
    scheduleDraft();   // C: 有改动即安排空闲 20s 自动存草稿
  }
  function updateSaveBtn() {
    if (!saveBtn) return;
    if (saving) {
      saveBtn.textContent = '保存中…';
      saveBtn.disabled = true;
      saveBtn.classList.remove('is-dirty');
      return;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
    saveBtn.classList.toggle('is-dirty', dirty);
    saveBtn.title = dirty ? '有未保存的修改（Ctrl/Cmd+S）' : '已保存（Ctrl/Cmd+S）';
  }

  // ---------- C: 防抖自动保存草稿（空闲 20s 写草稿键；刷新/崩溃不丢未保存改动） ----------
  var draftTimer = null;
  var DRAFT_MS = 20000;
  // 收集当前编辑态的全部覆盖 + 块（与 saveEdits 同样的收集逻辑，抽出复用）
  function collectPayload() {
    var blocks = [];
    var seen = {};
    $all('#xl-edit-blocks .xl-block').forEach(function (wrap) {
      var type = wrap.dataset.type;
      var id = wrap.dataset.bid || genId();
      if (seen[id]) return;
      seen[id] = 1;
      var w = parseInt(wrap.dataset.w || '0', 10) || 0;
      var h = parseInt(wrap.dataset.h || '0', 10) || 0;
      if (type === 'textbox') {
        var inner = wrap.querySelector('.xl-block-inner');
        blocks.push({ id: id, type: 'textbox', html: inner.innerHTML, style: inner.getAttribute('style') || '', w: w, h: h });
      } else if (type === 'image') {
        var img = wrap.querySelector('img');
        blocks.push({ id: id, type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '', w: w, h: h });
      } else if (type === 'video') {
        blocks.push({ id: id, type: 'video', url: wrap.dataset.url || '', w: w, h: h });
      } else if (type === 'file') {
        blocks.push({ id: id, type: 'file', url: wrap.dataset.url || '', name: wrap.dataset.name || '', w: w, h: h });
      }
    });
    return { path: curPath(), edits: edits, blocks: blocks };
  }
  function scheduleDraft() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_MS);
  }
  function saveDraft() {
    draftTimer = null;
    if (!active || !dirty || saving) return;
    var payload = collectPayload();
    payload.draft = true;
    fetch('/api/page-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) toast('已自动保存草稿');
    }).catch(function () {});
  }
  // 显式保存成功后清掉草稿键
  function clearDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    fetch('/api/page-edit?draft=1&path=' + encodeURIComponent(curPath()), { method: 'DELETE' })
      .catch(function () {});
  }
  // 进入编辑态时恢复上次未保存的草稿
  function loadDraft() {
    fetch('/api/page-edit?draft=1&path=' + encodeURIComponent(curPath()))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var dEdits = d.edits || {};
        var dBlocks = Array.isArray(d.blocks) ? d.blocks : [];
        if (!Object.keys(dEdits).length && !dBlocks.length) return;
        Object.keys(dEdits).forEach(function (sel) { edits[sel] = dEdits[sel]; });
        var c = blocksContainer();
        $all('.xl-block', c).forEach(function (w) { w.remove(); });
        dBlocks.forEach(function (b) { c.appendChild(buildBlockEl(b)); });
        dirty = true; updateSaveBtn();
        toast('已恢复未保存的草稿');
      })
      .catch(function () {});
  }

  function saveSel() {
    var s = window.getSelection();
    if (s && s.rangeCount) {
      var r = s.getRangeAt(0);
      if (r && activeInner && activeInner.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
    }
  }
  function restoreSel() {
    if (savedRange && activeInner) {
      try {
        activeInner.focus();
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
        return;
      } catch (_) {}
    }
    if (activeInner) activeInner.focus();
  }

  function setActive(wrap) {
    activeWrap = wrap;
    $all('#xl-edit-blocks .xl-block').forEach(function (w) { w.classList.toggle('active', w === wrap); });
    if (active && wrap) attachHandles(wrap); else detachHandles();
    updateSizeRead();
    updateCtxTab();
  }

  // ---------- 长宽拖拽（Microsoft 365 式：4 角 + 4 边共 8 个手柄） ----------
  var HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var sizeBadge = null;   // 拖拽时跟随的「宽 × 高」气泡
  var sizeRead = null;    // 工具栏里的尺寸读数（showUI 中创建）

  // 图片 / 视频：任何手柄都保持原始比例（同 Word / PowerPoint 拖图片的行为）
  // 文本框 / 附件：自由改长宽
  function keepRatioType(t) { return t === 'image' || t === 'video'; }
  function minBoxFor(t) { return keepRatioType(t) ? { w: 80, h: 45 } : { w: 120, h: 40 }; }

  // 量「实际显示的内容」而不是外层容器：小图放在整宽容器里时，容器宽并不是图片宽
  function boxTarget(wrap) {
    return wrap.querySelector('img, video, iframe, .xl-file, .xl-block-inner') || wrap;
  }
  function currentBox(wrap) {
    var r = boxTarget(wrap).getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }

  function attachHandles(wrap) {
    detachHandles();
    if (!wrap) return;
    HANDLE_DIRS.forEach(function (dir) {
      var h = document.createElement('span');
      h.className = 'xl-rz xl-rz-' + dir;
      h.dataset.dir = dir;
      h.title = '拖动调整大小';
      h.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
      h.addEventListener('pointerdown', startResize);
      wrap.appendChild(h);
    });
  }
  function detachHandles() {
    $all('.xl-rz').forEach(function (h) { h.remove(); });
  }

  function showSizeBadge(text, x, y) {
    if (!sizeBadge) {
      sizeBadge = document.createElement('div');
      sizeBadge.className = 'xl-size-badge';
      document.body.appendChild(sizeBadge);
    }
    sizeBadge.textContent = text;
    sizeBadge.style.left = Math.max(6, x) + 'px';
    sizeBadge.style.top = Math.max(6, y) + 'px';
    sizeBadge.classList.add('show');
  }
  function hideSizeBadge() { if (sizeBadge) sizeBadge.classList.remove('show'); }

  function updateSizeRead() {
    if (!sizeRead) return;
    if (!activeWrap) { sizeRead.textContent = '未选中内容块'; return; }
    var b = currentBox(activeWrap);
    var auto = !activeWrap.dataset.w && !activeWrap.dataset.h;
    sizeRead.textContent = b.w + ' × ' + b.h + (auto ? ' · 自适应' : '');
  }

  function startResize(e) {
    var handle = e.currentTarget;
    var wrap = handle.closest && handle.closest('.xl-block');
    if (!wrap) return;
    var dir = handle.dataset.dir || 'se';
    e.preventDefault();
    e.stopPropagation();

    var type = wrap.dataset.type;
    var ratioLocked = keepRatioType(type);
    var target = boxTarget(wrap);
    var startRect = target.getBoundingClientRect();
    var startW = startRect.width;
    var startH = startRect.height;
    var ratio = startH > 0 ? startW / startH : 16 / 9;
    // 图片优先用原始像素比例，避免被 CSS 拉伸时算错
    if (target.tagName === 'IMG' && target.naturalWidth && target.naturalHeight) {
      ratio = target.naturalWidth / target.naturalHeight;
    }
    var startX = e.clientX, startY = e.clientY;
    var min = minBoxFor(type);

    // 拖拽期间关掉 iframe/video 的指针事件，否则鼠标划过播放器会丢事件
    document.body.classList.add('xl-resizing');

    function move(ev) {
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      var horiz = dir.indexOf('e') !== -1 || dir.indexOf('w') !== -1;
      var vert = dir.indexOf('n') !== -1 || dir.indexOf('s') !== -1;
      var w = startW, h = startH;

      if (horiz) w = startW + (dir.indexOf('e') !== -1 ? dx : -dx);
      if (vert) h = startH + (dir.indexOf('s') !== -1 ? dy : -dy);
      if (ratioLocked) {
        if (horiz) h = w / ratio;      // 横向拖 → 以宽为准
        else w = h * ratio;            // 纯纵向拖 → 以高为准
      }

      w = Math.max(min.w, Math.round(w));
      h = Math.max(min.h, Math.round(h));

      wrap.style.width = w + 'px';
      wrap.style.height = h + 'px';
      wrap.dataset.w = String(w);
      wrap.dataset.h = String(h);

      var b = wrap.getBoundingClientRect();
      showSizeBadge(Math.round(b.width) + ' × ' + Math.round(b.height), b.left, b.top - 28);
      updateSizeRead();
    }

    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.body.classList.remove('xl-resizing');
      hideSizeBadge();
      updateSizeRead();
      markDirty();
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  // 恢复自适应尺寸（清掉写死的长宽）
  function resetSize() {
    if (!activeWrap) { toast('请先点选一个内容块'); return; }
    activeWrap.style.width = '';
    activeWrap.style.height = '';
    delete activeWrap.dataset.w;
    delete activeWrap.dataset.h;
    updateSizeRead();
    markDirty();
    toast('已恢复为自适应尺寸');
  }

  // ---------- 富文本命令 ----------
  // execCommand 虽已废弃，但仍是各浏览器普遍支持的富文本实现方式
  function exec(cmd, val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel();                 // 抓最新选区
    restoreSel();              // 把焦点和选区还原文本框
    try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) {}
    saveSel();                 // 命令后选区结构可能变化，刷新快照
    markDirty();
    updateToolbarState();
  }

  var STATE_CMDS = {
    bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strike',
    subscript: 'sub', superscript: 'sup',
    justifyLeft: 'aleft', justifyCenter: 'acenter', justifyRight: 'aright',
    insertUnorderedList: 'ul', insertOrderedList: 'ol'
  };
  function updateToolbarState() {
    if (!banner) return;
    Object.keys(STATE_CMDS).forEach(function (cmd) {
      var btn = banner.querySelector('.xl-tb-btn[data-cmd="' + STATE_CMDS[cmd] + '"]');
      if (!btn) return;
      var on = false;
      try { on = document.queryCommandState(cmd); } catch (e) {}
      btn.classList.toggle('on', !!on);
    });
  }

  function onTextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.currentTarget;
    if (el.getAttribute('contenteditable') === 'true') return;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    activeInner = el;
    activeWrap = null;
    savedRange = null;
    var blurTimer = null;
    function done() {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('focusin', onFocusIn);
      el.removeAttribute('contenteditable');
      if (isBilingualNode(el)) {
        // 双语节点：记录编辑时语言；已有的另一语言译文（上次确认过的）原样保留
        var prev = edits[xlKey(el)] || {};
        var rec = { type: 'text', value: el.innerHTML, lang: curLang() };
        if (prev.alt != null && prev.altLang && prev.altLang !== rec.lang) { rec.alt = prev.alt; rec.altLang = prev.altLang; }
        edits[xlKey(el)] = rec;
      } else {
        edits[xlKey(el)] = { type: 'text', value: el.innerHTML };
      }
      markDirty();
      if (activeInner === el) { activeInner = null; savedRange = null; }
    }
    // 延迟保存：给点工具栏（字体/字号下拉）留出时间，避免焦点一移开就丢失编辑态
    function onBlur() {
      if (!blurTimer) blurTimer = setTimeout(done, 600);
    }
    function onFocusIn() {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      activeInner = el;
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('focusin', onFocusIn);
  }

  function onImgClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var img = e.currentTarget;
    var cur = img.getAttribute('src') || '';
    var url = window.prompt('输入新的图片地址（http/https 或以 / 开头的站内路径）：', cur);
    if (url === null) return;
    url = url.trim();
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url) && !/^data:image\//i.test(url)) {
      window.alert('地址不合法：仅支持 http/https 或 / 开头的站内路径。');
      return;
    }
    img.src = url;
    edits[xlKey(img)] = { type: 'img', value: url };
    markDirty();
  }

  // ---------- 本地文件上传 ----------
  function isValidMediaUrl(url) {
    return /^https?:\/\//i.test(url) || /^\//.test(url) || /^data:image\//i.test(url) || /^\/api\/file/i.test(url);
  }

  // 把本地文件上传到 /api/upload（需登录），返回 { url, name }
  // upload.js 不限制文件类型（单文件 ≤20MB），所以图片 / 视频 / 任意附件都走这一条路
  function uploadFile(file) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file);
      fetch('/api/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          if (!o.ok || !o.d.ok) { reject(new Error(o.d && o.d.error ? o.d.error : 'upload_failed')); return; }
          resolve({
            url: '/api/file?key=' + encodeURIComponent(o.d.key),
            name: o.d.name || file.name || ''
          });
        })
        .catch(function (e) { reject(e); });
    });
  }

  // 从链接里猜一个文件名，作为附件块的显示名
  function nameFromUrl(url) {
    var seg = '';
    try {
      seg = String(url).split('?')[0].split('/').filter(Boolean).pop() || '';
      seg = decodeURIComponent(seg);
    } catch (e) {}
    return seg || String(url);
  }

  // 插入来源的文案配置（文本框不走弹窗，直接新建空文本框）
  var INSERT_META = {
    image: {
      title: '插入图片', accept: 'image/*', local: '📁 本地图片', uploading: '图片上传中…',
      promptText: '输入图片地址（http/https 或以 / 开头的站内路径）：'
    },
    video: {
      title: '插入视频', accept: 'video/*', local: '📁 本地视频', uploading: '视频上传中…',
      promptText: '输入视频地址（YouTube 链接，或 .mp4/.webm/.ogg 直链）：'
    },
    file: {
      title: '插入文件', accept: '', local: '📁 本地文件', uploading: '文件上传中…',
      promptText: '输入文件地址（http/https 或以 / 开头的站内路径）：'
    }
  };

  // 插入来源选择弹窗：本地文件 / 用链接。cb 收到 { url, name }
  function pickInsertSource(kind, cb) {
    var meta = INSERT_META[kind];
    if (!meta) return;
    var overlay = document.createElement('div');
    overlay.className = 'xl-insert-modal';
    var box = document.createElement('div');
    box.className = 'xl-insert-box';
    var title = document.createElement('div');
    title.className = 'xl-insert-title';
    title.textContent = meta.title;
    box.appendChild(title);

    var fileIn = document.createElement('input');
    fileIn.type = 'file';
    if (meta.accept) fileIn.accept = meta.accept;
    fileIn.style.display = 'none';
    box.appendChild(fileIn);

    var optLocal = document.createElement('button');
    optLocal.type = 'button'; optLocal.className = 'xl-insert-opt';
    optLocal.textContent = meta.local;
    var optLink = document.createElement('button');
    optLink.type = 'button'; optLink.className = 'xl-insert-opt';
    optLink.textContent = '🔗 用链接';
    var optCancel = document.createElement('button');
    optCancel.type = 'button'; optCancel.className = 'xl-insert-opt xl-insert-cancel';
    optCancel.textContent = '取消';
    box.appendChild(optLocal); box.appendChild(optLink); box.appendChild(optCancel);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    optCancel.addEventListener('click', close);

    optLocal.addEventListener('click', function () {
      fileIn.value = '';
      fileIn.onchange = function () {
        var f = fileIn.files && fileIn.files[0];
        if (!f) return;
        close();
        toast(meta.uploading);
        uploadFile(f).then(function (r) { cb(r); })
          .catch(function (err) {
            window.alert('上传失败：' + (err && err.message ? err.message : '未知错误') +
              '\n（需登录，且文件 ≤ 20MB）');
          });
      };
      fileIn.click();
    });

    optLink.addEventListener('click', function () {
      close();
      var url = window.prompt(meta.promptText, '');
      if (url === null) return;
      url = url.trim();
      if (!url) return;
      if (!isValidMediaUrl(url)) { window.alert('地址不合法。'); return; }
      cb({ url: url, name: nameFromUrl(url) });
    });
  }

  // ---------- 块操作 ----------
  // 统一的「落块」入口：追加 → 选中（自动挂上拖拽手柄）→ 标脏 → 滚入视野
  function addBlock(b) {
    blocksContainer().appendChild(b);
    ensureStableIds();   // 新块立即分配稳定 id，否则本次对它的修改会退化回易碎的位置选择器
    setActive(b);
    markDirty();
    try { b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    return b;
  }

  // 在指定位置落块：top=页面顶部 / before|after=当前选中块 / 其余=页面底部
  function addBlockAt(b, where) {
    var c = blocksContainer();
    var ref = null;
    if (where === 'top') ref = c.firstChild;
    else if (where === 'before' && activeWrap && activeWrap.parentNode === c) ref = activeWrap;
    else if (where === 'after' && activeWrap && activeWrap.parentNode === c) ref = activeWrap.nextSibling;
    if (ref) c.insertBefore(b, ref);
    else c.appendChild(b);
    ensureStableIds();   // 同上：新建块先拿稳定 id
    setActive(b);
    markDirty();
    try { b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    return b;
  }

  // 位置选择器：自带样式（不依赖各站 editbar.css，4 站通用）
  function ensurePosCss() {
    if (document.getElementById('xl-pos-style')) return;
    var s = document.createElement('style');
    s.id = 'xl-pos-style';
    s.textContent = ''
      + '.xl-pos-modal{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}'
      + '.xl-pos-box{width:min(320px,90vw);background:#fff;color:#1c2733;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:14px;font-size:.95rem}'
      + '.xl-pos-title{font-weight:600;margin-bottom:10px}'
      + '.xl-pos-opt{display:block;width:100%;margin:6px 0;padding:11px 14px;border:1px solid #d7deea;border-radius:10px;background:#f5f8fc;color:#1c2733;font-size:.95rem;cursor:pointer;text-align:left}'
      + '.xl-pos-opt:hover{background:#eaf2fc}'
      + '.xl-pos-cancel{background:#f0f0f0;border-color:#ddd}'
      + 'html[data-theme="dark"] .xl-pos-box{background:#1e2733;color:#e6edf5;box-shadow:0 12px 40px rgba(0,0,0,.6)}'
      + 'html[data-theme="dark"] .xl-pos-opt{background:#26313f;color:#e6edf5;border-color:#34425a}'
      + 'html[data-theme="dark"] .xl-pos-opt:hover{background:#2f3c4d}';
    document.head.appendChild(s);
  }

  // 插入前让用户选择落点；未选中内容块时只给 顶部/底部
  function pickInsertPos(cb) {
    ensurePosCss();
    var overlay = document.createElement('div');
    overlay.className = 'xl-pos-modal';
    var box = document.createElement('div');
    box.className = 'xl-pos-box';
    var title = document.createElement('div');
    title.className = 'xl-pos-title';
    title.textContent = '插入到哪里？';
    box.appendChild(title);

    var c = blocksContainer();
    var hasActive = !!(activeWrap && activeWrap.parentNode === c);
    var opts = [
      { label: '⤒ 页面顶部', val: 'top' },
      { label: '↑ 当前块之前', val: 'before', show: hasActive },
      { label: '↓ 当前块之后', val: 'after', show: hasActive },
      { label: '⤓ 页面底部', val: 'bottom' }
    ];
    opts.forEach(function (o) {
      if (o.show === false) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xl-pos-opt';
      b.textContent = o.label;
      b.addEventListener('click', function () { close(); cb(o.val); });
      box.appendChild(b);
    });
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'xl-pos-opt xl-pos-cancel';
    cancel.textContent = '取消';
    box.appendChild(cancel);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    cancel.addEventListener('click', close);
  }

  function makeTextbox() {
    pickInsertPos(function (where) {
      var b = buildBlockEl({ id: genId(), type: 'textbox', html: '' });
      addBlockAt(b, where);
      activeInner = b.querySelector('.xl-block-inner');
      activeInner.setAttribute('contenteditable', 'true');
      activeInner.focus();
    });
  }

  function deleteActive() {
    if (!activeWrap) { toast('请先点选要删除的内容块'); return; }
    activeWrap.remove();
    activeWrap = null; activeInner = null; savedRange = null;
    detachHandles();
    updateSizeRead();
    updateCtxTab();
    markDirty();
    toast('已删除该内容块');
  }

  // 上移 / 下移（dir = -1 上移，+1 下移）
  function moveActive(dir) {
    if (!activeWrap) { toast('请先点选要移动的内容块'); return; }
    var c = blocksContainer();
    var blocks = $all('.xl-block', c);
    var i = blocks.indexOf(activeWrap);
    if (i < 0) return;
    var j = i + dir;
    if (j < 0) { toast('已经在最上面了'); return; }
    if (j >= blocks.length) { toast('已经在最下面了'); return; }
    if (dir < 0) c.insertBefore(activeWrap, blocks[j]);
    else if (blocks[j].nextSibling) c.insertBefore(activeWrap, blocks[j].nextSibling);
    else c.appendChild(activeWrap);
    activeWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    markDirty();
    toast(dir < 0 ? '已上移' : '已下移');
  }

  function duplicateActive() {
    if (!activeWrap) { toast('请先点选要复制的内容块'); return; }
    var clone = activeWrap.cloneNode(true);
    clone.dataset.bid = genId();
    clone.classList.remove('active');
    activeWrap.parentNode.insertBefore(clone, activeWrap.nextSibling);
    setActive(clone);
    markDirty();
    toast('已复制此块');
  }

  function insertImage() {
    pickInsertSource('image', function (r) {
      pickInsertPos(function (where) {
        addBlockAt(buildBlockEl({ id: genId(), type: 'image', src: r.url, alt: '' }), where);
      });
    });
  }

  function insertVideo() {
    pickInsertSource('video', function (r) {
      pickInsertPos(function (where) {
        addBlockAt(buildBlockEl({ id: genId(), type: 'video', url: r.url }), where);
      });
    });
  }

  function insertFile() {
    pickInsertSource('file', function (r) {
      pickInsertPos(function (where) {
        addBlockAt(buildBlockEl({ id: genId(), type: 'file', url: r.url, name: r.name }), where);
      });
    });
  }

  function applyFont(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    // 下拉框 mousedown 时已保存选区；change 时再 saveSel 会覆盖为折叠光标。
    if (!savedRange || savedRange.collapsed) { activeInner.style.fontFamily = val; markDirty(); return; }
    restoreSel();
    var applied = false;
    try { document.execCommand('fontName', false, val); applied = true; } catch (_) {}
    if (!applied) applied = applyStyleToRange('fontFamily', val);
    if (!applied) activeInner.style.fontFamily = val;
    markDirty();
    updateToolbarState();
  }

  function applySize(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    if (!savedRange || savedRange.collapsed) { activeInner.style.fontSize = val; markDirty(); return; }
    restoreSel();
    applyStyleToRange('fontSize', val);
    markDirty();
  }

  // 调色板与最近色：localStorage 记住最近 8 个用过的颜色
  var RECENT_COLORS_KEY = 'xl_edit_recent_colors';
  var RECENT_COLORS_MAX = 8;
  var RECENT_BG_KEY = 'xl_edit_recent_bg';
  function getRecent(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function setRecent(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr.slice(0, RECENT_COLORS_MAX))); } catch (e) {} }
  function pushRecent(key, val) {
    if (!val) return;
    var arr = getRecent(key).filter(function (x) { return x.toLowerCase() !== val.toLowerCase(); });
    arr.unshift(val);
    setRecent(key, arr);
  }

  // 在选区上应用包裹标签（用于背景色等 execCommand 难处理的情况）
  function applyStyleToRange(prop, val) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    // 包裹：逐个 textNode 套一层 <span style="...">
    var spans = [];
    // 关键：选区落在单个文本节点上时，commonAncestorContainer 本身就是该文本节点，
    // 以它为根遍历文本节点会一无所获。必须改用其父元素作为遍历起点。
    var root = range.commonAncestorContainer;
    if (root && root.nodeType === Node.TEXT_NODE) root = root.parentElement || root;
    if (!root) return false;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        // 仅接受与 range 有交集的文本节点
        if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        // 跳过空文本
        if (!n.nodeValue || !n.nodeValue.trim().length) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var span = document.createElement('span');
      span.style[prop] = val;
      var parent = node.parentNode;
      // 如果父节点已经是带同样 prop 的 span，复用
      if (parent && parent.tagName === 'SPAN' && parent.style[prop] === val &&
          parent.childNodes.length === 1) {
        continue;
      }
      parent.insertBefore(span, node);
      span.appendChild(node);
      spans.push(span);
    }
    // 应用后重新把选区拉回被包裹的文字，避免 A+/A-、颜色等按钮按一次就丢选区
    if (spans.length > 0) {
      try {
        var newSel = window.getSelection();
        var newRange = document.createRange();
        newRange.setStartBefore(spans[0]);
        newRange.setEndAfter(spans[spans.length - 1]);
        newSel.removeAllRanges();
        newSel.addRange(newRange);
        savedRange = newRange.cloneRange();
      } catch (_) {}
    }
    return spans.length > 0;
  }

  function applyColor(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    val = (val || '').toLowerCase();
    if (!val) return;
    saveSel();
    restoreSel();
    var ok = false;
    if (savedRange && !savedRange.collapsed) {
      try {
        // execCommand 兼容性最好，但现代浏览器可能对其弃用；双保险
        document.execCommand('foreColor', false, val);
        ok = true;
      } catch (_) {}
      if (!ok) ok = applyStyleToRange('color', val);
    }
    if (!ok) activeInner.style.color = val;
    pushRecent(RECENT_COLORS_KEY, val);
    refreshRecents();
    markDirty();
  }

  function applyHighlight(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    val = (val || '').toLowerCase();
    if (!val) return;
    saveSel();
    restoreSel();
    var ok = false;
    if (savedRange && !savedRange.collapsed) {
      try {
        document.execCommand('hiliteColor', false, val);
        ok = true;
      } catch (_) {}
      if (!ok) ok = applyStyleToRange('backgroundColor', val);
    }
    if (!ok) activeInner.style.backgroundColor = val;
    pushRecent(RECENT_BG_KEY, val);
    refreshRecents();
    markDirty();
  }

  function applyClearFormat() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel();
    restoreSel();
    if (savedRange && !savedRange.collapsed) {
      try { document.execCommand('removeFormat'); } catch (_) {}
    } else {
      // 清空 activeInner 上的所有 inline style
      activeInner.removeAttribute('style');
    }
    markDirty();
  }

  // 原「🔍＋ / 🔍－」按 transform:scale 缩放的做法已移除：
  // 现在直接拖动内容块四角/四边改真实长宽（见 startResize / resetSize），
  // 尺寸会随块一起保存，所有访客看到的都是同一尺寸。

  function insertLink() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel();
    restoreSel();
    if (!savedRange || savedRange.collapsed) { toast('请先在文本框里选中要加链接的文字'); return; }
    var url = window.prompt('输入链接地址（http/https 或以 / 开头）：', 'https://');
    if (url === null) return;
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) { window.alert('地址不合法。'); return; }
    exec('createLink', url);
  }

  // 字号档位（用于 A+/A-）
  var FONT_SIZE_STEPS = [10,11,12,14,16,18,20,22,24,28,32,36,42,48,56,64,72,96];
  function nearestStep(px, delta) {
    for (var i = 0; i < FONT_SIZE_STEPS.length; i++) {
      if (FONT_SIZE_STEPS[i] > px) return delta > 0 ? FONT_SIZE_STEPS[i] : FONT_SIZE_STEPS[Math.max(0, i - 1)];
    }
    return delta > 0 ? FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1] : FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 2];
  }
  function changeFontSize(delta) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    // 按钮 mousedown 时已 saveSel()；这里不要重复 save，否则会把保存的选区覆盖成折叠光标。
    if (!savedRange || savedRange.collapsed) { toast('请先选中要调整字号的文字'); return; }
    restoreSel();
    var node = savedRange.startContainer;
    var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    var cur = parseFloat(window.getComputedStyle(el).fontSize) || 16;
    var targetPx = nearestStep(cur, delta);
    applyStyleToRange('fontSize', targetPx + 'px');
    markDirty();
    updateToolbarState();
  }
  function applyLineHeight(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (savedRange && !savedRange.collapsed) {
      applyStyleToRange('lineHeight', val);
    } else {
      activeInner.style.lineHeight = val;
    }
    markDirty();
  }
  function applyListType(type) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    // 先确保生成有序列表
    try { document.execCommand('insertOrderedList', false, null); } catch (_) {}
    // 找到包含选区或光标最近的 ol
    var sel = window.getSelection();
    var node = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    var ol = null;
    while (node && node !== activeInner && node !== document.body) {
      if (node.nodeType === 1 && node.tagName === 'OL') { ol = node; break; }
      node = node.parentNode;
    }
    if (!ol && activeInner) ol = activeInner.querySelector('ol');
    if (ol) {
      ol.setAttribute('type', type);
      // 去掉可能覆盖 type 的 CSS list-style-type
      ol.style.listStyleType = '';
    }
    markDirty();
  }

  // ----- Microsoft 365 “开始” 选项卡补齐（剪贴板 / 段落 / 编辑） -----
  function pastePlain() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (text) { document.execCommand('insertText', false, text); markDirty(); }
      }).catch(function () { toast('无法读取剪贴板，请使用 Ctrl+V 粘贴'); });
    } else { toast('浏览器不支持剪贴板读取，请使用 Ctrl+V'); }
  }
  function pasteKeep() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (navigator.clipboard && navigator.clipboard.readHTML) {
      navigator.clipboard.readHTML().then(function (html) {
        if (html) { document.execCommand('insertHTML', false, html); markDirty(); }
      }).catch(function () { pastePlain(); });
    } else { pastePlain(); }
  }
  function applyMultiLevelList(action) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (action === 'indent') { try { document.execCommand('indent'); } catch (_) {} }
    else { try { document.execCommand('outdent'); } catch (_) {} }
    markDirty();
  }
  function applyParaShading(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (savedRange && !savedRange.collapsed) { applyStyleToRange('backgroundColor', val); }
    else { activeInner.style.backgroundColor = val; }
    markDirty();
  }
  function applyParaBorder() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    if (savedRange && !savedRange.collapsed) {
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      var root = range.commonAncestorContainer;
      if (root && root.nodeType === Node.TEXT_NODE) root = root.parentElement || root;
      if (!root) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
          if (!n.nodeValue || !n.nodeValue.trim().length) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node;
      while ((node = walker.nextNode())) {
        var span = document.createElement('span');
        span.style.border = '1px solid #999';
        var parent = node.parentNode;
        parent.insertBefore(span, node); span.appendChild(node);
      }
    } else {
      activeInner.style.border = '1px solid #999';
    }
    markDirty();
  }
  function sortSelection() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    var ol = activeInner.querySelector('ol');
    if (!ol) { toast('请先选中编号列表再排序'); return; }
    var items = Array.from(ol.children);
    items.sort(function (a, b) { return a.textContent.trim().localeCompare(b.textContent.trim(), 'zh-CN'); });
    items.forEach(function (it) { ol.appendChild(it); });
    markDirty();
  }
  var marksOn = false;
  function toggleFormattingMarks() {
    marksOn = !marksOn;
    document.querySelectorAll('.xl-block-inner, [contenteditable="true"]').forEach(function (el) {
      el.classList.toggle('xl-show-marks', marksOn);
    });
    toast(marksOn ? '已显示编辑标记' : '已隐藏编辑标记');
  }
  function selectAllInActive() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    activeInner.focus();
    var r = document.createRange(); r.selectNodeContents(activeInner);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function speakSelection() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    var sel = window.getSelection();
    var text = sel && !sel.isCollapsed ? sel.toString() : activeInner.innerText;
    if (!text.trim()) { toast('没有可朗读的内容'); return; }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = document.documentElement.lang || 'zh-CN';
      window.speechSynthesis.speak(u);
    } else { toast('当前浏览器不支持朗读'); }
  }
  function applyNoSpacing() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel(); restoreSel();
    activeInner.style.lineHeight = '1';
    activeInner.style.margin = '0';
    activeInner.querySelectorAll('p').forEach(function (p) { p.style.margin = '0'; p.style.padding = '0'; });
    markDirty();
  }
  function showMoreStyles() {
    toast('更多样式：后续支持自定义样式库');
  }

  // ================= 扩展功能（扫描 Microsoft 365 全功能带后补齐） =================
  // —— 格式刷 ——
  var painterCss = null;
  function mergeInlineStyle(el, css) {
    if (!el || !css) return;
    css.split(';').forEach(function (p) {
      var m = p.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/);
      if (m) { try { el.style.setProperty(m[1], m[2]); } catch (e) {} }
    });
  }
  function applyRawStyleToRange(css) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    var root = range.commonAncestorContainer;
    if (root && root.nodeType === Node.TEXT_NODE) root = root.parentElement || root;
    if (!root) return false;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return (range.intersectsNode(n) && n.nodeValue && n.nodeValue.trim().length)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    // 先把命中的文本节点收集完，再统一包裹：
    // 一边遍历一边把节点搬进新 span 会打乱 TreeWalker 的游标，造成后半段漏掉、样式只上一半。
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (n) {
      if (!n.parentNode) return;
      var span = document.createElement('span');
      span.setAttribute('style', css);
      n.parentNode.insertBefore(span, n);
      span.appendChild(n);
    });
    return nodes.length > 0;
  }
  function capturePainter() {
    if (!activeInner) { toast(xlT('请先点选一个文本框', 'Select a text box first')); return false; }
    saveSel(); restoreSel();
    if (!savedRange || savedRange.collapsed) { toast(xlT('请先选中带格式的文字', 'Select formatted text first')); return false; }
    var n = savedRange.startContainer;
    if (n.nodeType === 3) n = n.parentElement;
    while (n && n !== activeInner && !n.getAttribute('style')) n = n.parentElement;
    painterCss = n ? (n.getAttribute('style') || '') : '';
    if (!painterCss) { toast(xlT('该文字没有可复制的内联格式', 'No inline format to copy from this text')); return false; }
    toast(xlT('已复制格式，选中目标文字后再次点「格式刷」粘贴', 'Format copied — select target text and click Painter again'));
    return true;
  }
  function applyPainter() {
    if (!painterCss) { capturePainter(); return; }
    saveSel(); restoreSel();
    if (savedRange && !savedRange.collapsed) applyRawStyleToRange(painterCss);
    else if (activeInner) mergeInlineStyle(activeInner, painterCss);
    markDirty();
  }
  // —— 查找 / 替换 ——
  function selectTextIn(root, q) {
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walk.nextNode())) {
      var i = (n.nodeValue || '').toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0) {
        var r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + q.length);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        if (activeInner) activeInner.focus();
        return true;
      }
    }
    return false;
  }
  function doFind() {
    if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    var q = window.prompt(xlT('查找内容：', 'Find what:'), '');
    if (q === null || !q) return;
    if (selectTextIn(activeInner, q)) toast(xlT('已定位首个匹配', 'First match located'));
    else toast(xlT('未找到', 'Not found'));
  }
  function doReplace() {
    if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    var q = window.prompt(xlT('查找内容：', 'Find what:'), '');
    if (q === null || !q) return;
    var rep = window.prompt(xlT('替换为（留空则删除）：', 'Replace with (empty = delete):'), '');
    if (rep === null) return;
    // 只在「文本节点」上替换：直接在 innerHTML 上跑正则会命中标签名/属性（如搜 span、class），
    // 也会把 < & 当 HTML 解析，把结构改坏；按纯文本处理则两者都不会发生。
    var walker = document.createTreeWalker(activeInner, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    var lq = q.toLowerCase();
    var hits = 0;
    nodes.forEach(function (tn) {
      var v = tn.nodeValue || '';
      var lv = v.toLowerCase();
      if (lv.indexOf(lq) < 0) return;
      var out = '';
      var i = 0;
      while (true) {
        var p = lv.indexOf(lq, i);
        if (p < 0) { out += v.slice(i); break; }
        out += v.slice(i, p) + rep;
        hits++;
        i = p + q.length;
      }
      tn.nodeValue = out;
    });
    if (!hits) { toast(xlT('未找到', 'Not found')); return; }
    markDirty();
    toast(xlT('已替换 ' + hits + ' 处', 'Replaced ' + hits));
  }
  // —— 更改大小写 ——
  function changeCase() {
    if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    saveSel(); restoreSel();
    if (!savedRange || savedRange.collapsed) { toast(xlT('请选中要改大小写的文字', 'Select text to change case')); return; }
    var t = savedRange.toString();
    if (!t) return;
    var lower = t.toLowerCase();
    var title = lower.replace(/(^|\s)\w/g, function (c) { return c.toUpperCase(); });
    var mode = window.prompt(xlT('更改大小写：1=句首大写 2=全大写 3=全小写', 'Change case: 1=Title 2=UPPER 3=lower'), '1');
    if (mode === null) return;
    var out = mode === '2' ? t.toUpperCase() : mode === '3' ? lower : title;
    try { document.execCommand('insertText', false, out); } catch (e) {}
    markDirty();
  }
  // —— 插入：表格 / 块 ——
  function insertBlockHtml(html) {
    pickInsertPos(function (where) {
      var b = buildBlockEl({ id: genId(), type: 'textbox', html: html });
      addBlockAt(b, where);
    });
  }
  function insertTable() {
    saveSel();
    var rv = window.prompt(xlT('行数：', 'Rows:'), '3');
    if (rv === null) return;                                  // 点取消应中止，而不是按默认值继续
    var cv = window.prompt(xlT('列数：', 'Cols:'), '3');
    if (cv === null) return;
    var rows = parseInt(rv, 10);
    var cols = parseInt(cv, 10);
    if (!(rows >= 1)) rows = 3;
    if (!(cols >= 1)) cols = 3;
    if (rows > 50) rows = 50;                                 // 上限保护：手滑输 9999 会生成海量单元格卡死页面
    if (cols > 20) cols = 20;
    var html = '<table class="xl-edit-table" style="border-collapse:collapse;width:100%;margin:8px 0">';
    for (var r = 0; r < rows; r++) {
      html += '<tr>';
      for (var c = 0; c < cols; c++) html += '<td style="border:1px solid #ccc;padding:6px 8px;min-width:48px">&nbsp;</td>';
      html += '</tr>';
    }
    html += '</table>';
    if (activeInner) {
      restoreSel();
      try { document.execCommand('insertHTML', false, html); markDirty(); return; }
      catch (e) { activeInner.insertAdjacentHTML('beforeend', html); }
    } else { insertBlockHtml(html); }
    markDirty();
  }
  // —— 插入：符号面板 ——
  function insertSymbol() {
    saveSel();
    var syms = ['©', '®', '™', '§', '¶', '•', '★', '☆', '♦', '♥', '♠', '♣',
      '→', '←', '↑', '↓', '↔', '≈', '≠', '≡', '≤', '≥', '±', '×', '÷', '∞',
      '€', '£', '¥', '°', '′', '″', '…', '—', '–', '“', '”', '‘', '’', '«', '»',
      '‰', '¼', '½', '¾', '✓', '✗', '☎', '✉', '☰'];
    var mask = document.createElement('div'); mask.className = 'xl-sym-mask';
    var panel = document.createElement('div'); panel.className = 'xl-sym-panel';
    var title = document.createElement('div'); title.className = 'xl-sym-title';
    title.textContent = xlT('插入符号', 'Insert symbol');
    var close = document.createElement('button'); close.type = 'button'; close.className = 'xl-sym-close'; close.textContent = '✕';
    close.addEventListener('mousedown', keepSel);
    close.addEventListener('click', function () { if (mask.parentNode) mask.parentNode.removeChild(mask); });
    panel.appendChild(title); panel.appendChild(close);
    var grid = document.createElement('div'); grid.className = 'xl-sym-grid';
    syms.forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'xl-sym-cell'; b.textContent = s;
      b.addEventListener('mousedown', keepSel);
      b.addEventListener('click', function () {
        restoreSel();
        if (activeInner) { try { document.execCommand('insertText', false, s); } catch (e) { activeInner.insertAdjacentText('beforeend', s); } }
        else toast(xlT('请先点选文本框', 'Select a text box'));
        markDirty();
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      });
      grid.appendChild(b);
    });
    panel.appendChild(grid); mask.appendChild(panel);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask && mask.parentNode) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);
  }
  // —— 插入：分页符 ——
  function insertPageBreak() {
    saveSel();
    var hr = '<hr class="xl-page-break" style="border:none;border-top:2px dashed #bbb;margin:14px 0">';
    if (activeInner) {
      restoreSel();
      try { document.execCommand('insertHTML', false, hr); markDirty(); return; }
      catch (e) { activeInner.insertAdjacentHTML('beforeend', hr); }
    } else { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    markDirty();
  }
  // —— 插入：书签 ——
  function insertBookmark() {
    if (!activeInner) { toast(xlT('请先点选文字', 'Select text first')); return; }
    saveSel(); restoreSel();
    if (!savedRange || savedRange.collapsed) { toast(xlT('请选中要加书签的文字', 'Select text to bookmark')); return; }
    var name = window.prompt(xlT('书签名称（英文/数字）：', 'Bookmark name:'), 'mark' + Date.now().toString(36).slice(-4));
    if (name === null || !name) return;
    name = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return;
    // 书签应当是「可被跳转的目标」(带 id 的锚点)，不是指向 #name 的链接。
    // 用 createLink 会生成一个 href="#name" 的超链接，而页面里并没有 id="name" 的元素 → 点了跳不动。
    var sel = escHtml(savedRange.toString());
    var ok = false;
    try {
      ok = document.execCommand('insertHTML', false,
        '<span id="' + name + '" class="xl-bookmark">' + sel + '</span>');
    } catch (e) { ok = false; }
    if (!ok) { toast(xlT('插入书签失败', 'Failed to add bookmark')); return; }   // 别再弹「已插入」误导
    markDirty();
    toast(xlT('已插入书签 #' + name, 'Bookmark #' + name + ' added'));
  }
  // —— 设计：字体方案 / 段间距 ——
  function designFontSet(family) { if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; } applyFont(family); }
  function designParaSpacing(kind) {
    if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    saveSel(); restoreSel();
    var n = savedRange ? savedRange.startContainer : activeInner;
    if (n.nodeType === 3) n = n.parentElement;
    while (n && n !== activeInner && n.parentElement !== activeInner) n = n.parentElement;
    if (!n) n = activeInner;
    var mt = kind === 'compact' ? '6px' : kind === 'loose' ? '16px' : '10px';
    n.style.marginTop = mt; n.style.marginBottom = mt;
    markDirty();
  }
  // —— 审阅：字数统计 ——
  // 取页面正文文字：临时隐藏编辑工具条，避免把 Ribbon 上几十个按钮标签算进字数
  function pageText() {
    var prev = banner ? banner.style.display : '';
    if (banner) banner.style.display = 'none';
    var t = '';
    try { t = document.body.innerText || ''; } catch (e) { t = ''; }
    if (banner) banner.style.display = prev;
    return t;
  }
  function wordCount() {
    var text = activeInner ? activeInner.innerText : pageText();
    var chars = (text || '').replace(/\s/g, '').length;
    var words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    var lines = (text || '').split(/\n/).filter(function (l) { return l.trim(); }).length;
    window.alert(xlT('字数统计\n字符（不含空格）：' + chars + '\n单词：' + words + '\n行数：' + lines,
      'Word count\nChars (no spaces): ' + chars + '\nWords: ' + words + '\nLines: ' + lines));
  }
  // —— 审阅：批注 ——
  function addComment() {
    if (!activeInner) { toast(xlT('请先点选文字', 'Select text first')); return; }
    saveSel(); restoreSel();
    if (!savedRange || savedRange.collapsed) { toast(xlT('请选中要加批注的文字', 'Select text to comment')); return; }
    var c = window.prompt(xlT('批注内容：', 'Comment:'), '');
    if (c === null) return;
    var safe = escHtml(c).replace(/"/g, '&quot;');            // 进属性：& < > 都要转义，不只是引号
    var sel = escHtml(savedRange.toString());                 // 选中文字按纯文本转义，否则 & < 会被当标签
    try {
      document.execCommand('insertHTML', false,
        '<span class="xl-comment" data-comment="' + safe + '" title="' + safe +
        '" style="background:#fff36d;cursor:help;border-bottom:1px dotted #b59a00">' + sel + '</span>');
    } catch (e) {}
    markDirty();
  }
  // —— 审阅：拼写检查开关 ——
  function toggleSpell() {
    if (!activeInner) { toast(xlT('请先点选文本框', 'Select a text box')); return; }
    var on = activeInner.getAttribute('spellcheck') !== 'true';
    activeInner.setAttribute('spellcheck', on ? 'true' : 'false');
    toast(xlT(on ? '已开启拼写检查' : '已关闭拼写检查', on ? 'Spell check on' : 'Spell check off'));
  }
  // —— 视图：缩放 ——
  var xlZoom = (function () { try { return parseInt(localStorage.getItem('xl_zoom') || '100', 10) || 100; } catch (e) { return 100; } })();
  function setZoom(pct) {
    xlZoom = Math.max(50, Math.min(200, pct));
    try { document.documentElement.style.zoom = String(xlZoom / 100); localStorage.setItem('xl_zoom', String(xlZoom)); } catch (e) {}
    toast(xlT('缩放 ' + xlZoom + '%', 'Zoom ' + xlZoom + '%'));
  }
  function zoomIn() { setZoom(xlZoom + 10); }
  function zoomOut() { setZoom(xlZoom - 10); }
  function toggleRuler() {
    var on = document.body.classList.toggle('xl-show-ruler');
    toast(xlT(on ? '已显示标尺' : '已隐藏标尺', on ? 'Ruler shown' : 'Ruler hidden'));
  }
  // —— 引用：目录 ——
  function insertTOC() {
    var heads = document.querySelectorAll('h1,h2,h3');
    if (!heads.length) { toast(xlT('页面没有标题可生成目录', 'No headings found')); return; }
    var html = '<nav class="xl-toc" style="border:1px solid #e2e6ee;border-radius:10px;padding:10px 14px;margin:8px 0;background:#fafbfe">' +
      '<strong style="display:block;margin-bottom:6px">目录 / Contents</strong><ul style="margin:0;padding-left:18px">';
    heads.forEach(function (h, i) {
      // 用「标题文字 + 序号」而非 Math.random()：随机 id 每次都不同，
      // 而标题 id 会进入后代元素的祖先路径指纹，随机数会让这些指纹漂移、已保存修改找不到。
      if (!h.id) h.id = 'xl-toc-' + xlHash((h.textContent || '') + '|' + i);
      html += '<li><a href="#' + h.id + '" style="color:#2b6cb0;text-decoration:none">' + escHtml(h.textContent || '') + '</a></li>';
    });
    html += '</ul></nav>';
    if (activeInner) { restoreSel(); try { document.execCommand('insertHTML', false, html); } catch (e) {} }
    else insertBlockHtml(html);
    markDirty();
    toast(xlT('已插入目录', 'TOC inserted'));
  }

  // ---------- 顶部编辑条：Microsoft 365 带状工具栏（Ribbon） ----------
  // 结构：标题行 → 选项卡 → 带状内容（每组按钮下方带组名，跟 Word 网页版一致）
  var CTX_LABELS = { textbox: '文本框', image: '图片', video: '视频', file: '附件' };
  var CTX_LABELS_EN = { textbox: 'Text Box', image: 'Picture', video: 'Video', file: 'File' };
  var ctxTab = null;        // 第 3 个选项卡：平时叫「布局」，选中内容块后变身「图片 / 视频 / 文本框 / 附件」
  var ctxTabLabel = null;
  var ctxShownFor = null;   // 上一次因选中而自动切换的类型，避免反复抢用户手动选的页
  var tabBtns = {};
  var tabPanes = {};
  var COLLAPSE_KEY = 'xl_edit_ribbon_collapsed';

  function setTab(name) {
    if (!tabBtns[name]) return;
    Object.keys(tabBtns).forEach(function (k) { tabBtns[k].classList.toggle('on', k === name); });
    Object.keys(tabPanes).forEach(function (k) { tabPanes[k].classList.toggle('on', k === name); });
  }

  // 选中内容块时把第 3 页变成对应的上下文格式页并自动激活（同 365 选中图片弹出「图片」页）
  function updateCtxTab() {
    if (!ctxTab) return;
    var t = activeWrap ? (activeWrap.dataset.type || '') : '';
    var isCtx = !!CTX_LABELS[t];
    ctxTab.classList.toggle('is-ctx', isCtx);
    ctxTabLabel.textContent = xlT(isCtx ? CTX_LABELS[t] : '布局', isCtx ? CTX_LABELS_EN[t] : 'Layout');
    if (t !== ctxShownFor) {
      ctxShownFor = t;
      if (isCtx) setTab('layout');
    }
  }

  // 内容栏可用宽度（尺寸百分比预设要用）
  function contentWidth() {
    var c = blocksContainer();
    var cs = window.getComputedStyle(c);
    var pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    if (isNaN(pad)) pad = 0;
    return Math.max(160, Math.round(c.clientWidth - pad));
  }

  // 尺寸预设：按内容栏宽度百分比设宽；高度一律交回自适应
  // （图片按原比例自动算高、视频按 16:9、文本框随内容长高）
  function applySizePreset(pct) {
    if (!activeWrap) { toast('请先点选一个内容块'); return; }
    var w = Math.round(contentWidth() * pct / 100);
    activeWrap.style.width = w + 'px';
    activeWrap.style.height = '';
    delete activeWrap.dataset.h;
    activeWrap.dataset.w = String(w);
    updateSizeRead();
    markDirty();
    toast('宽度设为内容栏的 ' + pct + '%（' + w + 'px）');
  }

  // 段落样式预设：有选区时只改选区字号（粗体仅在请求时套选区），无选区才作用于整个文本框
  function applyStylePreset(px, bold) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    saveSel();
    restoreSel();
    var applied = false;
    if (savedRange && !savedRange.collapsed) {
      applied = applyStyleToRange('fontSize', px + 'px');
      if (bold) { try { document.execCommand('bold'); } catch (_) {} }
    }
    if (!applied) {
      activeInner.style.fontSize = px + 'px';
      activeInner.style.fontWeight = bold ? '700' : '400';
    }
    markDirty();
    updateToolbarState();
  }

  function showUI() {
    function keep(e) { e.preventDefault(); }        // 点工具栏按钮不抢焦点 / 不丢选区

    banner = document.createElement('div');
    banner.className = 'xl-edit-banner';
    tabBtns = {}; tabPanes = {}; ctxTab = null; ctxTabLabel = null; ctxShownFor = null;

    // ===== 标题行（365 的标题栏：左侧标识 + 中间说明 + 右侧主次按钮） =====
    var row = document.createElement('div');
    row.className = 'xl-edit-row';
    // 快速访问工具栏（Undo / Redo）
    var qa = document.createElement('div');
    qa.className = 'xl-edit-qa';
    qa.style.cssText = 'display:flex;gap:4px;margin-right:6px;';
    var undoBtn = document.createElement('button'); undoBtn.type = 'button'; undoBtn.className = 'xl-tb-btn'; undoBtn.textContent = '↶'; undoBtn.title = xlT('撤销', 'Undo'); undoBtn.addEventListener('mousedown', keep); undoBtn.addEventListener('click', function () { exec('undo'); });
    var redoBtn = document.createElement('button'); redoBtn.type = 'button'; redoBtn.className = 'xl-tb-btn'; redoBtn.textContent = '↷'; redoBtn.title = xlT('重做', 'Redo'); redoBtn.addEventListener('mousedown', keep); redoBtn.addEventListener('click', function () { exec('redo'); });
    qa.appendChild(undoBtn); qa.appendChild(redoBtn);
    row.appendChild(qa);

    var brand = document.createElement('span');
    brand.className = 'xl-edit-brand';
    brand.innerHTML = '<span class="xl-edit-brand-ico">✎</span>' + xlT('布局编辑', 'Edit Layout');
    var tip = document.createElement('span');
    tip.className = 'xl-edit-tip';
    tip.innerHTML = xlT('点文字直接改，点图片换图；选中内容块后可拖四角/四边改长宽　',
                        'Click text to edit, click image to replace; select a block to resize from corners/edges　') +
                    '<span class="xl-kbd">Ctrl/⌘+S</span> ' + xlT('保存', 'Save') + '　<span class="xl-kbd">Esc</span> ' + xlT('退出', 'Exit');

    saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'xl-edit-save'; saveBtn.textContent = xlT('保存', 'Save');
    var exitBtn = document.createElement('button');
    exitBtn.type = 'button'; exitBtn.className = 'xl-edit-exit'; exitBtn.textContent = xlT('退出', 'Exit');

    var collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'xl-rbn-collapse';
    collapseBtn.title = xlT('收起 / 展开工具栏', 'Collapse / expand toolbar');
    collapseBtn.addEventListener('mousedown', keep);
    collapseBtn.addEventListener('click', function () {
      var on = banner.classList.toggle('is-collapsed');
      document.body.classList.toggle('xl-rbn-collapsed', on);
      collapseBtn.textContent = on ? '⌄' : '⌃';
      syncBannerHeight();
      try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
    });
    // 记住上次的收起状态
    var collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}
    if (collapsed) { banner.classList.add('is-collapsed'); }
    collapseBtn.textContent = collapsed ? '⌄' : '⌃';
    document.body.classList.toggle('xl-rbn-collapsed', collapsed);

    row.appendChild(brand); row.appendChild(tip);
    row.appendChild(saveBtn); row.appendChild(exitBtn); row.appendChild(collapseBtn);

    // ===== 选项卡 =====
    var tabsBar = document.createElement('div');
    tabsBar.className = 'xl-rbn-tabs';
    function addTab(name, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xl-rbn-tab';
      var l = document.createElement('span');
      l.className = 'xl-rbn-tab-label';
      l.textContent = label;
      b.appendChild(l);
      b.addEventListener('mousedown', keep);
      b.addEventListener('click', function (e) { e.stopPropagation(); setTab(name); });
      tabsBar.appendChild(b);
      tabBtns[name] = b;
      return b;
    }
    addTab('home', xlT('开始', 'Home'));
    addTab('insert', xlT('插入', 'Insert'));
    ctxTab = addTab('layout', xlT('布局', 'Layout'));
    ctxTabLabel = ctxTab.querySelector('.xl-rbn-tab-label');
    addTab('design', xlT('设计', 'Design'));
    addTab('review', xlT('审阅', 'Review'));
    addTab('view', xlT('视图', 'View'));
    addTab('help', xlT('帮助', 'Help'));

    // ===== 带状内容 =====
    var bodyEl = document.createElement('div');
    bodyEl.className = 'xl-rbn-body';
    function pane(name) {
      var s = document.createElement('div');
      s.className = 'xl-rbn-pane';
      s.dataset.pane = name;
      bodyEl.appendChild(s);
      tabPanes[name] = s;
      return s;
    }
    // 组：按钮区 + 下方组名（365 的组名居中显示在下方）
    function grp(paneEl, title) {
      var g = document.createElement('div');
      g.className = 'xl-rbn-grp';
      var gb = document.createElement('div');
      gb.className = 'xl-rbn-grp-body';
      var gn = document.createElement('div');
      gn.className = 'xl-rbn-grp-name';
      gn.textContent = title;
      g.appendChild(gb); g.appendChild(gn);
      paneEl.appendChild(g);
      return gb;
    }
    function stack(parent) { var d = document.createElement('div'); d.className = 'xl-rbn-stack'; parent.appendChild(d); return d; }
    function rrow(parent) { var d = document.createElement('div'); d.className = 'xl-rbn-row'; parent.appendChild(d); return d; }
    function vsep() { var s = document.createElement('span'); s.className = 'xl-rbn-vsep'; return s; }

    function btn(label, fn, opts) {
      opts = opts || {};
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'xl-tb-btn' + (opts.cls ? ' ' + opts.cls : '');
      if (opts.icon) {
        var ic = document.createElement('span');
        ic.className = 'xl-tb-ico';
        ic.innerHTML = opts.icon;
        x.appendChild(ic);
      }
      var tx = document.createElement('span');
      tx.className = 'xl-tb-txt';
      tx.textContent = opts.en ? xlT(label, opts.en) : label;
      x.appendChild(tx);
      if (opts.cmd) x.setAttribute('data-cmd', opts.cmd);
      if (opts.title) x.title = opts.title;
      x.addEventListener('mousedown', function (e) { saveSel(); keep(e); });
      x.addEventListener('click', fn);
      return x;
    }
    // 图标 + 小字的方形按钮（快速插入用）
    function quick(ico, label, en, title, fn) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'xl-tb-quick';
      var txt = en ? xlT(label, en) : label;                  // 与 btn() 一致，支持中英切换
      x.title = title || txt;
      x.innerHTML = '<span class="xl-tb-quick-ico">' + ico + '</span>' +
                    '<span class="xl-tb-quick-label">' + escHtml(txt) + '</span>';
      x.addEventListener('mousedown', function (e) { saveSel(); keep(e); });
      x.addEventListener('click', fn);
      return x;
    }

    var pHome = pane('home');
    var pIns = pane('insert');
    var pLay = pane('layout');
    var pDesign = pane('design');
    var pReview = pane('review');
    var pView = pane('view');
    var pHelp = pane('help');

    // ================= 开始 (Microsoft 365 Home) =================

    // —— 字体组补充功能（对照本机 Word 功能区的「文本效果 / 字符边框 / 字符底纹 / 拼音指南 / 字符缩放」）——
    function applyTextEffect() {
      if (!activeInner) { toast('请先点选一个文本框'); return; }
      saveSel(); restoreSel();
      applyStyleToRange('textShadow', '0 0 5px rgba(70,130,255,.85)');
      markDirty();
    }
    function applyCharBorder() {
      if (!activeInner) { toast('请先点选一个文本框'); return; }
      saveSel(); restoreSel();
      applyStyleToRange('border', '1px solid currentColor');
      applyStyleToRange('padding', '0 2px');
      markDirty();
    }
    function applyCharShading() {
      if (!activeInner) { toast('请先点选一个文本框'); return; }
      saveSel(); restoreSel();
      applyStyleToRange('backgroundColor', '#fff2cc');
      markDirty();
    }
    function applyCharScale(f) {
      if (!activeInner) { toast('请先点选一个文本框'); return; }
      saveSel(); restoreSel();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      if (range.collapsed) return;
      var root = range.commonAncestorContainer;
      if (root && root.nodeType === Node.TEXT_NODE) root = root.parentElement || root;
      if (!root) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return (!n.nodeValue || !n.nodeValue.trim().length || !range.intersectsNode(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
      });
      var node;
      while ((node = walker.nextNode())) {
        var span = document.createElement('span');
        span.style.display = 'inline-block';
        span.style.transform = 'scaleX(' + f + ')';
        var p = node.parentNode; while (p && p.nodeType !== 1) p = p.parentNode;
        if (!p) continue;
        p.insertBefore(span, node); span.appendChild(node);
      }
      markDirty();
    }
    function insertPhonetic() {
      if (!activeInner) { toast('请先点选一个文本框'); return; }
      saveSel(); restoreSel();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('请选中要加拼音的文字'); return; }
      var txt = sel.toString();
      if (!txt.trim()) { toast('请选中要加拼音的文字'); return; }
      try { document.execCommand('insertHTML', false, '<ruby>' + escHtml(txt) + '<rt></rt></ruby>'); markDirty(); }
      catch (_) { toast('插入拼音失败'); }
    }
    // — 剪贴板组：左侧大粘贴按钮，右侧剪切 / 复制 / 格式刷 —
    var gClip = grp(pHome, xlT('剪贴板', 'Clipboard'));
    var cCo = stack(gClip);
    var cRow1 = rrow(cCo);
    cRow1.className += ' xl-clip-row';
    var pasteWrap = document.createElement('div');
    pasteWrap.className = 'xl-tb-paste-wrap';
    var pasteBtn = document.createElement('button');
    pasteBtn.type = 'button'; pasteBtn.className = 'xl-tb-paste-btn';
    pasteBtn.innerHTML = '<span class="xl-tb-paste-ico">📋</span><span class="xl-tb-paste-label">' + escHtml(xlT('粘贴', 'Paste')) + '</span>';
    pasteBtn.title = xlT('粘贴剪贴板内容', 'Paste from clipboard');
    pasteBtn.addEventListener('mousedown', keep);
    pasteBtn.addEventListener('click', pasteKeep);
    var pasteMenu = document.createElement('div');
    pasteMenu.className = 'xl-tb-paste-menu';
    [[xlT('保留源格式', 'Keep Source Formatting'), pasteKeep],
     [xlT('合并格式', 'Merge Formatting'), pasteKeep],
     [xlT('只保留文本', 'Keep Text Only'), pastePlain]].forEach(function (it) {
      var mi = document.createElement('button');
      mi.type = 'button'; mi.className = 'xl-tb-menu-item';
      mi.textContent = it[0];
      mi.addEventListener('mousedown', keep);
      mi.addEventListener('click', function (e) { e.stopPropagation(); pasteMenu.classList.remove('open'); it[1](); });
      pasteMenu.appendChild(mi);
    });
    pasteWrap.appendChild(pasteBtn); pasteWrap.appendChild(pasteMenu);
    cRow1.appendChild(pasteWrap);
    var cRight = document.createElement('div');
    cRight.className = 'xl-tb-paste-right';
    cRight.appendChild(btn('✂ ' + xlT('剪切', 'Cut'), function () { exec('cut'); }, { title: '剪切' }));
    cRight.appendChild(btn('⎘ ' + xlT('复制', 'Copy'), function () { exec('copy'); }, { title: '复制' }));
    cRight.appendChild(btn('格式刷', applyPainter, { icon: ICONS.painter, en: 'Format Painter', title: '复制格式并粘贴到选中文字' }));
    cRow1.appendChild(cRight);

    // — 字体组（对齐 Microsoft 365 Word） —
    var gFont = grp(pHome, xlT('字体', 'Font'));
    var fCo = stack(gFont);

    // 第一行：字体 / 字号 / A+ / A- / 清除格式
    var fontRow = rrow(fCo);
    var font = document.createElement('select');
    font.className = 'xl-tb-select';
    font.title = '字体';
    [['', '字体'], ['inherit', '继承'],
      ['sans-serif', '无衬线'], ['serif', '衬线'], ['monospace', '等宽'],
      ['system-ui, sans-serif', '系统默认'], ['-apple-system, BlinkMacSystemFont, sans-serif', '苹果系统'],
      ['微软雅黑, sans-serif', '微软雅黑'], ['Microsoft YaHei, sans-serif', 'Microsoft YaHei'],
      ['宋体, serif', '宋体'], ['SimSun, serif', 'SimSun'],
      ['黑体, sans-serif', '黑体'], ['SimHei, sans-serif', 'SimHei'],
      ['楷体, serif', '楷体'], ['KaiTi, serif', 'KaiTi'],
      ['隶书, serif', '隶书'], ['FangSong, serif', '仿宋'],
      ['PingFang SC, sans-serif', '苹方'],
      ['Helvetica, Arial, sans-serif', 'Helvetica'],
      ['Arial, sans-serif', 'Arial'], ['Verdana, sans-serif', 'Verdana'],
      ['Tahoma, sans-serif', 'Tahoma'], ['Trebuchet MS, sans-serif', 'Trebuchet'],
      ['Georgia, serif', 'Georgia'], ['Times New Roman, serif', 'Times'],
      ['Garamond, serif', 'Garamond'], ['Palatino, serif', 'Palatino'],
      ['Courier New, monospace', 'Courier'], ['Consolas, monospace', 'Consolas']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; font.appendChild(op); });
    font.addEventListener('mousedown', function () { saveSel(); });
    font.addEventListener('change', function () { if (font.value) applyFont(font.value); });
    fontRow.appendChild(font);

    var size = document.createElement('input');
    size.className = 'xl-tb-size';
    size.type = 'text';
    size.placeholder = '字号';
    size.title = '字号';
    size.setAttribute('list', 'xl-tb-size-list');
    var sizeList = document.createElement('datalist');
    sizeList.id = 'xl-tb-size-list';
    ['10','11','12','14','16','18','20','22','24','28','32','36','42','48','56','64','72','96']
      .forEach(function (s) { var op = document.createElement('option'); op.value = s; sizeList.appendChild(op); });
    banner.appendChild(sizeList);
    size.addEventListener('mousedown', function () { saveSel(); });
    size.addEventListener('change', function () {
      var v = (size.value || '').trim();
      if (!v) return;
      if (/^\d+(\.\d+)?$/.test(v)) v = v + 'px';
      if (!/^[\d.]+(px|em|rem|%)$/.test(v)) { toast('字号格式不对，如 16 / 18px / 1.2em'); return; }
      applySize(v);
    });
    fontRow.appendChild(size);
    fontRow.appendChild(btn('A⁺', function () { changeFontSize(1); }, { title: '增大字号', cls: 'xl-tb-fs-btn' }));
    fontRow.appendChild(btn('A⁻', function () { changeFontSize(-1); }, { title: '减小字号', cls: 'xl-tb-fs-btn' }));
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button'; clearBtn.className = 'xl-tb-clear-btn';
    clearBtn.title = '清除格式';
    clearBtn.innerHTML = '<span class="xl-tb-clear-ico">🖌</span>';
    clearBtn.addEventListener('mousedown', keep);
    clearBtn.addEventListener('click', applyClearFormat);
    fontRow.appendChild(clearBtn);

    // 第二行（与 Word 一致）：B I U S 下标 上标 文本效果 字体颜色 文本突出显示颜色
    var gRow2 = rrow(fCo);
    gRow2.appendChild(btn('B', function () { exec('bold'); }, { cmd: 'bold', cls: 'f-bold', title: '粗体' }));
    gRow2.appendChild(btn('I', function () { exec('italic'); }, { cmd: 'italic', cls: 'f-italic', title: '斜体' }));
    gRow2.appendChild(btn('U', function () { exec('underline'); }, { cmd: 'underline', cls: 'f-underline', title: '下划线' }));
    gRow2.appendChild(btn('S', function () { exec('strikeThrough'); }, { cmd: 'strike', cls: 'f-strike', title: '删除线' }));
    gRow2.appendChild(btn('x₂', function () { exec('subscript'); }, { cmd: 'sub', title: '下标' }));
    gRow2.appendChild(btn('x²', function () { exec('superscript'); }, { cmd: 'sup', title: '上标' }));
    gRow2.appendChild(btn('🌟', applyTextEffect, { title: '文本效果' }));
    var fgBtn = document.createElement('button');
    fgBtn.type = 'button'; fgBtn.className = 'xl-tb-color-btn';
    fgBtn.innerHTML = '<span class="xl-tb-color-letter">A</span><span class="xl-tb-color-bar" style="background:#222"></span><span class="xl-caret">▾</span>';
    fgBtn.title = '字体颜色';
    gRow2.appendChild(fgBtn);
    var bgBtn = document.createElement('button');
    bgBtn.type = 'button'; bgBtn.className = 'xl-tb-color-btn xl-tb-bg-btn';
    bgBtn.innerHTML = '<span class="xl-tb-color-bg-letter">A</span><span class="xl-tb-color-bar" style="background:#fff36d"></span><span class="xl-caret">▾</span>';
    bgBtn.title = '文本突出显示颜色';
    gRow2.appendChild(bgBtn);

    // 第三行（Word 字体组底行）：字符边框 字符底纹 拼音指南 更改大小写 字符缩放
    var gRow3 = rrow(fCo);
    gRow3.appendChild(btn('▦', applyCharBorder, { title: '字符边框' }));
    gRow3.appendChild(btn('▩', applyCharShading, { title: '字符底纹' }));
    gRow3.appendChild(btn('拼', insertPhonetic, { title: '拼音指南' }));
    gRow3.appendChild(btn('Aa', changeCase, { title: '更改大小写' }));
    var scaleSel = document.createElement('select');
    scaleSel.className = 'xl-tb-select';
    scaleSel.title = '字符缩放';
    [['', '缩放'], ['0.5', '50%'], ['0.8', '80%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; scaleSel.appendChild(op);
    });
    scaleSel.addEventListener('mousedown', function () { saveSel(); });
    scaleSel.addEventListener('change', function () { if (scaleSel.value) applyCharScale(parseFloat(scaleSel.value)); });
    gRow3.appendChild(scaleSel);

    // — 段落组（对齐 Microsoft 365 Word「开始」真实结构） —
    //   第一行：项目符号 / 编号 / 多级列表 / 减少缩进 / 增加缩进 / 排序
    //   第二行：左对齐 / 居中 / 右对齐 / 两端对齐 / 行和段落间距 / 底纹 / 边框 / ¶
    var gPara = grp(pHome, xlT('段落', 'Paragraph'));
    var pCo = stack(gPara);
    // 第一行：项目符号 / 编号 / 多级列表 / 减少缩进 / 增加缩进 / 排序
    var pRow1 = rrow(pCo);
    pRow1.appendChild(btn('•', function () { exec('insertUnorderedList'); }, { cmd: 'ul', title: '项目符号' }));
    pRow1.appendChild(btn('1.', function () { exec('insertOrderedList'); }, { cmd: 'ol', title: '编号' }));
    var listType = document.createElement('select');
    listType.className = 'xl-tb-select';
    listType.title = '多级列表';
    [['', '格式'], ['1', '1.'], ['a', 'a.'], ['A', 'A.'], ['i', 'i.'], ['I', 'I.']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; listType.appendChild(op);
    });
    listType.addEventListener('mousedown', function () { saveSel(); });
    listType.addEventListener('change', function () { if (listType.value) applyListType(listType.value); });
    pRow1.appendChild(listType);
    pRow1.appendChild(btn('⇤', function () { exec('outdent'); }, { title: '减少缩进' }));
    pRow1.appendChild(btn('⇥', function () { exec('indent'); }, { title: '增加缩进' }));
    pRow1.appendChild(btn('⇅', sortSelection, { title: '排序' }));
    // 第二行：左对齐 / 居中 / 右对齐 / 两端对齐 / 行和段落间距 / 底纹 / 边框 / ¶
    var pRow2 = rrow(pCo);
    pRow2.appendChild(btn('⬅', function () { exec('justifyLeft'); }, { cmd: 'aleft', title: '左对齐' }));
    pRow2.appendChild(btn('↔', function () { exec('justifyCenter'); }, { cmd: 'acenter', title: '居中' }));
    pRow2.appendChild(btn('➡', function () { exec('justifyRight'); }, { cmd: 'aright', title: '右对齐' }));
    pRow2.appendChild(btn('⬌', function () { exec('justifyFull'); }, { cmd: 'afull', title: '两端对齐' }));
    var lineSpacing = document.createElement('select');
    lineSpacing.className = 'xl-tb-select';
    lineSpacing.title = '行和段落间距';
    [['', '行和段落间距'], ['1', '1.0'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', '2.0'], ['2.5', '2.5']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; lineSpacing.appendChild(op);
    });
    lineSpacing.addEventListener('mousedown', function () { saveSel(); });
    lineSpacing.addEventListener('change', function () { if (lineSpacing.value) applyLineHeight(lineSpacing.value); });
    pRow2.appendChild(lineSpacing);
    pRow2.appendChild(btn('▦', function () { applyParaShading('#e6f3ff'); }, { title: '底纹' }));
    pRow2.appendChild(btn('▭', applyParaBorder, { title: '边框' }));
    pRow2.appendChild(btn('¶', toggleFormattingMarks, { title: '显示/隐藏编辑标记' }));

    // — 样式组（Word 样式库） —
    var gStyle = grp(pHome, xlT('样式', 'Styles'));
    var sCo = stack(gStyle);
    sCo.className += ' xl-style-gallery';
    // Word 样式库顺序：标题 1 / 标题 2 / 标题 3 （第一行）；标题 / 副标题 / 正常 / 更改样式 （第二行）
    var sRow1 = rrow(sCo);
    sRow1.appendChild(btn('标题 1', function () { applyStylePreset(32, true); }, { cls: 'xl-style-item xl-style-head', title: '标题 1' }));
    sRow1.appendChild(btn('标题 2', function () { applyStylePreset(24, true); }, { cls: 'xl-style-item xl-style-head', title: '标题 2' }));
    sRow1.appendChild(btn('标题 3', function () { applyStylePreset(18, true); }, { cls: 'xl-style-item xl-style-head', title: '标题 3' }));
    var sRow2 = rrow(sCo);
    sRow2.appendChild(btn('标题', function () { applyStylePreset(20, true); }, { cls: 'xl-style-item xl-style-head', title: '标题' }));
    sRow2.appendChild(btn('副标题', function () { applyStylePreset(16, false); }, { cls: 'xl-style-item', title: '副标题' }));
    sRow2.appendChild(btn('正常', function () { applyStylePreset(16, false); }, { cls: 'xl-style-item', title: '正常' }));
    sRow2.appendChild(btn('…', showMoreStyles, { cls: 'xl-style-item', title: '更改样式' }));

    // — 编辑组（Word「开始」真实：查找 / 替换 / 选择，竖排） —
    var gProof = grp(pHome, xlT('编辑', 'Editing'));
    var pCo2 = stack(gProof);
    pCo2.appendChild(btn('查找', doFind, { icon: ICONS.find, en: 'Find', title: '查找' }));
    pCo2.appendChild(btn('替换', doReplace, { icon: ICONS.replace, en: 'Replace', title: '替换' }));
    pCo2.appendChild(btn('选择', selectAllInActive, { title: '选择' }));

    // ================= 插入 =================
    var gIns = grp(pIns, xlT('插入', 'Insert'));
    var insWrap = document.createElement('div');
    insWrap.className = 'xl-tb-insert';
    var insBtn = document.createElement('button');
    insBtn.type = 'button';
    insBtn.className = 'xl-tb-insert-btn';
    insBtn.title = '插入：文本框 / 图片 / 视频 / 文件';
    insBtn.innerHTML = '<span class="xl-tb-insert-plus">＋</span>' +
                       '<span class="xl-tb-insert-label">插入</span>' +
                       '<span class="xl-caret">▾</span>';
    var insMenu = document.createElement('div');
    insMenu.className = 'xl-tb-menu';
    [['📝', '文本框', '插入一个可输入文字的文本框', '文字', makeTextbox],
     ['🖼', '图片', '插入图片（本地文件或链接）', '本地/链接', insertImage],
     ['🎬', '视频', '插入视频（本地文件 / YouTube / 直链）', '本地/链接', insertVideo],
     ['📎', '文件', '插入任意文件附件（≤20MB）', '≤20MB', insertFile]
    ].forEach(function (it) {
      var mi = document.createElement('button');
      mi.type = 'button';
      mi.className = 'xl-tb-menu-item';
      mi.title = it[2];
      mi.innerHTML = '<span class="xl-tb-menu-ico">' + it[0] + '</span>' +
                     '<span class="xl-tb-menu-label">' + it[1] + '</span>' +
                     '<span class="xl-tb-menu-hint">' + it[3] + '</span>';
      mi.addEventListener('mousedown', keep);
      mi.addEventListener('click', function (e) {
        e.stopPropagation();
        closeInsertMenu();
        it[4]();
      });
      insMenu.appendChild(mi);
    });
    insWrap.appendChild(insBtn);
    insWrap.appendChild(insMenu);

    function closeInsertMenu() { insMenu.classList.remove('open'); }
    function openInsertMenu() {
      // 菜单是 position:fixed，位置按按钮实时算：
      // 工具栏是 overflow-x:auto，绝对定位会被裁掉
      var r = insBtn.getBoundingClientRect();
      var mw = insMenu.offsetWidth || 232;
      insMenu.style.left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - mw - 8)) + 'px';
      insMenu.style.top = Math.round(r.bottom + 6) + 'px';
      insMenu.classList.add('open');
    }
    insBtn.addEventListener('mousedown', keep);
    insBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = insMenu.classList.contains('open');
      closeInsertMenu();
      if (!isOpen) openInsertMenu();
    });
    document.addEventListener('mousedown', function (e) {
      if (!insWrap.contains(e.target)) closeInsertMenu();
    });
    gIns.appendChild(insWrap);

    // — 快速插入：图标按钮（不想开菜单时一键到位） —
    var gQuick = grp(pIns, xlT('快速插入', 'Quick Insert'));
    var qCo = stack(gQuick);
    var qRow1 = rrow(qCo);
    qRow1.appendChild(quick('📝', '文字', 'Text', '插入文本框 / Insert text box', makeTextbox));
    qRow1.appendChild(quick('🖼', '图片', 'Image', '插入图片 / Insert image', insertImage));
    var qRow2 = rrow(qCo);
    qRow2.appendChild(quick('🎬', '视频', 'Video', '插入视频 / Insert video', insertVideo));
    qRow2.appendChild(quick('📎', '文件', 'File', '插入文件附件 / Insert file', insertFile));

    // — 链接组 —
    var gLink = grp(pIns, xlT('链接', 'Links'));
    gLink.appendChild(btn('🔗 链接', insertLink, { title: '给选中的文字加链接' }));
    gLink.appendChild(btn('⛓ 解除', function () { exec('unlink'); }, { title: '移除链接' }));

    // — 表格 / 符号 / 分页 / 书签 / 目录 —
    var gMore = grp(pIns, xlT('表格与标记', 'Tables & Marks'));
    var mCo = stack(gMore);
    var mRow1 = rrow(mCo);
    mRow1.appendChild(btn('表格', insertTable, { icon: ICONS.table, en: 'Table', title: '插入表格' }));
    mRow1.appendChild(btn('符号', insertSymbol, { icon: ICONS.symbol, en: 'Symbol', title: '插入特殊符号' }));
    mRow1.appendChild(btn('分页符', insertPageBreak, { icon: ICONS.pagebreak, en: 'Page Break', title: '插入分页符' }));
    mRow1.appendChild(btn('书签', insertBookmark, { icon: ICONS.bookmark, en: 'Bookmark', title: '给选中文字加书签' }));
    var mRow2 = rrow(mCo);
    mRow2.appendChild(btn('目录', insertTOC, { icon: ICONS.toc, en: 'Table of Contents', title: '根据页面标题生成目录' }));

    // ================= 布局 / 上下文格式 =================
    var gSize = grp(pLay, xlT('大小', 'Size'));
    var zCo = stack(gSize);
    var zRow1 = rrow(zCo);
    sizeRead = document.createElement('span');
    sizeRead.className = 'xl-tb-sizeread';
    sizeRead.textContent = '未选中内容块';
    sizeRead.title = '拖动选中块的四角或四边即可改变长宽';
    zRow1.appendChild(sizeRead);
    var zRow2 = rrow(zCo);
    zRow2.appendChild(btn('25%', function () { applySizePreset(25); }, { title: '宽度 = 内容栏的 25%' }));
    zRow2.appendChild(btn('50%', function () { applySizePreset(50); }, { title: '宽度 = 内容栏的 50%' }));
    zRow2.appendChild(btn('75%', function () { applySizePreset(75); }, { title: '宽度 = 内容栏的 75%' }));
    zRow2.appendChild(btn('100%', function () { applySizePreset(100); }, { title: '宽度 = 内容栏的 100%' }));
    zRow2.appendChild(btn('⤢ 重置', resetSize, { title: '把选中块恢复为自适应尺寸' }));

    var gArr = grp(pLay, xlT('排列', 'Arrange'));
    var aCo = stack(gArr);
    var aRow1 = rrow(aCo);
    aRow1.appendChild(btn('⧉ 复制', duplicateActive, { title: '复制选中的内容块' }));
    aRow1.appendChild(btn('↑ 上移', function () { moveActive(-1); }, { title: '把选中块往上移' }));
    var aRow2 = rrow(aCo);
    aRow2.appendChild(btn('↓ 下移', function () { moveActive(1); }, { title: '把选中块往下移' }));
    aRow2.appendChild(btn('🗑 删除', deleteActive, { title: '删除选中的内容块（Delete）' }));

    var gNote = grp(pLay, xlT('说明', 'Notes'));
    var noteEl = document.createElement('div');
    noteEl.className = 'xl-rbn-note';
    noteEl.innerHTML = '图片 / 视频拖角保持原比例<br>文本框 / 附件可自由改长宽';
    gNote.appendChild(noteEl);

    // ================= 设计 =================
    var gFontSet = grp(pDesign, xlT('字体方案', 'Font Set'));
    var dsCo = stack(gFontSet);
    var dsRow = rrow(dsCo);
    dsRow.appendChild(btn('无衬线', function () { designFontSet('sans-serif'); }, { icon: ICONS.fontset, en: 'Sans', title: '套用无衬线字体' }));
    dsRow.appendChild(btn('衬线', function () { designFontSet('serif'); }, { icon: ICONS.fontset, en: 'Serif', title: '套用衬线字体' }));
    dsRow.appendChild(btn('等宽', function () { designFontSet('monospace'); }, { icon: ICONS.fontset, en: 'Mono', title: '套用等宽字体' }));
    dsRow.appendChild(btn('中文黑体', function () { designFontSet('微软雅黑, sans-serif'); }, { icon: ICONS.fontset, en: 'CN', title: '套用中文黑体' }));
    var gSpace = grp(pDesign, xlT('段间距', 'Spacing'));
    var spCo = stack(gSpace);
    var spRow = rrow(spCo);
    spRow.appendChild(btn('紧凑', function () { designParaSpacing('compact'); }, { icon: ICONS.spacing, en: 'Compact', title: '段前段后 6px' }));
    spRow.appendChild(btn('普通', function () { designParaSpacing('normal'); }, { icon: ICONS.spacing, en: 'Normal', title: '段前段后 10px' }));
    spRow.appendChild(btn('宽松', function () { designParaSpacing('loose'); }, { icon: ICONS.spacing, en: 'Loose', title: '段前段后 16px' }));

    // ================= 审阅 =================
    var gProof2 = grp(pReview, xlT('校对', 'Proofing'));
    var rvCo = stack(gProof2);
    var rvRow = rrow(rvCo);
    rvRow.appendChild(btn('字数统计', wordCount, { icon: ICONS.wordcount, en: 'Word Count', title: '统计字符 / 单词 / 行数' }));
    rvRow.appendChild(btn('批注', addComment, { icon: ICONS.comment, en: 'Comment', title: '给选中文字加批注' }));
    rvRow.appendChild(btn('拼写检查', toggleSpell, { icon: ICONS.spell, en: 'Spelling', title: '开/关文本框拼写检查' }));

    // ================= 视图 =================
    var gView = grp(pView, xlT('显示', 'View'));
    var vwCo = stack(gView);
    var vwRow = rrow(vwCo);
    vwRow.appendChild(btn('放大', zoomIn, { icon: ICONS.zoomin, en: 'Zoom In', title: '放大编辑区' }));
    vwRow.appendChild(btn('缩小', zoomOut, { icon: ICONS.zoomout, en: 'Zoom Out', title: '缩小编辑区' }));
    vwRow.appendChild(btn('标尺', toggleRuler, { icon: ICONS.ruler, en: 'Ruler', title: '显示 / 隐藏标尺' }));
    vwRow.appendChild(btn('重置', function () { setZoom(100); }, { en: 'Reset', title: '恢复 100% 缩放' }));

    // ================= 帮助 =================
    var gKeys = grp(pHelp, xlT('快捷键', 'Shortcuts'));
    var keysEl = document.createElement('div');
    keysEl.className = 'xl-rbn-note';
    keysEl.innerHTML =
      '<span class="xl-kbd">Ctrl/⌘+S</span> 保存　<span class="xl-kbd">Esc</span> 退出编辑　' +
      '<span class="xl-kbd">Delete</span> 删除选中块<br>' +
      '<span class="xl-kbd">Ctrl/⌘+B</span> 粗体　<span class="xl-kbd">Ctrl/⌘+I</span> 斜体　' +
      '<span class="xl-kbd">Ctrl/⌘+U</span> 下划线';
    gKeys.appendChild(keysEl);

    var gAbout = grp(pHelp, xlT('说明', 'About'));
    var aboutEl = document.createElement('div');
    aboutEl.className = 'xl-rbn-note';
    aboutEl.innerHTML = '改动只有点「保存」后才会对访客生效<br>工具栏可用右上角的 ⌃ 收起';
    gAbout.appendChild(aboutEl);

    // ===== 调色板面板（标准色 + 最近用色 + 自定义） =====
    function buildPanel(which) {
      var panel = document.createElement('div');
      panel.className = 'xl-tb-color-panel';
      panel.dataset.which = which; // 'fg' or 'bg'
      var palette = which === 'fg' ? STANDARD_COLORS : STANDARD_BG;
      var grid = document.createElement('div');
      grid.className = 'xl-tb-color-grid';
      palette.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'xl-tb-color-swatch';
        sw.style.background = c;
        sw.dataset.color = c;
        sw.title = c;
        sw.addEventListener('mousedown', keep);
        sw.addEventListener('click', function () {
          closePanels();
          if (which === 'fg') applyColor(c); else applyHighlight(c);
        });
        grid.appendChild(sw);
      });
      panel.appendChild(grid);

      // 最近用色
      var recentWrap = document.createElement('div');
      recentWrap.className = 'xl-tb-color-recent';
      var recentLabel = document.createElement('div');
      recentLabel.className = 'xl-tb-color-recent-label';
      recentLabel.textContent = '最近用色';
      recentWrap.appendChild(recentLabel);
      var recentGrid = document.createElement('div');
      recentGrid.className = 'xl-tb-color-grid xl-tb-color-recent-grid';
      recentGrid.dataset.which = which;
      recentWrap.appendChild(recentGrid);
      panel.appendChild(recentWrap);

      // 自定义颜色 + 清除按钮
      var customRow = document.createElement('div');
      customRow.className = 'xl-tb-color-custom';
      var picker = document.createElement('input');
      picker.type = 'color';
      picker.value = which === 'fg' ? '#222222' : '#fff36d';
      picker.addEventListener('mousedown', keep);
      picker.addEventListener('input', function () {
        if (which === 'fg') applyColor(picker.value); else applyHighlight(picker.value);
      });
      var pickerLabel = document.createElement('span');
      pickerLabel.textContent = '自定义';
      customRow.appendChild(picker);
      customRow.appendChild(pickerLabel);
      // 清除颜色
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'xl-tb-color-clear';
      clearBtn.textContent = which === 'fg' ? '清除文字颜色' : '清除背景';
      clearBtn.addEventListener('mousedown', keep);
      clearBtn.addEventListener('click', function () {
        closePanels();
        if (which === 'fg') applyColor('#222222'); // 用默认色重置
        else applyHighlight('transparent');
      });
      customRow.appendChild(clearBtn);
      panel.appendChild(customRow);
      return panel;
    }

    fgPanel = buildPanel('fg');
    bgPanel = buildPanel('bg');
    fgBtn.appendChild(fgPanel);
    bgBtn.appendChild(bgPanel);

    function closePanels() {
      [fgPanel, bgPanel].forEach(function (p) { p.classList.remove('open'); });
    }
    // 面板在带状工具栏里是 position:fixed，位置按按钮实时算；贴边时自动翻转
    function placePanel(anchorEl, panelEl) {
      panelEl.classList.add('open');
      var r = anchorEl.getBoundingClientRect();
      var pw = panelEl.offsetWidth || 232;
      var ph = panelEl.offsetHeight || 0;
      var left = Math.round(r.left);
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      var top = Math.round(r.bottom + 6);
      if (ph && top + ph > window.innerHeight - 8) top = Math.max(8, Math.round(r.top - ph - 6));
      panelEl.style.left = left + 'px';
      panelEl.style.top = top + 'px';
    }
    fgBtn.addEventListener('mousedown', function (e) { saveSel(); keep(e); });
    bgBtn.addEventListener('mousedown', function (e) { saveSel(); keep(e); });
    fgBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = fgPanel.classList.contains('open');
      closePanels();
      if (!wasOpen) placePanel(fgBtn, fgPanel);
    });
    bgBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = bgPanel.classList.contains('open');
      closePanels();
      if (!wasOpen) placePanel(bgBtn, bgPanel);
    });
    // 点页面其他位置关闭
    document.addEventListener('mousedown', function (e) {
      if (!fgBtn.contains(e.target)) fgPanel.classList.remove('open');
      if (!bgBtn.contains(e.target)) bgPanel.classList.remove('open');
    });

    // 初始化最近用色面板
    refreshRecents();

    banner.appendChild(row);
    banner.appendChild(tabsBar);
    banner.appendChild(bodyEl);
    document.body.appendChild(banner);

    setTab('home');
    updateCtxTab();

    // 创建浮动迷你工具栏（选中文字时浮现在选区上方）
    createMiniToolbar();

    saveBtn.addEventListener('click', saveEdits);
    exitBtn.addEventListener('click', requestExit);
    updateSaveBtn();
    updateSizeRead();
  }

  // 浮动迷你工具栏（Word-like 选中浮现）
  var miniToolbar = null;
  var miniFgPanel = null;
  var miniBgPanel = null;
  function createMiniToolbar() {
    miniToolbar = document.createElement('div');
    miniToolbar.className = 'xl-mini-toolbar';

    function miniBtn(label, title, fn, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (title) b.title = title;
      if (cls) b.className = cls;
      b.addEventListener('mousedown', keepSel);
      b.addEventListener('click', fn);
      return b;
    }

    // 第一行：字体 / 字号 / A+ / A- / 清除格式 / 格式刷
    var mRow1 = document.createElement('div');
    mRow1.className = 'xl-mini-row';
    var mFont = document.createElement('select');
    mFont.className = 'xl-mini-select';
    [['', '字体'], ['sans-serif', '无衬线'], ['serif', '衬线'],
      ['微软雅黑, sans-serif', '微软雅黑'], ['宋体, serif', '宋体'],
      ['黑体, sans-serif', '黑体'], ['楷体, serif', '楷体'],
      ['Arial, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'],
      ['Consolas, monospace', 'Consolas']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; mFont.appendChild(op); });
    mFont.addEventListener('mousedown', keepSel);
    mFont.addEventListener('change', function () { if (mFont.value) { saveSel(); applyFont(mFont.value); } });
    mRow1.appendChild(mFont);
    var mSize = document.createElement('input');
    mSize.className = 'xl-mini-size'; mSize.type = 'text'; mSize.placeholder = '字号'; mSize.title = '字号';
    mSize.addEventListener('mousedown', keepSel);
    mSize.addEventListener('change', function () {
      var v = (mSize.value || '').trim();
      if (!v) return;
      if (/^\d+(\.\d+)?$/.test(v)) v = v + 'px';
      if (!/^[\d.]+(px|em|rem|%)$/.test(v)) return;
      saveSel(); applySize(v);
    });
    mRow1.appendChild(mSize);
    mRow1.appendChild(miniBtn('A⁺', '增大字号', function () { changeFontSize(1); }, 'xl-mini-fs'));
    mRow1.appendChild(miniBtn('A⁻', '减小字号', function () { changeFontSize(-1); }, 'xl-mini-fs'));
    mRow1.appendChild(miniBtn('🖌', '清除格式', applyClearFormat, 'xl-mini-clear'));
    mRow1.appendChild(miniBtn('🖍', '格式刷', applyPainter, 'xl-mini-painter'));
    miniToolbar.appendChild(mRow1);

    // 第二行：B I U S / 颜色 / 高亮 / 列表 / 样式 / 批注
    var mRow2 = document.createElement('div');
    mRow2.className = 'xl-mini-row';
    mRow2.appendChild(miniBtn('B', '加粗 (Ctrl+B)', function () { exec('bold'); }, 'f-bold'));
    mRow2.appendChild(miniBtn('I', '斜体 (Ctrl+I)', function () { exec('italic'); }, 'f-italic'));
    mRow2.appendChild(miniBtn('U', '下划线 (Ctrl+U)', function () { exec('underline'); }, 'f-underline'));
    mRow2.appendChild(miniBtn('S', '删除线', function () { exec('strikeThrough'); }, 'f-strike'));

    // 文字颜色
    var fg = document.createElement('button');
    fg.type = 'button'; fg.className = 'xl-mini-fg'; fg.title = '文字颜色';
    fg.innerHTML = '<span class="xl-mini-fg-letter">A</span><span class="xl-mini-fg-bar"></span>';
    fg.addEventListener('mousedown', keepSel);
    fg.addEventListener('click', function (e) { e.stopPropagation(); miniBgPanel.classList.remove('open'); miniFgPanel.classList.toggle('open'); });
    mRow2.appendChild(fg);
    // 背景颜色
    var bg = document.createElement('button');
    bg.type = 'button'; bg.className = 'xl-mini-bg'; bg.title = '突出显示';
    bg.innerHTML = '<span class="xl-mini-bg-letter">A</span>';
    bg.addEventListener('mousedown', keepSel);
    bg.addEventListener('click', function (e) { e.stopPropagation(); miniFgPanel.classList.remove('open'); miniBgPanel.classList.toggle('open'); });
    mRow2.appendChild(bg);

    mRow2.appendChild(miniBtn('•', '项目符号', function () { exec('insertUnorderedList'); }, 'xl-mini-list'));
    mRow2.appendChild(miniBtn('1.', '编号', function () { exec('insertOrderedList'); }, 'xl-mini-list'));
    mRow2.appendChild(miniBtn('①', '多级列表', function () { applyMultiLevelList('indent'); }, 'xl-mini-list'));
    mRow2.appendChild(miniBtn('样式', '套用样式', function () { toast('在下方「样式」区选择'); }, 'xl-mini-style'));
    mRow2.appendChild(miniBtn('💬', '新建批注', function () { addComment(); }, 'xl-mini-comment'));
    miniToolbar.appendChild(mRow2);

    // 颜色面板
    function buildMiniPanel(which) {
      var panel = document.createElement('div');
      panel.className = 'xl-tb-color-panel';
      panel.dataset.which = which;
      var palette = which === 'fg' ? STANDARD_COLORS : STANDARD_BG;
      var grid = document.createElement('div');
      grid.className = 'xl-tb-color-grid';
      palette.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button'; sw.className = 'xl-tb-color-swatch'; sw.style.background = c; sw.title = c;
        sw.addEventListener('mousedown', keepSel);
        sw.addEventListener('click', function () { panel.classList.remove('open'); if (which === 'fg') applyColor(c); else applyHighlight(c); });
        grid.appendChild(sw);
      });
      panel.appendChild(grid);
      return panel;
    }
    miniFgPanel = buildMiniPanel('fg');
    miniBgPanel = buildMiniPanel('bg');
    fg.appendChild(miniFgPanel);
    bg.appendChild(miniBgPanel);

    document.body.appendChild(miniToolbar);

    document.addEventListener('mousedown', function (e) {
      if (!miniToolbar.contains(e.target)) { miniFgPanel.classList.remove('open'); miniBgPanel.classList.remove('open'); }
    });
  }

  // 显示/隐藏迷你工具栏
  function updateMiniToolbar() {
    if (!miniToolbar) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      miniToolbar.classList.remove('open');
      miniFgPanel && miniFgPanel.classList.remove('open');
      miniBgPanel && miniBgPanel.classList.remove('open');
      return;
    }
    var range = sel.getRangeAt(0);
    // 只在 activeInner 内（编辑中的文本框）显示
    if (!activeInner || !activeInner.contains(range.commonAncestorContainer)) {
      miniToolbar.classList.remove('open');
      return;
    }
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.left === 0 && rect.top === 0 && rect.right === 0)) {
      miniToolbar.classList.remove('open');
      return;
    }
    var top = rect.top - 44;
    var left = rect.left + rect.width / 2;
    // 顶部贴边则放到下方
    if (top < 60) top = rect.bottom + 8;
    // 屏幕左右边界保护
    var margin = 8;
    miniToolbar.style.top = Math.max(margin, Math.min(top, window.innerHeight - 50)) + 'px';
    miniToolbar.style.left = Math.max(margin, Math.min(left, window.innerWidth - 240)) + 'px';
    miniToolbar.classList.add('open');
  }

  // 刷新最近用色面板的格子
  function refreshRecents() {
    [fgPanel, bgPanel].forEach(function (panel) {
      if (!panel) return;
      var which = panel.dataset.which;
      var grid = panel.querySelector('.xl-tb-color-recent-grid');
      if (!grid) return;
      var key = which === 'fg' ? RECENT_COLORS_KEY : RECENT_BG_KEY;
      var list = getRecent(key);
      grid.innerHTML = '';
      if (!list.length) {
        var ph = document.createElement('div');
        ph.className = 'xl-tb-color-recent-empty';
        ph.textContent = '（无）';
        grid.appendChild(ph);
        return;
      }
      list.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'xl-tb-color-swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('mousedown', keepSel);
        sw.addEventListener('click', function () {
          panel.classList.remove('open');
          if (which === 'fg') applyColor(c); else applyHighlight(c);
        });
        grid.appendChild(sw);
      });
    });
  }

  // ---------- 快捷键 ----------
  function onKeyDown(e) {
    if (!active) return;
    var meta = e.ctrlKey || e.metaKey;
    var key = (e.key || '').toLowerCase();
    var t = e.target;
    var typing = !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));

    // 保存
    if (meta && key === 's') { e.preventDefault(); saveEdits(); return; }
    // 退出
    if (key === 'escape') { e.preventDefault(); requestExit(); return; }
    // 行内格式（在文本框内才生效）
    if (meta && activeInner && (key === 'b' || key === 'i' || key === 'u')) {
      e.preventDefault();
      exec(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
      return;
    }
    // 删除选中块：仅在「没有正在输入」时生效，避免影响正常打字
    if (!typing && (key === 'delete' || key === 'backspace')) {
      if (activeWrap) { e.preventDefault(); deleteActive(); }
    }
  }

  // ---------- 离开前提醒 ----------
  function onBeforeUnload(e) {
    if (!active || !dirty) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  }

  function requestExit() {
    if (dirty && !window.confirm('有未保存的修改，确定要退出吗？')) return;
    exitEdit(false);
  }

  // 测量页面顶部「固定定位」的菜单栏/顶栏高度（仿 M365 顶栏会压在内容上导致顶部文字点不到）
  function measureFixedTop() {
    var total = 0;
    try {
      var els = document.querySelectorAll('header, .topbar, nav.topbar, .navbar, .app-bar, [data-fixed-top]');
      Array.prototype.forEach.call(els, function (el) {
        if (!el) return;
        var cs = window.getComputedStyle(el);
        if (cs.position === 'fixed' && el.getBoundingClientRect().top <= 4) {
          total += (el.getBoundingClientRect().height || 0);
        }
      });
    } catch (e) {}
    return total;
  }

  // 让出 banner 实际高度 + 固定顶栏高度，防止固定栏遮挡内容（修「仿 M365 菜单栏遮挡顶部文字」）
  function syncBannerHeight() {
    if (!banner) return;
    var h = banner.getBoundingClientRect().height || banner.offsetHeight || 160;
    var top = measureFixedTop();
    document.body.style.setProperty('--xl-banner-h', (h + 8) + 'px');
    // 编辑态给 body 加的留白 = 编辑横幅 + 固定顶栏，确保页面最顶端文字不被任何固定栏压住
    document.body.style.setProperty('--xl-edit-top', (h + top + 8) + 'px');
  }

  // ---------- 进入 / 保存 / 退出 ----------
  function open() {
    if (active) return;
    active = true;
    dirty = false;
    document.body.classList.add('xl-editmode');
    ensureEditbarCss();
    showUI();
    loadDraft();
    syncBannerHeight();
    if (!window.__xlBannerRO && 'ResizeObserver' in window) {
      window.__xlBannerRO = new ResizeObserver(function () { syncBannerHeight(); });
      window.__xlBannerRO.observe(banner);
    }
    document.querySelectorAll(TEXT_SEL).forEach(function (el) {
      if (inExcluded(el)) return;
      el.setAttribute('data-xl-edit', '');
      el.addEventListener('click', onTextClick);
    });
    document.querySelectorAll('img').forEach(function (img) {
      if (inExcluded(img)) return;
      img.setAttribute('data-xl-edit-img', '');
      img.addEventListener('click', onImgClick);
    });
    // 已有内容块进入可编辑
    var c = blocksContainer();
    c.querySelectorAll('.xl-block').forEach(function (w) {
      var inner = w.querySelector('.xl-block-inner');
      if (inner) inner.setAttribute('contenteditable', 'true');
    });
    c.addEventListener('focusin', function (e) {
      var inner = e.target.closest && e.target.closest('.xl-block-inner');
      if (inner) { activeInner = inner; setActive(inner.closest('.xl-block')); }
      updateToolbarState();
    });
    c.addEventListener('mousedown', function (e) {
      var w = e.target.closest && e.target.closest('.xl-block');
      if (w) setActive(w);
    });
    // 任何输入都视为「有改动」，让未保存提醒真正生效
    c.addEventListener('input', markDirty);
    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    toast('已进入布局编辑模式');
  }

  function onSelChange() {
    if (!active) return;
    saveSel();
    updateToolbarState();
    updateMiniToolbar();
  }

  function saveEdits() {
    if (saving) return;
    // 先把就地编辑中的文本框落进 edits，避免未失焦就保存导致改动丢失
    document.querySelectorAll('[data-xl-edit][contenteditable="true"]').forEach(function (el) { el.blur(); });
    var blocks = [];
    var seen = {};
    $all('#xl-edit-blocks .xl-block').forEach(function (wrap) {
      var type = wrap.dataset.type;
      var id = wrap.dataset.bid || genId();
      // 同一 id 只提交一次：堵住「DOM 里的重复块再被写回 KV」的最后一道口子
      if (seen[id]) return;
      seen[id] = 1;
      var w = parseInt(wrap.dataset.w || '0', 10) || 0;
      var h = parseInt(wrap.dataset.h || '0', 10) || 0;
      if (type === 'textbox') {
        var inner = wrap.querySelector('.xl-block-inner');
        blocks.push({ id: id, type: 'textbox', html: inner.innerHTML, style: inner.getAttribute('style') || '', w: w, h: h });
      } else if (type === 'image') {
        var img = wrap.querySelector('img');
        blocks.push({ id: id, type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '', w: w, h: h });
      } else if (type === 'video') {
        blocks.push({ id: id, type: 'video', url: wrap.dataset.url || '', w: w, h: h });
      } else if (type === 'file') {
        blocks.push({ id: id, type: 'file', url: wrap.dataset.url || '', name: wrap.dataset.name || '', w: w, h: h });
      }
    });
    saving = true;
    updateSaveBtn();
    // 空保存保护：本地没有任何修改、服务器上却有内容时，几乎一定是「回填失败还点了保存」，
    // 直接覆盖会把服务器数据清空且无法恢复（Product Hub 就这样丢过一次）。先问一声。
    if (Object.keys(edits).length === 0 && blocks.length === 0 && savedRemoteCount > 0) {
      saving = false;
      updateSaveBtn();
      var ok = window.confirm('当前没有任何要保存的修改，但服务器上存有 ' + savedRemoteCount +
        ' 条已保存内容。\\n如果继续，这些内容会被清空且无法恢复。\\n\\n建议：先刷新页面重试（通常能找回）。确定要清空吗？');
      if (!ok) return;
      saving = true;
      updateSaveBtn();
    }
    // 双语保存：涉及 data-zh/data-en 节点（本次编辑过的 + 已存档但缺译文的），
    // 先自动翻译成另一语言，弹窗让站主确认/修改译文后才开始保存。
    var pendingTr = collectPendingTranslations();
    if (pendingTr.length > 0) {
      saving = false;
      updateSaveBtn();
      runTranslations(pendingTr).then(function () {
        showTranslateConfirm(pendingTr, function () {
          saving = true;
          updateSaveBtn();
          doSave(blocks);
        }, function () {
          saving = false;
          updateSaveBtn();
        });
      });
      return;
    }
    doSave(blocks);
  }

  // 收集保存前需要补另一语言译文的双语文本段（两种语言都齐的不再打扰）
  function collectPendingTranslations() {
    var out = [];
    Object.keys(edits).forEach(function (k) {
      var e = edits[k];
      if (!e || e.type !== 'text' || !e.value) return;
      var node = resolveEditNode(k);
      if (!isBilingualNode(node)) return;
      var lang = e.lang === 'en' ? 'en' : 'zh';
      var altLang = lang === 'en' ? 'zh' : 'en';
      var hasAlt = e.alt != null && e.altLang === altLang && String(e.alt).trim() !== '';
      if (hasAlt) return;
      out.push({ key: k, lang: lang, altLang: altLang, srcText: stripHtmlToText(e.value), alt: '' });
    });
    return out;
  }

  function runTranslations(list) {
    return Promise.all(list.map(function (p) {
      if (!p.srcText) return Promise.resolve();
      return fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: p.srcText.slice(0, 2000), from: p.lang, to: p.altLang })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { p.alt = d && d.translated ? d.translated : ''; })
        .catch(function () { p.alt = ''; });   // 翻译失败不阻断保存：站主可手填或留空
    }));
  }

  function showTranslateConfirm(list, onConfirm, onCancel) {
    var ov = document.createElement('div');
    ov.className = 'xl-tr-overlay';
    var box = document.createElement('div');
    box.className = 'xl-tr-box';
    var h = document.createElement('h3');
    h.textContent = xlT('双语确认 · 自动翻译', 'Bilingual confirm · auto translation');
    box.appendChild(h);
    var hint = document.createElement('p');
    hint.className = 'xl-tr-hint';
    hint.textContent = xlT('以下段落将同时保存两种语言，译文可直接修改；清空译文则该段只保存当前语言。',
      'These paragraphs will be saved in both languages. Edit the translation if needed; leave it empty to save the current language only.');
    box.appendChild(hint);
    var listEl = document.createElement('div');
    listEl.className = 'xl-tr-list';
    list.forEach(function (p) {
      var item = document.createElement('div');
      item.className = 'xl-tr-item';
      var lab = document.createElement('div');
      lab.className = 'xl-tr-lab';
      lab.textContent = (p.lang === 'zh' ? '中文' : 'English') + ' → ' + (p.altLang === 'zh' ? '中文' : 'English');
      item.appendChild(lab);
      var src = document.createElement('div');
      src.className = 'xl-tr-src';
      src.textContent = p.srcText || '（空）';
      item.appendChild(src);
      var ta = document.createElement('textarea');
      ta.className = 'xl-tr-ta';
      ta.rows = 2;
      ta.value = p.alt || '';
      ta.placeholder = xlT('留空则只保存当前语言', 'Leave empty to save current language only');
      p._ta = ta;
      item.appendChild(ta);
      listEl.appendChild(item);
    });
    box.appendChild(listEl);
    var acts = document.createElement('div');
    acts.className = 'xl-tr-acts';
    var noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'xl-tr-no';
    noBtn.textContent = xlT('取消', 'Cancel');
    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'xl-tr-ok';
    okBtn.textContent = xlT('确认并保存', 'Confirm & save');
    acts.appendChild(noBtn);
    acts.appendChild(okBtn);
    box.appendChild(acts);
    ov.appendChild(box);
    document.body.appendChild(ov);
    okBtn.addEventListener('click', function () {
      list.forEach(function (p) {
        var alt = ((p._ta && p._ta.value) || '').trim();
        var e = edits[p.key];
        if (e && alt) { e.lang = p.lang; e.altLang = p.altLang; e.alt = alt.slice(0, 2000); }
        // 译文留空：不写 lang/alt，回填时另一语言沿用页面原属性
      });
      ov.remove();
      onConfirm();
    });
    noBtn.addEventListener('click', function () { ov.remove(); onCancel(); });
  }

  function doSave(blocks) {
    saving = true;
    updateSaveBtn();
    fetch('/api/page-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: curPath(), edits: edits, blocks: blocks })
    }).then(function (r) {
      saving = false;
      if (!r.ok) {
        updateSaveBtn();
        window.alert('保存失败（需要以站主账号登录）。');
        return;
      }
      dirty = false;
      updateSaveBtn();
      toast('已保存布局修改');
      // A: 保存成功后不强制退出编辑态，保留编辑界面方便连续修改（未保存指示已随 dirty=false 清除）
      clearDraft();   // 显式保存成功后清掉自动保存的草稿键
    }).catch(function () {
      saving = false;
      updateSaveBtn();
      window.alert('保存失败，请重试。');
    });
  }

  function exitEdit(keep) {
    // 触发所有就地编辑文本框的 blur，确保 edits 已收集
    document.querySelectorAll('[data-xl-edit][contenteditable="true"]').forEach(function (el) { el.blur(); });
    active = false;
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    activeWrap = null; activeInner = null; savedRange = null;
    dirty = false; saving = false;
    detachHandles();
    hideSizeBadge();
    document.body.classList.remove('xl-resizing');
    document.body.classList.remove('xl-editmode');
    document.body.classList.remove('xl-rbn-collapsed');
    document.body.style.removeProperty('--xl-banner-h');
    if (window.__xlBannerRO) { window.__xlBannerRO.disconnect(); window.__xlBannerRO = null; }
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('beforeunload', onBeforeUnload);
    var c = document.getElementById('xl-edit-blocks');
    if (c) c.removeEventListener('input', markDirty);
    var b = document.querySelector('.xl-edit-banner');
    if (b) b.remove();
    if (miniToolbar) { miniToolbar.remove(); miniToolbar = null; miniFgPanel = null; miniBgPanel = null; }
    banner = null; saveBtn = null; fgPanel = null; bgPanel = null; sizeRead = null;
    document.querySelectorAll('[data-xl-edit]').forEach(function (el) {
      el.removeAttribute('data-xl-edit');
      el.removeEventListener('click', onTextClick);
      el.removeAttribute('contenteditable');
    });
    document.querySelectorAll('[data-xl-edit-img]').forEach(function (el) {
      el.removeAttribute('data-xl-edit-img');
      el.removeEventListener('click', onImgClick);
    });
    if (!keep) applySaved(); // 还原到已保存状态
  }

  window.XLEdit = { open: open, applySaved: applySaved };

  function boot() {
    ensureStableIds();
    applySaved();
    // 恢复上次记住的缩放：xlZoom 已从 localStorage 读出，但不主动套用的话
    // 就只有变量变了、画面仍是 100%，看起来像「设置没记住」。
    try { if (xlZoom && xlZoom !== 100) document.documentElement.style.zoom = String(xlZoom / 100); } catch (e) {}
  }
  if (document.readyState !== 'loading') { boot(); }
  else document.addEventListener('DOMContentLoaded', boot);
})();
