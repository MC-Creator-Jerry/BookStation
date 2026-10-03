/*
 * scroll-keys.js — 键盘上下键滚动增强（全站通用）
 * 行为：
 *   ↑ 单击        → 向上平滑滚动约一屏（视口高 90%）
 *   ↓ 单击        → 向下平滑滚动约一屏
 *   ↑ 双击        → 平滑滚动到页面顶部
 *   ↓ 双击        → 平滑滚动到页面底部
 *   ↑ 长按(按住)  → 持续慢速向上滚动，直到松开按键
 *   ↓ 长按(按住)  → 持续慢速向下滚动，直到松开按键
 * 兼容：
 *   - 输入框 / 文本域 / 下拉 / contenteditable 内不拦截（正常输入与光标移动）
 *   - 按住 Ctrl / Cmd / Alt 时不拦截（保留浏览器原组合键）
 *   - 系统开启“减少动态效果”时单击/双击改用瞬时滚动（长按持续滚动仍生效）
 *   - 布局编辑态（body.no-keyscroll / body[data-no-keyscroll]）下禁用，避免与编辑器冲突
 * 实现要点：
 *   - 单次/双击判定放在 keyup，长按判定放在 keydown→计时→rAF，互不干扰
 *   - 忽略系统自动重复(e.repeat)，持续滚动由 rAF 驱动，避免“一屏一跳”
 */
(function () {
  'use strict';
  var STEP_RATIO = 0.9;      // 单击滚动步长 = 视口高度比例
  var DBL_MS = 300;          // 双击判定窗口（毫秒）
  var HOLD_MS = 220;         // 长按阈值：超过此值视为“按住”，转持续滚动
  var HOLD_STEP_PX = 8;      // 长按每帧位移(px) ≈ 480px/s@60fps（慢速，可调大更快）
  var lastUp = 0, lastDown = 0;

  // 长按状态
  var holdDir = 0;           // -1 上 / +1 下 / 0 无
  var holding = false;
  var holdTimer = null;
  var holdRAF = 0;

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function disabled() {
    var b = document.body;
    if (!b) return false;
    if (b.classList.contains('no-keyscroll')) return true;
    if (b.getAttribute('data-no-keyscroll') === '1') return true;
    return false;
  }

  function smoothTo(y) {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (y < 0) y = 0;
    if (y > max) y = max;
    window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function step(dir) {
    smoothTo(window.scrollY + dir * window.innerHeight * STEP_RATIO);
  }

  // —— 长按持续滚动（rAF 驱动，平滑慢速）——
  function holdFrame() {
    if (!holding) return;
    if (disabled() || isTyping(document.activeElement)) { stopHold(); return; }
    window.scrollBy(0, holdDir * HOLD_STEP_PX);
    holdRAF = window.requestAnimationFrame(holdFrame);
  }
  function startHold(dir) {
    if (holding) return;
    if (disabled() || isTyping(document.activeElement)) return;
    holding = true;
    holdDir = dir;
    holdRAF = window.requestAnimationFrame(holdFrame);
  }
  function stopHold() {
    holding = false;
    holdDir = 0;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdRAF) { window.cancelAnimationFrame(holdRAF); holdRAF = 0; }
  }

  // keydown：仅做长按判定 + 拦截原生；单击/双击在 keyup 处理
  function onKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // 保留浏览器组合键
    if (isTyping(e.target)) return;                    // 输入框内正常输入
    if (disabled()) return;                            // 布局编辑态让位
    if (e.repeat) return;                              // 忽略系统自动重复，连续滚动交给 rAF
    e.preventDefault();
    var dir = (e.key === 'ArrowUp') ? -1 : 1;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { startHold(dir); }, HOLD_MS);
  }

  // keyup：未进入长按 → 判定单击/双击；已进入长按 → 停止
  function onKeyUp(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holding) { stopHold(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (disabled()) return;
    var dir = (e.key === 'ArrowUp') ? -1 : 1;
    var now = Date.now();
    if (dir < 0) {
      if (now - lastUp <= DBL_MS) { lastUp = 0; smoothTo(0); }
      else { lastUp = now; step(-1); }
    } else {
      if (now - lastDown <= DBL_MS) { lastDown = 0; smoothTo(document.documentElement.scrollHeight); }
      else { lastDown = now; step(1); }
    }
  }

  window.addEventListener('keydown', onKeyDown, false);
  window.addEventListener('keyup', onKeyUp, false);
  // 失焦 / 切后台时若仍在长按，停止，避免“卡住一直滚”
  window.addEventListener('blur', stopHold);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopHold();
  });
})();
