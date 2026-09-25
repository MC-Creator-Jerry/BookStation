/* 书栈 · 兑换赞助码专页（读取 /quota 展示会员状态，POST /redeem 兑换） */
(function () {
  const $ = function (s) { return document.querySelector(s); };

  // exp 是毫秒时间戳，按本地时区显示「年-月-日 时:分」
  function fmtDateTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function show(view) {
    $('#loginRequired').classList.toggle('hidden', view !== 'login');
    $('#redeemView').classList.toggle('hidden', view !== 'redeem');
    $('#redeemErr').classList.toggle('hidden', view !== 'err');
  }

  function setMsg(text, kind) {
    const el = $('#redeemMsg');
    el.textContent = text || '';
    el.className = 'redeem-msg' + (kind ? ' ' + kind : '');
  }

  // 渲染会员状态（复用 /quota）
  async function loadStatus() {
    const statusEl = $('#vipStatus');
    const detailEl = $('#vipDetail');
    statusEl.className = 'vip-status';
    detailEl.innerHTML = '';
    try {
      const q = await BS.api('/quota');
      const isAdmin = !!q.unlimited;
      const isVip = isAdmin || q.plan === 'pro';
      const expStr = q.exp ? fmtDateTime(q.exp) : '';
      const expLabel = isAdmin ? '永久有效' : (expStr ? '有效期至 ' + expStr : '—');

      if (isVip) {
        statusEl.className = 'vip-status is-vip';
        statusEl.innerHTML = isAdmin ? '🛡️ 管理员（等同 VIP）' : '🌟 高级版 · VIP 已生效';
      } else {
        statusEl.className = 'vip-status not-vip';
        statusEl.innerHTML = '📖 免费版 · 未开通 VIP';
      }

      detailEl.innerHTML =
        '<div class="bs-row bs-meta"><span class="bs-muted">会员类型</span><span>' +
          (isAdmin ? '管理员' : (q.plan === 'pro' ? '高级版' : '免费版')) + '</span></div>' +
        '<div class="bs-row bs-meta"><span class="bs-muted">是否 VIP</span><span>' + (isVip ? '是' : '否') + '</span></div>' +
        '<div class="bs-row bs-meta"><span class="bs-muted">到期时间</span><span>' + expLabel + '</span></div>' +
        '<div class="bs-row bs-meta"><span class="bs-muted">每日上传额度</span><span>' +
          (isAdmin ? '上传不限量' : ('今日已发布 ' + q.used + ' / ' + q.limit + ' 本' +
            (q.remaining > 0 ? '（剩余 ' + q.remaining + '）' : '（已达上限，明天再来）'))) +
        '</span></div>';
    } catch (e) {
      if (e.status === 401) { show('login'); return; }
      statusEl.textContent = '';
      detailEl.innerHTML = '';
      throw e;
    }
  }

  async function doRedeem() {
    const input = $('#redeemInput');
    const btn = $('#redeemBtn');
    const code = (input && input.value || '').trim();
    if (!code) { setMsg('请输入赞助码', 'err'); if (input) input.focus(); return; }
    btn.disabled = true;
    setMsg('兑换中…');
    try {
      const d = await BS.api('/redeem', { method: 'POST', body: { code: code } });
      let text;
      if (d.reason === 'already') text = '你已兑换过该码（有效期不变）';
      else if (d.reason === 'extended') text = '🎉 兑换成功，高级版有效期已顺延！';
      else text = '🎉 兑换成功，高级版已解锁！';
      setMsg(text, 'ok');
      input.value = '';
      await loadStatus();
    } catch (e) {
      setMsg(e.message || '兑换失败', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    BS.initTheme();
    BS.me()
      .then(function (state) {
        if (!state.loggedIn) { show('login'); return; }
        show('redeem');
        return loadStatus();
      })
      .catch(function () { show('err'); });
    BS.mountAuth();
    const btn = $('#redeemBtn');
    if (btn) btn.addEventListener('click', doRedeem);
    const input = $('#redeemInput');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRedeem(); });
  });
})();
