// 有給休暇管理：画面と保存（計算は logic.js に任せる）
(function () {
  'use strict';
  const Y = window.Yukyu;
  const KEY = 'yukyu_db_v1';
  const qs = new URLSearchParams(location.search);
  const p2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const TODAY = qs.get('today') || now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fd = (iso) => { if (!iso) return '—'; const d = Y.parseDate(iso); return d.y + '/' + d.m + '/' + d.d; };
  const lastDay = (expire) => Y.addDays(expire, -1);
  const bal = (r, H) => Y.formatBalance(r, H);
  const round1 = (n) => Math.round(n * 10) / 10;

  // ---------- 保存 ----------
  function defaultDB() {
    return {
      version: 1,
      settings: { hourlyEnabled: true, hourCapDays: 5, expiryWarnDays: 30, obligationWarnDays: 90, adminHash: '', lastBackup: '' },
      staff: [], audit: [],
    };
  }
  let loadError = '';
  function load() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDB();
    try {
      const d = JSON.parse(raw);
      const base = defaultDB();
      return Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
    } catch (e) {
      localStorage.setItem(KEY + '_corrupt_' + Date.now(), raw); // 壊れたデータは消さずに残す
      loadError = 'データの読み込みに失敗しました（壊れたデータは別名で残してあります）：' + e.message;
      return defaultDB();
    }
  }
  let db = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { toast('保存に失敗しました：' + e.message, true); return false; }
  }
  function log(action, staff, detail) {
    db.audit.unshift({ at: new Date().toISOString(), who: state.isAdmin ? '管理者' : 'システム', action, staffId: staff ? staff.id : '', staffName: staff ? staff.name : '', detail: detail || '' });
    if (db.audit.length > 5000) db.audit.length = 5000;
  }

  // ---------- 状態 ----------
  const state = {
    mode: qs.get('mode') === 'staff' || (!qs.get('mode') && localStorage.getItem('yukyu_mode') === 'staff') ? 'staff' : 'admin',
    me: localStorage.getItem('yukyu_me') || '',
    view: 'list', id: null, tab: 'summary', q: '', filter: 'active', isAdmin: !db.settings.adminHash,
    entry: { staffId: '', date: TODAY, kind: 'day', hours: '', note: '', editId: null }, entryError: '',
  };
  const staffById = (id) => db.staff.find((s) => s.id === id);
  const analysisCache = new Map();
  function analysis(s) {
    if (!analysisCache.has(s.id)) analysisCache.set(s.id, Y.analyze(s, TODAY, db.settings));
    return analysisCache.get(s.id);
  }

  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = ''; }, 3500);
  }

  // ---------- ダイアログ ----------
  function openDialog(opt) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'dlg';
      d.innerHTML = '<form method="dialog"><h2>' + esc(opt.title) + '</h2><div class="dlg-body">' + (opt.html || '') + '</div><p class="dlg-err" role="alert"></p>' +
        '<div class="dlg-actions"><button type="button" class="btn" data-x="cancel">' + esc(opt.cancel || 'キャンセル') + '</button>' +
        '<button type="submit" class="btn ' + (opt.danger ? 'danger' : 'primary') + '">' + esc(opt.ok || '保存') + '</button></div></form>';
      document.body.appendChild(d);
      const f = d.querySelector('form');
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        const err = opt.validate ? opt.validate(data) : '';
        if (err) { d.querySelector('.dlg-err').textContent = err; return; }
        close(data);
      });
      d.querySelector('[data-x=cancel]').addEventListener('click', () => close(null));
      d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
      d.showModal();
      const first = d.querySelector('input,select,textarea');
      if (first) first.focus();
    });
  }
  const confirmDlg = (title, msg, ok, danger) => openDialog({ title, html: '<p>' + msg + '</p>', ok: ok || 'OK', danger }).then((r) => r !== null);
  const field = (label, name, value, type, extra) => '<label class="f">' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '" ' + (extra || '') + '></label>';

  // ---------- 管理者ログイン ----------
  async function hashPw(pw) {
    const text = 'yukyu-salt:' + pw;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + h;
  }
  async function login() {
    const r = await openDialog({ title: '管理者ログイン', html: field('パスワード', 'pw', '', 'password', 'autocomplete="current-password"'), ok: 'ログイン' });
    if (!r) return false;
    if ((await hashPw(r.pw)) === db.settings.adminHash) { state.isAdmin = true; render(); toast('管理者としてログインしました'); return true; }
    toast('パスワードが違います', true); return false;
  }
  function requireAdmin() {
    if (state.isAdmin) return true;
    toast('この操作は管理者のみです。右上の「管理者ログイン」から入ってください', true);
    return false;
  }

  // ---------- 画面の骨組み ----------
  const NAV = [['list', '一覧'], ['entry', '取得入力'], ['staff', 'スタッフ'], ['audit', '修正履歴'], ['settings', '設定・バックアップ']];
  function go(view, id, tab) {
    state.view = view; state.id = id || null; state.tab = tab || 'summary';
    if (view === 'entry') { state.entryError = ''; }
    render(); window.scrollTo(0, 0);
  }

  function render() {
    analysisCache.clear();
    const app = document.getElementById('app');
    if (state.mode === 'staff') {
      let sb = '';
      try { sb = viewStaffSelf(); } catch (e) { console.error(e); sb = '<section class="card"><p class="form-err">画面の表示でエラーが出ました：' + esc(e.message) + '</p></section>'; }
      app.innerHTML = '<header class="top"><h1>有給休暇（スタッフ用）</h1><div class="who"><span>' + fd(TODAY) + ' 現在</span><button class="btn" data-act="mode-admin">管理者画面へ</button></div></header><main>' + (loadError ? '<p class="alert danger">' + esc(loadError) + '</p>' : '') + sb + '</main>';
      return;
    }
    const navOn = state.view === 'detail' || state.view === 'form' || state.view === 'ledger' ? 'staff' : state.view;
    let body = '';
    try {
      body = ({ list: viewList, entry: viewEntry, staff: viewStaff, form: viewForm, detail: viewDetail, ledger: viewLedger, audit: viewAudit, settings: viewSettings }[state.view] || viewList)();
    } catch (e) { console.error(e); body = '<section class="card"><p class="form-err">画面の表示でエラーが出ました：' + esc(e.message) + '</p></section>'; }
    const who = db.settings.adminHash
      ? (state.isAdmin ? '<span class="tag ok">管理者</span><button class="btn" data-act="logout">ログアウト</button>' : '<span class="tag">閲覧のみ</span><button class="btn" data-act="login">管理者ログイン</button>')
      : '<span class="tag warn">パスワード未設定</span>';
    app.innerHTML = '<header class="top"><h1>有給休暇管理</h1><div class="who"><span>' + fd(TODAY) + ' 現在</span>' + who + '<button class="btn" data-act="mode-staff">スタッフ画面を見る</button></div></header>' +
      '<nav class="tabs" aria-label="メニュー">' + NAV.map((n) => '<button data-act="nav" data-view="' + n[0] + '" class="' + (navOn === n[0] ? 'on' : '') + '">' + n[1] + '</button>').join('') + '</nav>' +
      '<main>' + (loadError ? '<p class="alert danger">' + esc(loadError) + '</p>' : '') + body + '</main>';
    if (state.view === 'form') updatePreview(document.getElementById('staffform'));
  }

  // ---------- 表示用の部品 ----------
  const activeStaff = () => db.staff.filter((s) => s.status !== '退職');
  function matches(s) {
    const q = state.q.trim().toLowerCase();
    if (q && !(s.name.toLowerCase().includes(q) || String(s.code || '').toLowerCase().includes(q))) return false;
    if (state.filter === 'active') return s.status !== '退職';
    if (state.filter === 'retired') return s.status === '退職';
    return true;
  }
  const searchBar = () => '<div class="row noprint"><input class="inp" style="max-width:260px" id="q" data-live="q" placeholder="名前・IDで検索" value="' + esc(state.q) + '">' +
    '<select class="inp" style="max-width:160px" id="filter" data-live="filter"><option value="active"' + (state.filter === 'active' ? ' selected' : '') + '>在籍・休職</option><option value="retired"' + (state.filter === 'retired' ? ' selected' : '') + '>退職者</option><option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>すべて</option></select></div>';
  const statusTag = (s) => s.status === '在籍' ? '' : ' <span class="tag ' + (s.status === '退職' ? '' : 'info') + '">' + esc(s.status) + '</span>';

  function obligationCell(a) {
    const o = a.obligation;
    let cls = 'cell-na', txt = '対象外';
    if (!a.hasGrant) { txt = '付与前'; }
    else if (o.state === 'ok') { cls = 'cell-ok'; txt = '達成（' + round1(o.done) + '日）'; }
    else if (o.state === 'open') {
      cls = o.level === 'danger' ? 'cell-danger' : o.level === 'warn' ? 'cell-warn' : '';
      txt = '残' + round1(o.short) + '日<br><span class="small">' + fd(o.end) + 'まで</span>';
    }
    if (a.obligationFailedPast.length) txt += '<br><span class="tag danger">過去に未達あり</span>';
    return '<td class="' + cls + '">' + txt + '</td>';
  }
  function expiringCell(a) {
    if (!a.expiring) return '<td class="cell-na">なし</td>';
    const left = Y.diffDays(TODAY, a.expiring.date);
    const cls = left <= db.settings.expiryWarnDays ? 'cell-danger' : left <= 90 ? 'cell-warn' : '';
    return '<td class="' + cls + '">' + bal(a.expiring.days, a.H) + '<br><span class="small">' + fd(a.expiring.date) + 'に失効</span></td>';
  }

  // ---------- 一覧（管理者用） ----------
  function viewList() {
    const rows = db.staff.filter(matches).map((s) => ({ s, a: analysis(s) }));
    const all = db.staff.filter((s) => s.status !== '退職').map((s) => ({ s, a: analysis(s) }));
    let alerts = '';
    const exp = all.filter((r) => r.a.expiringSoon.length);
    if (exp.length) alerts += '<div class="alert danger"><strong>' + db.settings.expiryWarnDays + '日以内に失効する有給があります</strong><ul>' + exp.map((r) => '<li><a href="#" data-act="open" data-id="' + r.s.id + '">' + esc(r.s.name) + '</a>：' + r.a.expiringSoon.map((g) => bal(g.unused, r.a.H) + '（' + fd(g.expire) + 'に失効）').join('、') + '</li>').join('') + '</ul></div>';
    const obl = all.filter((r) => r.a.obligation.state === 'open' && r.a.obligation.level !== 'normal');
    if (obl.length) alerts += '<div class="alert warn"><strong>年5日の取得義務の期限が近づいています</strong><ul>' + obl.map((r) => '<li><a href="#" data-act="open" data-id="' + r.s.id + '">' + esc(r.s.name) + '</a>：あと' + round1(r.a.obligation.short) + '日（' + fd(r.a.obligation.end) + 'まで）</li>').join('') + '</ul></div>';
    const failed = all.filter((r) => r.a.obligationFailedPast.length);
    if (failed.length) alerts += '<div class="alert danger"><strong>年5日の取得義務を満たせなかった期間があります</strong>：' + failed.map((r) => esc(r.s.name)).join('、') + '</div>';
    const pend = all.filter((r) => r.a.pending.length);
    if (pend.length) alerts += '<div class="alert warn"><strong>付与が保留になっています</strong>（出勤率8割未満、または勤務条件の不足）：' + pend.map((r) => '<a href="#" data-act="open" data-id="' + r.s.id + '" data-tab="grants">' + esc(r.s.name) + '</a>').join('、') + '</div>';
    const bad = all.filter((r) => r.a.shortages.length);
    if (bad.length) alerts += '<div class="alert danger"><strong>残高より多く取得した記録があります（要確認）</strong>：' + bad.map((r) => '<a href="#" data-act="open" data-id="' + r.s.id + '" data-tab="usage">' + esc(r.s.name) + '</a>').join('、') + '</div>';
    const lb = db.settings.lastBackup;
    if (db.staff.length && (!lb || Y.diffDays(lb.slice(0, 10), TODAY) > 30)) alerts += '<div class="alert info">バックアップが ' + (lb ? '30日以上' : 'まだ') + ' 取られていません。<a href="#" data-act="nav" data-view="settings">設定・バックアップ</a> から保存してください。</div>';

    const head = '<tr><th>氏名</th><th>区分</th><th>残有給</th><th>次回付与日</th><th>失効予定</th><th>年5日義務</th></tr>';
    const trs = rows.map(({ s, a }) => {
      const remainCls = a.hasGrant && a.remaining < 5 - 1e-6 ? 'cell-warn' : '';
      const next = a.next ? fd(a.next.date) + '<br><span class="small">' + (a.next.days === null ? '日数 要確認' : a.next.days + '日付与見込') + '</span>' : '—';
      return '<tr><td><a href="#" data-act="open" data-id="' + s.id + '">' + esc(s.name) + '</a>' + statusTag(s) + '</td><td>' + esc(s.employment) + '</td>' +
        '<td class="' + remainCls + '">' + (a.hasGrant ? '<strong>' + bal(a.remaining, a.H) + '</strong>' : '<span class="muted">付与前</span>') + (a.pending.length ? '<br><span class="tag warn">保留あり</span>' : '') + '</td>' +
        '<td>' + next + '</td>' + expiringCell(a) + obligationCell(a) + '</tr>';
    }).join('');
    return '<section class="card"><div class="row between"><h2 style="margin:0">全スタッフの状況</h2><div class="row noprint"><button class="btn" data-act="csv-list">CSV出力（Excelで開けます）</button><button class="btn" data-act="print">印刷</button></div></div>' +
      '<p class="hint">色の意味：<span class="tag danger">赤</span>失効30日以内・義務の期限30日以内　<span class="tag warn">黄</span>要注意（残5日未満・義務の期限90日以内など）　<span class="tag ok">緑</span>達成</p></section>' +
      alerts + '<section class="card">' + searchBar() + '<div class="tablewrap" style="margin-top:.6rem"><table><thead>' + head + '</thead><tbody>' + (trs || '<tr><td colspan="6" class="muted">該当するスタッフがいません。「スタッフ」から登録してください。はじめての方は <a href="#" data-act="nav" data-view="settings">設定・バックアップ</a> の一番上にある取扱説明書をご覧ください。</td></tr>') + '</tbody></table></div></section>';
  }

  // ---------- 取得入力 ----------
  function viewEntry() {
    const e = state.entry;
    const list = activeStaff().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (!e.staffId && list.length === 1) e.staffId = list[0].id;
    const s = staffById(e.staffId);
    const a = s ? analysis(s) : null;
    const H = a && a.H;
    const opts = '<option value="">選んでください</option>' + list.map((x) => '<option value="' + x.id + '"' + (x.id === e.staffId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    const kinds = Object.entries(Y.KIND_LABEL).map(([k, v]) => '<label><input type="radio" name="kind" data-entry="kind" value="' + k + '"' + (e.kind === k ? ' checked' : '') + '>' + v + '</label>').join('');
    const hourBox = e.kind === 'hour'
      ? '<label class="f">取得時間数（1時間単位）<input data-entry="hours" type="number" min="1" step="1" inputmode="numeric" value="' + esc(e.hours) + '" style="max-width:140px"></label>' +
        '<p class="hint">' + (H ? 'この人の1日分は ' + H + ' 時間です（所定労働時間の端数は切り上げ）。1回は ' + (H - 1) + ' 時間まで、年間で5日分（' + 5 * H + '時間）までです。' : '1日の所定労働時間が未登録です。') + '</p>' : '';
    const info = a ? '<div class="alert info">現在の残高：<strong>' + (a.hasGrant ? bal(a.remaining, a.H) : '付与前') + '</strong>' + (a.expiring ? '　／　次の失効：' + bal(a.expiring.days, a.H) + '（' + fd(a.expiring.date) + '）' : '') + '</div>' : '';
    let recent = '';
    if (s) recent = '<section class="card"><h2>' + esc(s.name) + ' さんの最近の取得</h2>' + usageTable(s, 15, true) + '</section>';
    const editing = e.editId ? '<div class="alert warn">取得の記録を修正しています（保存すると、元の記録は「修正」として取り消され、履歴に残ります）。<button class="btn sm" data-act="entry-reset">修正をやめる</button></div>' : '';
    return '<section class="card"><h2>有給の取得を入力</h2>' + editing +
      '<div class="grid c2"><label class="f">① スタッフ<select data-entry="staffId">' + opts + '</select></label>' +
      '<label class="f">② 取得日<input data-entry="date" type="date" value="' + esc(e.date) + '"></label></div>' + info +
      '<fieldset style="margin-top:.8rem"><legend>③ 取得区分</legend><div class="radios">' + kinds + '</div></fieldset>' + hourBox +
      '<label class="f" style="margin-top:.8rem">メモ（任意）<input data-entry="note" data-nore="1" value="' + esc(e.note) + '"></label>' +
      (state.entryError ? '<p class="form-err" role="alert">' + esc(state.entryError) + '</p>' : '') +
      '<div class="row" style="margin-top:.8rem"><button class="btn primary" data-act="entry-save"' + (state.isAdmin ? '' : ' disabled') + '>⑤ 保存</button>' + (state.isAdmin ? '' : '<span class="hint">管理者ログインが必要です</span>') + '</div></section>' + recent;
  }

  function usageTable(s, limit, withActions) {
    const us = (s.usages || []).slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const shown = limit ? us.slice(0, limit) : us;
    if (!shown.length) return '<p class="muted">取得の記録はまだありません。</p>';
    return '<div class="tablewrap"><table><thead><tr><th>取得日</th><th>区分</th><th>消費</th><th>メモ・取消理由</th>' + (withActions ? '<th></th>' : '') + '</tr></thead><tbody>' + shown.map((u) => {
      const cancelled = u.status !== 'active';
      const kindTxt = Y.KIND_LABEL[u.kind] + (u.kind === 'hour' ? '（' + u.hours + '時間）' : '');
      const memo = esc(u.note || '') + (cancelled ? ' <span class="keep tag danger">取消：' + esc(u.cancelReason || '') + '（' + fd((u.cancelledAt || '').slice(0, 10)) + '）</span>' : '');
      const act = withActions ? '<td class="keep nowrap">' + (!cancelled && state.isAdmin ? '<button class="btn sm" data-act="usage-edit" data-sid="' + s.id + '" data-id="' + u.id + '">修正</button> <button class="btn sm" data-act="usage-cancel" data-sid="' + s.id + '" data-id="' + u.id + '">取消</button>' : '') + '</td>' : '';
      return '<tr class="' + (cancelled ? 'cancelled' : '') + '"><td>' + fd(u.date) + '</td><td>' + kindTxt + '</td><td>' + (u.kind === 'hour' ? round1(u.days * 100) / 100 + '日分' : u.days + '日') + '</td><td class="keep">' + memo + '</td>' + act + '</tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ---------- スタッフ一覧 ----------
  function viewStaff() {
    const rows = db.staff.filter(matches).sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja', { numeric: true }));
    const trs = rows.map((s) => {
      const c = Y.conditionAt(s, TODAY) || {};
      return '<tr><td>' + esc(s.code) + '</td><td><a href="#" data-act="open" data-id="' + s.id + '">' + esc(s.name) + '</a>' + statusTag(s) + '</td><td>' + esc(s.employment) + '</td><td>' + fd(s.hireDate) + '</td><td>' + fd(s.firstGrantDate) + '</td>' +
        '<td>' + (c.weeklyDays ? '週' + esc(c.weeklyDays) + '日' : '') + (c.weeklyHours ? ' 週' + esc(c.weeklyHours) + 'h' : '') + (c.dailyHours ? ' 日' + esc(c.dailyHours) + 'h' : '') + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="row between"><h2 style="margin:0">スタッフ</h2>' + (state.isAdmin ? '<button class="btn primary" data-act="staff-new">＋ 新しく登録</button>' : '') + '</div>' + searchBar() +
      '<div class="tablewrap" style="margin-top:.6rem"><table><thead><tr><th>ID</th><th>氏名</th><th>雇用区分</th><th>入社日</th><th>有給初回付与日</th><th>勤務条件</th></tr></thead><tbody>' + (trs || '<tr><td colspan="6" class="muted">スタッフがいません</td></tr>') + '</tbody></table></div></section>';
  }

  // ---------- スタッフ登録・編集 ----------
  function viewForm() {
    const s = state.id ? staffById(state.id) : null;
    const c = s ? (Y.conditionAt(s, TODAY) || {}) : {};
    const g = s || {};
    const locked = s && (s.grants || []).some((x) => x.idx !== null && x.idx !== undefined);
    const sel = (name, val, list) => '<label class="f">' + name[1] + '<select name="' + name[0] + '">' + list.map((v) => '<option' + (v === val ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>';
    return '<section class="card"><h2>' + (s ? esc(s.name) + ' さんの情報を編集' : 'スタッフを新しく登録') + '</h2>' +
      '<form id="staffform" novalidate><h3>基本情報</h3><div class="grid c3">' +
      field('スタッフID（空欄なら自動）', 'code', g.code || '') + field('氏名', 'name', g.name || '', 'text', 'required') +
      sel(['employment', '雇用区分'], g.employment || '正社員', ['正社員', 'パート']) +
      field('入社日', 'hireDate', g.hireDate || '', 'date', 'required') +
      '<div><label class="f">有給初回付与日<input name="firstGrantDate" type="date" value="' + esc(g.firstGrantDate || '') + '"' + (locked ? ' readonly' : '') + ' required></label>' + (locked ? '<span class="hint">付与履歴があるため変更できません</span>' : '<button type="button" class="btn sm" data-act="fill-first">入社日＋6か月を入れる</button>') + '</div>' +
      sel(['status', '在籍状況'], g.status || '在籍', ['在籍', '休職', '退職']) + field('退職日（退職のとき）', 'retireDate', g.retireDate || '', 'date') + '</div>' +
      '<h3>勤務条件' + (s ? '（現在）' : '') + '</h3>' +
      (s ? '<p class="hint">勤務日数・時間を変えたときは、下の「変更日」を入れてください。以前の条件は履歴として残り、付与日ごとにその時点の条件で計算します。</p>' : '') +
      '<div class="grid c3">' + field('週所定労働日数（日）', 'weeklyDays', c.weeklyDays, 'number', 'step="0.5" min="0"') + field('年間所定労働日数（日・必要なとき）', 'annualDays', c.annualDays, 'number', 'min="0"') +
      field('週所定労働時間（時間）', 'weeklyHours', c.weeklyHours, 'number', 'step="0.5" min="0"') + field('1日の所定労働時間（時間）', 'dailyHours', c.dailyHours, 'number', 'step="0.25" min="0"') +
      field('勤務開始', 'start', c.start, 'time') + field('勤務終了', 'end', c.end, 'time') + field('休憩（分）', 'breakMin', c.breakMin, 'number', 'min="0"') + field('休憩の開始（空欄なら自動）', 'breakStart', c.breakStart, 'time') + '<div><button type="button" class="btn sm" data-act="fill-daily">開始・終了・休憩から1日の時間を計算</button></div>' +
      '<label class="f">午前半休の日の勤務時間帯（空欄なら自動）<input name="amLeaveWork" value="' + esc(c.amLeaveWork || '') + '" placeholder="例：14:30〜18:30"></label>' +
      '<label class="f">午後半休の日の勤務時間帯（空欄なら自動）<input name="pmLeaveWork" value="' + esc(c.pmLeaveWork || '') + '" placeholder="例：09:30〜13:30"></label>' +
      (s ? field('条件の変更日（条件を変えたときだけ）', 'changeDate', '', 'date') + '<label class="f"><span><input type="checkbox" name="fixMistake"> 入力の間違いを直す（変更ではなく、最初からこの条件だった場合）</span></label>' : '') + '</div>' +
      '<div id="condPreview" class="alert info" aria-live="polite"></div>' +
      '<label class="f" style="margin-top:.8rem">メモ<textarea name="memo" rows="2">' + esc(g.memo || '') + '</textarea></label>' +
      '<p class="form-err" id="formerr" role="alert" hidden></p>' +
      '<div class="row" style="margin-top:.8rem"><button class="btn primary" type="submit">保存</button><button type="button" class="btn" data-act="' + (s ? 'open" data-id="' + s.id : 'nav" data-view="staff') + '">戻る</button></div></form></section>';
  }

  const CONDITION_KEYS = ['weeklyDays', 'annualDays', 'weeklyHours', 'dailyHours', 'start', 'end', 'breakMin', 'breakStart', 'amLeaveWork', 'pmLeaveWork'];
  // 勤務条件の入力チェック（週時間と「日数×1日の時間」が合わないときなど）
  function condWarnings(cond, emp) {
    const wd = Y.num(cond.weeklyDays), dh = Y.num(cond.dailyHours), wh = Y.num(cond.weeklyHours);
    const out = { mismatch: '', notes: [] };
    if (wd !== null && dh !== null && wh !== null && Math.abs(wh - wd * dh) > 1) {
      out.mismatch = '週所定労働時間（' + wh + '時間）が、週の日数×1日の時間（' + wd + '日×' + dh + '時間＝' + wd * dh + '時間）と合っていません。入力を確認してください。';
    }
    if (emp === 'パート' && wh !== null && wh >= 30 && wd !== null && wd <= 4) out.notes.push('週30時間以上のため、パートでも通常付与（正社員と同じ日数）になります。');
    return out;
  }
  function updatePreview(f) {
    const box = document.getElementById('condPreview');
    if (!box || !f) return;
    const cond = {};
    CONDITION_KEYS.forEach((k) => { cond[k] = f.elements[k] ? f.elements[k].value.trim() : ''; });
    const emp = f.elements.employment.value, hire = f.elements.hireDate.value || '2000-01-01';
    const cls = Y.classify(cond, emp);
    const w = condWarnings(cond, emp);
    let html;
    if (cls.type === 'unknown') html = '<strong>付与日数はまだ計算できません</strong>：週所定労働日数・週所定労働時間などを入力してください。';
    else {
      const tmp = { employment: emp, hireDate: hire, conditions: [Object.assign({ from: '1900-01-01' }, cond)] };
      const row = Y.TENURE_LABELS.map((l, i) => l + '＝' + Y.legalGrantDays(tmp, i, Y.addMonths(hire, Y.TENURE_MONTHS[i])).days + '日').join('／');
      const name = cls.type === 'regular' ? '通常付与' : cls.type === 'proportional' ? '比例付与（週' + cls.band + '日）' : '法定付与なし';
      html = '<strong>この条件の判定：' + name + '</strong>（' + esc(cls.reason) + '）<br>付与日数：' + row;
    }
    if (w.mismatch) html += '<br><strong>⚠ ' + esc(w.mismatch) + '</strong>';
    w.notes.forEach((n) => { html += '<br>ℹ ' + esc(n); });
    box.innerHTML = html;
    box.className = 'alert ' + (w.mismatch ? 'warn' : 'info');
  }

  async function submitStaffForm(form) {
    if (!requireAdmin()) return;
    const f = Object.fromEntries(new FormData(form));
    const err = (m) => { const el = document.getElementById('formerr'); el.textContent = m; el.hidden = false; el.scrollIntoView({ block: 'center' }); };
    const s = state.id ? staffById(state.id) : null;
    const name = (f.name || '').trim();
    if (!name) return err('氏名を入力してください');
    if (!f.hireDate) return err('入社日を入力してください');
    if (!f.firstGrantDate) return err('有給初回付与日を入力してください（入社日の6か月後が原則です）');
    if (f.status === '退職' && !f.retireDate) return err('退職の場合は退職日を入力してください');
    const code = (f.code || '').trim() || 'S' + String(db.staff.length + 1).padStart(3, '0');
    if (db.staff.some((x) => x !== s && x.code === code)) return err('スタッフID「' + code + '」はすでに使われています');
    const wd = Y.num(f.weeklyDays), ad = Y.num(f.annualDays), wh = Y.num(f.weeklyHours);
    if (wd === null && ad === null && wh === null && f.employment !== '正社員') return err('パートの方は、週所定労働日数・年間所定労働日数・週所定労働時間のいずれかを入力してください（付与日数の計算に必要です）');
    if (f.firstGrantDate < f.hireDate) return err('有給初回付与日が入社日より前になっています');
    if (Y.monthsBetween(f.hireDate, f.firstGrantDate) < 6 && !s) {
      if (!(await confirmDlg('前倒し付与の確認', '初回付与日が入社から6か月未満です。法定より早く付与する「前倒し付与」として登録します。よろしいですか？', '登録する'))) return;
    }
    const cond = {};
    CONDITION_KEYS.forEach((k) => { cond[k] = (f[k] || '').trim(); });
    const cw = condWarnings(cond, f.employment);
    if (cw.mismatch && !(await confirmDlg('勤務条件の確認', esc(cw.mismatch) + '<br>このまま保存しますか？（付与日数は、週所定労働日数・週所定労働時間をもとに計算されます）', 'このまま保存'))) return;

    if (!s) {
      const ns = { id: Y.uid(), code, name, employment: f.employment, hireDate: f.hireDate, firstGrantDate: f.firstGrantDate, status: f.status, retireDate: f.retireDate || '', memo: f.memo || '', conditions: [Object.assign({ from: f.hireDate }, cond)], grants: [], usages: [], attendance: {} };
      db.staff.push(ns);
      const created = Y.processGrants(ns, TODAY);
      log('スタッフ登録', ns, '雇用区分：' + ns.employment + '／入社日：' + ns.hireDate + '／初回付与日：' + ns.firstGrantDate);
      created.forEach((g) => log('自動付与', ns, fd(g.date) + ' ' + g.days + '日（' + g.status + '）'));
      if (save()) { toast('登録しました'); go('detail', ns.id); }
      return;
    }

    const before = JSON.stringify([s.code, s.name, s.employment, s.hireDate, s.status, s.retireDate, s.memo]);
    const cur = Y.conditionAt(s, TODAY) || {};
    const condChanged = CONDITION_KEYS.some((k) => String(cur[k] === undefined || cur[k] === null ? '' : cur[k]) !== cond[k]);
    if (condChanged && f.fixMistake) {
      Object.assign(Y.conditionAt(s, TODAY), cond);
      log('勤務条件の訂正', s, '入力の間違いを訂正：週' + (cond.weeklyDays || '—') + '日／週' + (cond.weeklyHours || '—') + '時間／1日' + (cond.dailyHours || '—') + '時間');
    } else if (condChanged) {
      if (!f.changeDate) return err('勤務条件が変わっています。「条件の変更日」を入力してください（以前の条件は履歴に残ります）');
      const same = s.conditions.find((x) => x.from === f.changeDate);
      if (same) Object.assign(same, cond); else s.conditions.push(Object.assign({ from: f.changeDate }, cond));
      log('勤務条件の変更', s, fd(f.changeDate) + ' から：週' + (cond.weeklyDays || '—') + '日／週' + (cond.weeklyHours || '—') + '時間／1日' + (cond.dailyHours || '—') + '時間');
    }
    Object.assign(s, { code, name, employment: f.employment, hireDate: f.hireDate, status: f.status, retireDate: f.retireDate || '', memo: f.memo || '' });
    if (!(s.grants || []).some((x) => x.idx !== null && x.idx !== undefined)) s.firstGrantDate = f.firstGrantDate;
    if (before !== JSON.stringify([s.code, s.name, s.employment, s.hireDate, s.status, s.retireDate, s.memo])) log('基本情報の変更', s, '');
    (s.grants || []).forEach((g) => { if (g.status === 'pending' && Y.reevaluateGrant(s, g)) log('付与の再判定', s, fd(g.date) + ' → ' + g.status); });
    Y.processGrants(s, TODAY).forEach((g) => log('自動付与', s, fd(g.date) + ' ' + g.days + '日（' + g.status + '）'));
    if (save()) { toast('保存しました'); go('detail', s.id); }
  }

  // ---------- 個人の詳細 ----------
  const TABS = [['summary', '残高'], ['grants', '付与履歴'], ['usage', '取得履歴'], ['obligation', '年5日義務'], ['attendance', '出勤率'], ['work', '勤務条件・半休']];
  function viewDetail() {
    const s = staffById(state.id);
    if (!s) return '<section class="card">スタッフが見つかりません</section>';
    const tabs = '<div class="subtabs">' + TABS.map((t) => '<button data-act="tab" data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>';
    const body = ({ summary: tabSummary, grants: tabGrants, usage: tabUsage, obligation: tabObligation, attendance: tabAttendance, work: tabWork }[state.tab] || tabSummary)(s);
    return '<section class="card"><div class="row between"><h2 style="margin:0">' + esc(s.name) + statusTag(s) + ' <span class="muted small">' + esc(s.code) + '／' + esc(s.employment) + '／入社 ' + fd(s.hireDate) + '</span></h2>' +
      '<div class="row noprint">' + (state.isAdmin ? '<button class="btn" data-act="staff-edit" data-id="' + s.id + '">情報を編集</button>' : '') + '<button class="btn" data-act="ledger" data-id="' + s.id + '">印刷用の台帳</button><button class="btn" data-act="csv-staff" data-id="' + s.id + '">CSV出力</button></div></div></section>' + tabs + body;
  }

  // いまの勤務条件で計算し直した日数と、付与済みの日数が違うもの（手動で変えた分は除く）
  function recalcDiffs(s) {
    return (s.grants || []).filter((g) => g.status === 'granted' && g.source === 'auto' && !g.manualDays && !g.forced && g.idx !== null && g.idx !== undefined)
      .map((g) => ({ g, legal: Y.legalGrantDays(s, g.idx, g.date) })).filter((x) => x.legal.days !== null && x.legal.days !== Number(x.g.days));
  }
  async function grantRecalc(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const legal = Y.legalGrantDays(s, g.idx, g.date);
    if (!(await confirmDlg('付与日数を計算し直す', fd(g.date) + ' の付与を、いまの勤務条件で計算し直します。<br><strong>' + g.days + '日 → ' + legal.days + '日</strong><br>' + esc(legal.basis) + '<br>よろしいですか？（記録は修正履歴に残ります）', '計算し直す'))) return;
    log('付与日数の再計算', s, fd(g.date) + ' ' + g.days + '日 → ' + legal.days + '日');
    g.days = legal.days; g.legalDays = legal.days; g.basis = legal.basis;
    commit('計算し直しました');
  }

  async function grantRecalcAll(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), diffs = recalcDiffs(s);
    if (!diffs.length) return;
    if (!(await confirmDlg('まとめて計算し直す', '次の付与を、いまの勤務条件で計算し直します。<br>' + diffs.map((x) => fd(x.g.date) + '：' + x.g.days + '日 → <strong>' + x.legal.days + '日</strong>').join('<br>') + '<br>よろしいですか？（記録は修正履歴に残ります）', 'まとめて計算し直す'))) return;
    diffs.forEach((x) => { log('付与日数の再計算', s, fd(x.g.date) + ' ' + x.g.days + '日 → ' + x.legal.days + '日'); x.g.days = x.legal.days; x.g.legalDays = x.legal.days; x.g.basis = x.legal.basis; });
    commit('計算し直しました');
  }

  function tabSummary(s) {
    const a = analysis(s), H = a.H;
    const stat = (k, v, cls) => '<div class="stat ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
    let warn = '';
    const diffs = recalcDiffs(s);
    if (diffs.length) warn += '<div class="alert warn"><strong>付与日数が、いまの勤務条件で計算した日数と違います</strong>：' + diffs.map((x) => fd(x.g.date) + ' ' + x.g.days + '日（計算上は ' + x.legal.days + '日）').join('、') + '。勤務条件が合っていれば、下のボタンで直せます。<br><button class="btn sm primary" data-act="grant-recalc-all" data-sid="' + s.id + '">まとめて計算し直す</button></div>';
    if (a.pending.length) warn += '<div class="alert warn">付与が保留になっています：' + a.pending.map((g) => fd(g.date) + '（' + (g.pendingReason === 'attendance' ? '出勤率8割未満' : '勤務条件の不足') + '）').join('、') + '。「付与履歴」で確認してください。</div>';
    if (a.shortages.length) warn += '<div class="alert danger">残高より多く取得した記録があります。「取得履歴」で確認してください。</div>';
    if (a.expiringSoon.length) warn += '<div class="alert danger">' + db.settings.expiryWarnDays + '日以内に失効：' + a.expiringSoon.map((g) => bal(g.unused, H) + '（' + fd(g.expire) + 'に失効）').join('、') + '</div>';
    if (!a.hasGrant) return warn + '<section class="card"><p>まだ有給が付与されていません。初回付与日は <strong>' + fd(s.firstGrantDate) + '</strong> です。</p></section>';
    const o = a.obligation;
    const oblTxt = o.state === 'ok' ? '取得義務5日／取得済み' + round1(o.done) + '日（達成）' : o.state === 'open' ? '取得義務' + o.required + '日／取得済み' + round1(o.done) + '日／残り' + round1(o.short) + '日（' + fd(o.end) + 'まで）' : '対象外（今回の付与が10日未満）';
    return warn + '<section class="card"><div class="stats">' +
      stat('現在の残高（日＋時間）', bal(a.remaining, H), 'big') + stat('前年度繰越', bal(a.carry, H)) + stat('今年度付与', a.granted + '日') +
      stat('取得済み日数（1日・半日）', round1(a.usedDays) + '日') + stat('取得済み時間数（時間単位）', a.usedHours + '時間') + stat('失効日数', bal(a.expiredDays, H)) +
      stat('次回付与日', a.next ? fd(a.next.date) : '—') + stat('次回付与予定日数', a.next ? (a.next.days === null ? '要確認' : a.next.days + '日') : '—') + '</div>' +
      '<p class="hint">今年度 ' + fd(a.periodStart) + '〜' + fd(a.periodEnd) + '　繰越＋付与−取得−失効＝残高。時間単位は 1日＝' + (H || '？') + '時間で換算。</p>' +
      '<h3>年5日の取得義務</h3><p>' + oblTxt + '</p>' + (a.next && a.next.basis ? '<p class="hint">次回の付与根拠：' + esc(a.next.basis) + '</p>' : '') + '</section>';
  }

  function tabGrants(s) {
    const a = analysis(s);
    const rp = Y.replay(s, TODAY);
    const by = new Map(rp.grants.map((g) => [g.id, g]));
    const grants = (s.grants || []).slice().sort((x, y) => y.date.localeCompare(x.date));
    const admin = state.isAdmin;
    const trs = grants.map((g) => {
      const r = by.get(g.id);
      const stTag = g.status === 'granted' ? '<span class="tag ok">付与済</span>' : g.status === 'pending' ? '<span class="tag warn">保留（' + (g.pendingReason === 'attendance' ? '出勤率8割未満' : '勤務条件の不足') + '）</span>' : '<span class="tag">取消</span>';
      const kind = g.kind === 'extra' ? '独自（法定上乗せ）' : g.source === 'manual' ? '手動（法定）' : '定期付与';
      const diff = g.legalDays !== null && g.legalDays !== undefined && Number(g.days) !== Number(g.legalDays) && g.status === 'granted' ? '<br><span class="small muted">法定 ' + g.legalDays + '日</span>' : '';
      const acts = !admin ? '' : (g.status === 'void' ? '' :
 (recalcDiffs(s).some((x) => x.g.id === g.id) ? '<button class="btn sm primary" data-act="grant-recalc" data-sid="' + s.id + '" data-id="' + g.id + '">計算し直す</button> ' : '') +
        '<button class="btn sm" data-act="grant-days" data-sid="' + s.id + '" data-id="' + g.id + '">日数変更</button> ' +
        '<button class="btn sm" data-act="grant-expire" data-sid="' + s.id + '" data-id="' + g.id + '">期限変更</button> ' +
        (g.status === 'pending' ? '<button class="btn sm" data-act="grant-reeval" data-sid="' + s.id + '" data-id="' + g.id + '">再判定</button> <button class="btn sm" data-act="grant-force" data-sid="' + s.id + '" data-id="' + g.id + '">付与する</button> ' : '') +
        '<button class="btn sm" data-act="grant-void" data-sid="' + s.id + '" data-id="' + g.id + '">取消</button>');
      return '<tr class="' + (g.status === 'void' ? 'cancelled' : '') + '"><td>' + fd(g.date) + '</td><td>' + kind + '</td><td>' + g.days + '日' + diff + '</td><td class="keep">' + stTag + '</td><td>' + fd(lastDay(Y.expireOf(g))) + 'まで</td>' +
        '<td>' + (r ? bal(r.used, a.H) : '—') + '</td><td>' + (r && r.expired > 1e-6 ? '<span class="tag danger">' + bal(r.expired, a.H) + '</span>' : '—') + '</td><td>' + (r ? '<strong>' + bal(r.remaining, a.H) + '</strong>' : '—') + '</td>' +
        '<td class="keep small">' + esc(g.basis || g.note || '') + (g.note && g.basis ? '<br>' + esc(g.note) : '') + '</td>' + (admin ? '<td class="keep nowrap">' + acts + '</td>' : '') + '</tr>';
    }).join('');
    return '<section class="card"><div class="row between"><h2 style="margin:0">付与履歴</h2>' + (admin ? '<button class="btn" data-act="grant-add" data-sid="' + s.id + '">＋ 手動で付与（独自の上乗せなど）</button>' : '') + '</div>' +
      '<p class="hint">定期付与は付与日に自動で作られ、勤務条件を後から変えても過去の付与は変わりません。付与・取消・変更はすべて「修正履歴」に残ります。</p>' +
      '<div class="tablewrap"><table><thead><tr><th>付与日</th><th>種類</th><th>日数</th><th>状態</th><th>使える期限</th><th>取得済み</th><th>失効</th><th>残り</th><th>根拠・メモ</th>' + (admin ? '<th></th>' : '') + '</tr></thead><tbody>' + (trs || '<tr><td colspan="10" class="muted">まだ付与がありません</td></tr>') + '</tbody></table></div></section>';
  }

  const tabUsage = (s) => '<section class="card"><div class="row between"><h2 style="margin:0">取得履歴</h2>' + (state.isAdmin ? '<button class="btn primary" data-act="entry-for" data-id="' + s.id + '">＋ 取得を入力</button>' : '') + '</div>' + usageTable(s, 0, true) + '</section>';

  function tabObligation(s) {
    const a = analysis(s);
    const trs = a.obligations.slice().reverse().map((p) => {
      const st = p.state === 'ok' ? '<span class="tag ok">達成</span>' : p.state === 'failed' ? '<span class="tag danger">未達（期間終了）</span>' : '<span class="tag warn">取得中</span>';
      return '<tr><td>' + fd(p.start) + '〜' + fd(p.end) + '</td><td>' + p.required + '日</td><td>' + round1(p.done) + '日</td><td>' + (p.planned ? round1(p.planned) + '日' : '—') + '</td><td>' + (p.short > 0 ? '<strong>' + round1(p.short) + '日</strong>' : '—') + '</td><td>' + st + '</td>' +
        '<td>' + (p.state === 'open' ? 'あと' + p.daysLeft + '日' : '') + '</td>' + (state.isAdmin ? '<td><button class="btn sm" data-act="obl-edit" data-sid="' + s.id + '" data-id="' + p.grantId + '">期間・日数の調整</button></td>' : '') + '</tr>';
    }).join('');
    return '<section class="card"><h2>年5日の取得義務</h2><p class="hint">年10日以上が付与された人が対象です。1日有給は1日、半日有給は0.5日として数え、時間単位有給は数えません。前倒し付与などで期間が重なるときは「期間・日数の調整」で変更できます。</p>' +
      '<div class="tablewrap"><table><thead><tr><th>義務の期間</th><th>義務</th><th>取得済み</th><th>予定（今日より後）</th><th>不足</th><th>状態</th><th>期限</th>' + (state.isAdmin ? '<th></th>' : '') + '</tr></thead><tbody>' + (trs || '<tr><td colspan="8" class="muted">対象の付与がありません（付与が10日未満、または未付与）</td></tr>') + '</tbody></table></div></section>';
  }

  function tabAttendance(s) {
    const maxIdx = Math.max(-1, ...(s.grants || []).filter((g) => g.idx !== null && g.idx !== undefined).map((g) => g.idx));
    const a = analysis(s);
    const upto = a.next ? a.next.idx : maxIdx;
    let trs = '';
    for (let k = upto; k >= 0; k--) {
      const date = Y.addYears(s.firstGrantDate, k);
      const att = (s.attendance || {})[k];
      const j = Y.attendanceJudge(att);
      const g = (s.grants || []).find((x) => x.idx === k);
      const judge = j.state === 'ok' ? '<span class="tag ok">8割以上</span>' : j.state === 'ng' ? '<span class="tag danger">8割未満</span>' : '<span class="tag">未入力（8割以上とみなして付与）</span>';
      trs += '<tr><td>' + fd(date) + (date > TODAY ? ' <span class="tag info">これから</span>' : '') + '</td><td>' + (att ? esc(att.required) : '—') + '</td><td>' + (att ? esc(att.attended || 0) : '—') + '</td><td>' + (att ? esc(att.deemed || 0) : '—') + '</td><td>' + (j.rate === null ? '—' : round1(j.rate * 1000) / 10 + '%') + '</td><td>' + judge + '</td><td>' + (g ? (g.status === 'granted' ? '付与済' : g.status === 'pending' ? '保留' : '取消') : '—') + '</td>' +
        (state.isAdmin ? '<td><button class="btn sm" data-act="att-edit" data-sid="' + s.id + '" data-idx="' + k + '">入力・変更</button></td>' : '') + '</tr>';
    }
    return '<section class="card"><h2>出勤率（8割以上で付与）</h2><p class="hint">付与日の直前1年間（初回は雇入れから付与日まで）について、全労働日と出勤日を入力します。<strong>業務上の傷病による休業・産前産後休業・育児休業・介護休業・年休を取った日</strong>は出勤したものとみなすので、「みなし出勤日数」に入れてください。8割未満になると、その回の付与は自動で「保留」になります。入力がないときは、8割以上とみなして付与します。</p>' +
      '<div class="tablewrap"><table><thead><tr><th>付与日</th><th>全労働日</th><th>出勤日数</th><th>みなし出勤日数</th><th>出勤率</th><th>判定</th><th>付与</th>' + (state.isAdmin ? '<th></th>' : '') + '</tr></thead><tbody>' + (trs || '<tr><td colspan="8" class="muted">付与日がまだありません</td></tr>') + '</tbody></table></div></section>';
  }

  function tabWork(s) {
    const cs = (s.conditions || []).slice().sort((x, y) => y.from.localeCompare(x.from));
    const trs = cs.map((c) => '<tr><td>' + fd(c.from) + '〜</td><td>' + esc(c.weeklyDays || '—') + '日</td><td>' + esc(c.annualDays || '—') + '日</td><td>' + esc(c.weeklyHours || '—') + '時間</td><td>' + esc(c.dailyHours || '—') + '時間</td><td>' + esc(c.start || '—') + '〜' + esc(c.end || '—') + '</td><td>' + esc(c.breakMin || '—') + '分</td></tr>').join('');
    const cur = Y.conditionAt(s, TODAY);
    const h = Y.halfDaySchedule(cur);
    const cls = cur ? Y.classify(cur, s.employment) : null;
    const half = h ? '<h3>半休の日の勤務（現在の条件）</h3><div class="tablewrap"><table><tbody>' +
      '<tr><th>通常の勤務</th><td>' + h.amWork + ' ＋ 休憩 ' + h.breakText + ' ＋ ' + h.pmWork + '（実働 ' + h.netHours + '時間）</td></tr>' +
      '<tr><th>午前半休の日</th><td>' + esc(h.amLeave) + ' に勤務（' + h.amLeaveHours + '時間）<br><span class="small muted">' + h.amLeaveNote + '</span></td></tr>' +
      '<tr><th>午後半休の日</th><td>' + esc(h.pmLeave) + ' に勤務（' + h.pmLeaveHours + '時間）<br><span class="small muted">' + h.pmLeaveNote + '</span></td></tr></tbody></table></div><p class="hint">半休の時間帯は「情報を編集」で、この人ごとに変えられます。半休は0.5日として数え、年間の回数制限はありません。</p>' : '<p class="muted">勤務開始・終了時刻が未入力のため、半休の時間帯は表示できません。</p>';
    return '<section class="card"><h2>勤務条件の履歴</h2><p>現在の判定：<strong>' + (cls ? (cls.type === 'regular' ? '通常付与' : cls.type === 'proportional' ? '比例付与（週' + cls.band + '日相当）' : cls.type === 'none' ? '法定付与なし' : '判定不可') : '—') + '</strong>　<span class="hint">' + esc(cls ? cls.reason : '') + '</span>　時間単位年休の1日分：' + (a1(cur)) + '</p>' +
      '<div class="tablewrap"><table><thead><tr><th>適用開始</th><th>週所定日数</th><th>年間所定日数</th><th>週所定時間</th><th>1日の所定時間</th><th>勤務時間</th><th>休憩</th></tr></thead><tbody>' + trs + '</tbody></table></div>' + half + '</section>';
  }
  const a1 = (c) => { const h = Y.hourUnit(c); return h ? h + '時間' : '—'; };

  // ---------- 印刷用の台帳 ----------
  function viewLedger() {
    const s = staffById(state.id);
    if (!s) return '';
    const a = analysis(s);
    const grants = (s.grants || []).filter((g) => g.status !== 'void').sort((x, y) => x.date.localeCompare(y.date));
    const rp = new Map(Y.replay(s, TODAY).grants.map((g) => [g.id, g]));
    const gt = grants.map((g) => { const r = rp.get(g.id); return '<tr><td>' + fd(g.date) + '</td><td>' + g.days + '日' + (g.status === 'pending' ? '（保留）' : '') + '</td><td>' + fd(lastDay(Y.expireOf(g))) + 'まで</td><td>' + (r ? bal(r.used, a.H) : '—') + '</td><td>' + (r ? bal(r.expired, a.H) : '—') + '</td><td>' + (r ? bal(r.remaining, a.H) : '—') + '</td></tr>'; }).join('');
    const ut = (s.usages || []).filter((u) => u.status === 'active').sort((x, y) => x.date.localeCompare(y.date)).map((u) => '<tr><td>' + fd(u.date) + '</td><td>' + Y.KIND_LABEL[u.kind] + (u.kind === 'hour' ? '（' + u.hours + '時間）' : '') + '</td><td>' + esc(u.note || '') + '</td></tr>').join('');
    return '<section class="card ledger"><div class="row between noprint"><button class="btn" data-act="open" data-id="' + s.id + '">戻る</button><button class="btn primary" data-act="print">印刷する</button></div>' +
      '<h2>年次有給休暇管理台帳</h2><table><tbody><tr><th>氏名</th><td>' + esc(s.name) + '（' + esc(s.code) + '）</td><th>雇用区分</th><td>' + esc(s.employment) + '</td></tr><tr><th>入社日</th><td>' + fd(s.hireDate) + '</td><th>有給初回付与日</th><td>' + fd(s.firstGrantDate) + '</td></tr>' +
      '<tr><th>基準日（出力日）</th><td>' + fd(TODAY) + '</td><th>現在の残高</th><td><strong>' + (a.hasGrant ? bal(a.remaining, a.H) : '付与前') + '</strong></td></tr>' +
      '<tr><th>年5日の取得義務</th><td colspan="3">' + (a.obligation.state === 'na' ? '対象外' : '義務' + a.obligation.required + '日／取得済み' + round1(a.obligation.done) + '日／残り' + round1(a.obligation.short) + '日（' + fd(a.obligation.start) + '〜' + fd(a.obligation.end) + '）') + '</td></tr></tbody></table>' +
      '<h2>付与・失効</h2><table><thead><tr><th>付与日</th><th>付与日数</th><th>使える期限</th><th>取得済み</th><th>失効</th><th>残り</th></tr></thead><tbody>' + (gt || '<tr><td colspan="6">なし</td></tr>') + '</tbody></table>' +
      '<h2>取得日一覧</h2><table><thead><tr><th>取得日</th><th>区分</th><th>メモ</th></tr></thead><tbody>' + (ut || '<tr><td colspan="3">なし</td></tr>') + '</tbody></table></section>';
  }

  // ---------- 修正履歴 ----------
  function viewAudit() {
    const q = state.q.trim().toLowerCase();
    const rows = db.audit.filter((r) => !q || (r.staffName + r.action + r.detail).toLowerCase().includes(q)).slice(0, 500);
    return '<section class="card"><h2>修正履歴</h2><p class="hint">付与・取得・取消・勤務条件の変更など、すべての操作が記録されます（消せません）。</p>' +
      '<div class="row noprint"><input class="inp" style="max-width:260px" id="q" data-live="q" placeholder="名前・内容で絞り込み" value="' + esc(state.q) + '"></div>' +
      '<div class="tablewrap" style="margin-top:.6rem"><table><thead><tr><th>日時</th><th>操作者</th><th>スタッフ</th><th>操作</th><th>内容</th></tr></thead><tbody>' +
      (rows.map((r) => '<tr><td class="nowrap">' + esc(new Date(r.at).toLocaleString('ja-JP')) + '</td><td>' + esc(r.who) + '</td><td>' + esc(r.staffName) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.detail) + '</td></tr>').join('') || '<tr><td colspan="5" class="muted">履歴はありません</td></tr>') + '</tbody></table></div></section>';
  }

  // ---------- スタッフ用の画面（自分の分を見るだけ） ----------
  function staffManualHTML() {
    const d = (t, b, o) => '<details' + (o ? ' open' : '') + '><summary>' + t + '</summary><div class="manual-body">' + b + '</div></details>';
    return '<section class="card manual"><h2>使い方</h2>' +
      d('この画面でわかること', '<ul><li>いま使える有給の日数（「7日3時間」のように、日と時間で出ます）</li><li>次にいつ、何日もらえるか</li><li>使わないと消えてしまう分と、その日付</li><li>これまでに取った日の一覧</li></ul><p>この画面は<strong>見るだけ</strong>です。有給を取りたいとき・記録が違うときは、管理者に伝えてください。</p>', true) +
      d('有給が消えるのはいつ？', '<p>有給は、もらった日から<strong>2年</strong>たつと使えなくなります。「使うと消える分」に、消える日が出ます。古い分から先に使われるので、取るときは自動で古い分から減ります。</p>') +
      d('「年5日」とは？', '<p>1年に10日以上もらう人は、法律で<strong>年5日は有給を取る</strong>決まりです。画面に「あと◯日」と出たら、期限までに取ってください。1日休みは1日、半休は0.5日として数えます。1時間ごとの有給（時間単位）は、この5日には入りません。</p>') +
      d('時間単位って？', '<p>1時間ごとに取れる有給です。あなたの「1日分」は、所定労働時間（例：8時間）で数えます。年に5日分までです。</p>') +
      d('見方がわからないとき', '<p>名前を選び間違えていないか確認してください。数字が違うと思ったら、管理者に聞いてください。</p>') + '</section>';
  }

  function viewStaffSelf() {
    const list = activeStaff().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (!staffById(state.me)) state.me = '';
    const opts = '<option value="">選んでください</option>' + list.map((x) => '<option value="' + x.id + '"' + (x.id === state.me ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    const picker = '<section class="card"><label class="f">あなたの名前を選んでください<select data-me="1">' + opts + '</select></label></section>';
    const s = staffById(state.me);
    if (!s) return picker + (list.length ? '' : '<section class="card"><p class="muted">まだスタッフが登録されていません。管理者画面から登録してください。</p></section>') + staffManualHTML();
    const a = analysis(s), H = a.H;
    const stat = (k, v, cls) => '<div class="stat ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
    if (!a.hasGrant) return picker + '<section class="card"><h2>' + esc(s.name) + 'さん</h2><p>まだ有給は付与されていません。最初の付与日は <strong>' + fd(s.firstGrantDate) + '</strong> です。</p></section>' + staffManualHTML();

    let notes = '';
    if (a.expiringSoon.length) notes += '<div class="alert danger"><strong>もうすぐ消える有給があります</strong><ul>' + a.expiringSoon.map((g) => '<li>' + bal(g.unused, H) + '：' + fd(lastDay(g.expire)) + ' までに使ってください</li>').join('') + '</ul></div>';
    const o = a.obligation;
    if (o.state === 'open') notes += '<div class="alert ' + (o.level === 'danger' ? 'danger' : o.level === 'warn' ? 'warn' : 'info') + '"><strong>今年は、あと ' + round1(o.short) + ' 日分、有給を取る必要があります</strong>（' + fd(o.end) + ' まで。いま ' + round1(o.done) + ' 日取得済み）</div>';
    else if (o.state === 'ok') notes += '<div class="alert info">今年の「年5日」の取得は、達成しています。</div>';
    if (a.pending.length) notes += '<div class="alert warn">付与の確認中のものがあります。くわしくは管理者に聞いてください。</div>';

    const rp = new Map(Y.replay(s, TODAY).grants.map((g) => [g.id, g]));
    const gtr = (s.grants || []).filter((g) => g.status === 'granted' && g.date <= TODAY).sort((x, y) => y.date.localeCompare(x.date)).map((g) => {
      const r = rp.get(g.id);
      return '<tr><td>' + fd(g.date) + '</td><td>' + g.days + '日</td><td>' + fd(lastDay(Y.expireOf(g))) + 'まで</td><td>' + (r ? bal(r.used, H) : '—') + '</td><td>' + (r && r.expired > 1e-6 ? '消えた ' + bal(r.expired, H) : '<strong>' + (r ? bal(r.remaining, H) : '—') + '</strong>') + '</td></tr>';
    }).join('');
    const utr = (s.usages || []).filter((u) => u.status === 'active').sort((x, y) => y.date.localeCompare(x.date)).slice(0, 30).map((u) =>
      '<tr><td>' + fd(u.date) + (u.date > TODAY ? ' <span class="tag info">予定</span>' : '') + '</td><td>' + Y.KIND_LABEL[u.kind] + (u.kind === 'hour' ? '（' + u.hours + '時間）' : '') + '</td></tr>').join('');
    return picker + notes +
      '<section class="card"><h2 style="margin-top:0">' + esc(s.name) + ' さんの有給</h2><div class="stats">' +
      stat('いま使える有給', bal(a.remaining, H), 'big') + stat('前年からの繰越', bal(a.carry, H)) + stat('今年度にもらった分', a.granted + '日') +
      stat('取った日数（1日・半日）', round1(a.usedDays) + '日') + stat('取った時間数（時間単位）', a.usedHours + '時間') + stat('消えた日数', bal(a.expiredDays, H)) +
      stat('次にもらえる日', a.next ? fd(a.next.date) : '—') + stat('次にもらえる日数', a.next ? (a.next.days === null ? '確認中' : a.next.days + '日（見込）') : '—') + '</div>' +
      (a.expiring ? '<p class="hint">次に消える分：' + bal(a.expiring.days, H) + '（' + fd(lastDay(a.expiring.date)) + ' まで使えます）</p>' : '') + '</section>' +
      '<section class="card"><h2 style="margin-top:0">もらった有給の内訳</h2><div class="tablewrap"><table><thead><tr><th>もらった日</th><th>日数</th><th>使える期限</th><th>使った分</th><th>残り</th></tr></thead><tbody>' + gtr + '</tbody></table></div></section>' +
      '<section class="card"><h2 style="margin-top:0">取った日の一覧</h2>' + (utr ? '<div class="tablewrap"><table><thead><tr><th>日付</th><th>区分</th></tr></thead><tbody>' + utr + '</tbody></table></div>' : '<p class="muted">まだ取った記録はありません。</p>') + '</section>' +
      staffManualHTML();
  }

  // ---------- 取扱説明書 ----------
  function manualHTML() {
    const d = (title, body, open) => '<details' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="manual-body">' + body + '</div></details>';
    return '<section class="card manual"><h2>取扱説明書（はじめての方へ）</h2>' +
      '<p>このアプリは、スタッフ全員の有給休暇を「いつ付与されて、いつ使って、いつ消えるか」まで自動で計算します。<strong>入力するのは、スタッフの情報と、有給を取った日だけ</strong>です。気になる項目をタップすると開きます。</p>' +
      d('① 使い始めの流れ（まずここから）',
        '<ol><li>上のメニュー「<strong>スタッフ</strong>」→「＋新しく登録」で、スタッフの情報を入れて保存します。</li>' +
        '<li>保存すると、付与日が来ている分の有給が<strong>自動で付与</strong>されます（何もしなくて大丈夫です）。</li>' +
        '<li>有給を取った（取る）ときは、メニュー「<strong>取得入力</strong>」で、スタッフ・日付・区分を選んで保存します。</li>' +
        '<li>メニュー「<strong>一覧</strong>」で、全員の残り日数・失効・年5日の状況を確認します。</li>' +
        '<li>ときどき、下の「バックアップ」でデータをファイルに保存します。</li></ol>', true) +
      d('② スタッフの登録のしかた',
        '<ul><li><strong>入社日</strong>：実際に入社した日です。</li>' +
        '<li><strong>有給初回付与日</strong>：最初に有給を付与する日です。ふつうは入社日の6か月後なので、「入社日＋6か月を入れる」ボタンを押せば入ります。会社で付与日をそろえている（例：毎年4月1日）ときは、その日を入れます。以後は1年ごとに自動で付与されます。</li>' +
        '<li><strong>勤務条件</strong>：付与される日数を決める大事な欄です。<br>・正社員やフルタイム：週5日・週40時間などを入れます。<br>・パート：<strong>週所定労働日数</strong>（週に何日働くか）と<strong>週所定労働時間</strong>を入れます。日数の決まりが週ごとにバラバラな場合は「年間所定労働日数」を入れます。<br>・週30時間以上、または週5日以上なら「通常」の日数、それより少ない人は、働く日数に応じて自動で「比例」した日数になります。</li>' +
        '<li><strong>1日の所定労働時間</strong>：時間単位で有給を取るときの「1日分」の計算に使います。「開始・終了・休憩から計算」ボタンで入ります。</li>' +
        '<li><strong>勤務日数や時間が変わったとき</strong>：「情報を編集」で数字を直し、<strong>「条件の変更日」</strong>を入れて保存します。昔の条件は履歴に残り、過去の付与は変わりません。</li>' +
        '<li><strong>休職・退職</strong>：在籍状況を変えます。退職の場合は退職日も入れます。退職した人の記録も消えずに残ります（一覧で「退職者」を選ぶと見られます）。</li></ul>') +
      d('③ 有給を取ったとき（取得入力）',
        '<ol><li>スタッフ名を選ぶ。</li><li>取得日を選ぶ。</li><li>区分を選ぶ。<br>・<strong>1日</strong>：丸1日休み（1日分）<br>・<strong>午前半休／午後半休</strong>：半日休み（0.5日分）<br>・<strong>時間単位</strong>：1時間単位。「1時間」「2時間」のように整数で入れます（30分単位はできません）。</li><li>「保存」を押すと、残りの日数が自動で更新されます。</li></ol>' +
        '<p class="hint">時間単位は、年に5日分までです（会社が「労使協定」を結んでいる場合のみ）。協定がない場合は、下の「ルールの設定」でチェックを外してください。<br>残りが足りないときや、同じ日に二重で入れたときは、保存できずに理由が出ます。</p>') +
      d('④ 入力を間違えたとき',
        '<ul><li>スタッフの画面（一覧から名前を押す）→「取得履歴」で、間違えた行の<strong>「修正」</strong>または<strong>「取消」</strong>を押します。</li>' +
        '<li>「修正」：日付や区分を直して保存し直します。「取消」：その取得をなかったことにして、残りを元に戻します。</li>' +
        '<li>どちらも、<strong>元の記録は消えずに残り</strong>、「修正履歴」に「いつ・何を」変えたかが記録されます。</li></ul>') +
      d('⑤ 画面の見方',
        '<ul><li><strong>残有給</strong>：いま使える日数です。「7日3時間」のように、日と時間で出ます。</li>' +
        '<li><strong>次回付与日</strong>：次に有給が増える日と、増える日数の見込みです。</li>' +
        '<li><strong>失効予定</strong>：使わないと消えてしまう日数と日付です。有給は付与から<strong>2年</strong>で時効になります。<span class="tag danger">赤</span>は30日以内に消えます。</li>' +
        '<li><strong>年5日義務</strong>：年10日以上もらう人は、会社が年5日は取らせる義務があります。「残2日」のように不足が出て、期限が近いと<span class="tag warn">黄</span>・<span class="tag danger">赤</span>になります。1日は1日、半休は0.5日として数え、<strong>時間単位は数えません</strong>。</li>' +
        '<li>有給は、<strong>古い付与分から先に使われます</strong>（消えるのが早いものから減ります）。</li></ul>') +
      d('⑥ 出勤率（8割）と付与の「保留」',
        '<p>有給は、直前1年間の出勤率が8割以上の人に付与されます。スタッフの画面の「出勤率」から、<strong>全労働日</strong>（出勤すべき日）・<strong>出勤日数</strong>・<strong>みなし出勤日数</strong>を入れます。</p>' +
        '<ul><li>みなし出勤：産前産後休業・育児休業・介護休業・仕事中のけがによる休み・<strong>有給を取った日</strong>は、出勤したものとして数えます。</li>' +
        '<li>8割未満になると、その回の付与は自動で<strong>「保留」</strong>になります。会社の判断で付与する場合は、「付与履歴」の「付与する」を押します。</li>' +
        '<li>入力しなかったときは、8割以上とみなして付与されます。</li></ul>') +
      d('⑦ 管理者以外が勝手に変更できないようにする',
        '<p>下の「管理者パスワード」を設定すると、パスワードを入れた人（管理者）だけが入力・変更できます。それ以外の人は、見るだけになります。右上の「管理者ログイン」から入ります。パスワードは忘れないようにしてください。</p>') +
      d('⑧ データの保存とバックアップ（大切です）',
        '<ul><li>データは、<strong>いま使っているこの端末のブラウザの中</strong>に保存されます。<strong>別のスマホやパソコンでは、同じデータは出ません。</strong></li>' +
        '<li>ブラウザの履歴やデータを消すと、有給のデータも消えます。下の「バックアップを保存」で、ときどきファイルに保存してください（月に1回くらいがおすすめ）。</li>' +
        '<li>消えたときや端末を替えたときは、「バックアップから戻す」でそのファイルを選ぶと元に戻ります。</li>' +
        '<li>「一覧」の「CSV出力」はExcelで開けます。スタッフの画面の「印刷用の台帳」は、紙に出力できます。</li></ul>') +
      d('⑨ 言葉の説明',
        '<ul><li><strong>付与</strong>：有給が新しく増えること。</li><li><strong>繰越</strong>：前の年に使わず残った分。</li><li><strong>失効</strong>：付与から2年たって、使えなくなること。</li>' +
        '<li><strong>比例付与</strong>：週の勤務日数が少ない人に、日数に応じて付与する決まり。</li><li><strong>時間単位年休</strong>：1時間単位で取る有給。</li><li><strong>基準日</strong>：有給が付与される日。</li></ul>') +
      d('⑩ こんなときは？',
        '<ul><li><strong>入力できない（ボタンが押せない）</strong>：管理者パスワードが設定されている場合は、右上の「管理者ログイン」から入ってください。</li>' +
        '<li><strong>データが空になった</strong>：別の端末やブラウザで開いていないか確認してください。バックアップがあれば戻せます。</li>' +
        '<li><strong>付与日数が思っていたのと違う</strong>：スタッフの画面の「付与履歴」の右端に、計算の根拠（勤続期間・通常か比例か）が出ます。勤務条件が合っているか確認してください。<br>間違っていた場合：「情報を編集」で勤務条件を直し、「入力の間違いを直す」にチェックを入れて保存 → 残高の画面に出る「まとめて計算し直す」を押すと、日数が直ります。</li>' +
        '<li><strong>法律の数字について</strong>：このアプリは、労働基準法の付与日数・2年の時効・年5日義務などに沿って計算しますが、個別の判断が必要な場合は、社会保険労務士などにご確認ください。</li></ul>') +
      '</section>';
  }

  // ---------- 設定・バックアップ ----------
  function viewSettings() {
    const st = db.settings;
    const dis = state.isAdmin ? '' : ' disabled';
    return manualHTML() + '<section class="card"><h2>ルールの設定</h2><form id="settingsform" class="grid c2">' +
      '<label class="f"><span><input type="checkbox" name="hourlyEnabled"' + (st.hourlyEnabled ? ' checked' : '') + dis + '> 時間単位年休を認める（労使協定を結んでいる）</span></label>' +
      field('時間単位年休の年間上限（日分）', 'hourCapDays', st.hourCapDays, 'number', 'min="0" max="5" step="1"' + dis) +
      field('失効の何日前に知らせるか', 'expiryWarnDays', st.expiryWarnDays, 'number', 'min="1"' + dis) +
      field('年5日義務の期限の何日前に注意するか', 'obligationWarnDays', st.obligationWarnDays, 'number', 'min="1"' + dis) +
      '<div><button class="btn primary" type="submit"' + dis + '>保存</button></div></form><p class="hint">時間単位年休は、法律で年5日分までです。労使協定を結んでいない場合はチェックを外してください。</p></section>' +
      '<section class="card"><h2>管理者パスワード</h2><p>' + (st.adminHash ? '設定済み（ログインしていない人は、見るだけで、変更できません）' : '未設定（誰でも変更できる状態です）') + '</p>' +
      '<div class="row"><button class="btn primary" data-act="pw-set"' + dis + '>' + (st.adminHash ? 'パスワードを変更' : 'パスワードを設定') + '</button>' + (st.adminHash ? '<button class="btn" data-act="pw-clear"' + dis + '>パスワードを解除</button>' : '') + '</div>' +
      '<p class="hint">このアプリはこのパソコンのブラウザの中だけで動く簡易的な鍵です。ブラウザの開発者ツールに詳しい人なら外せるため、本格的な権限管理（スタッフ本人が見るなど）は、将来サーバー版にするときに作ります。</p></section>' +
      '<section class="card"><h2>バックアップ</h2><p>データは<strong>このブラウザの中</strong>に保存されています。ブラウザのデータを消すと失われるので、定期的にファイルに保存してください。最後のバックアップ：' + (st.lastBackup ? esc(new Date(st.lastBackup).toLocaleString('ja-JP')) : 'まだありません') + '</p>' +
      '<div class="row"><button class="btn primary" data-act="backup">バックアップを保存（JSON）</button><button class="btn" data-act="restore"' + dis + '>バックアップから戻す</button><button class="btn" data-act="csv-usage">全員の取得履歴をCSV出力</button></div>' +
      '<input type="file" id="restorefile" accept="application/json,.json" hidden></section>' +
      '<section class="card"><h2>このアプリの範囲</h2><ul class="small"><li>有給の申請・承認、スタッフ本人の確認画面、会社独自の特別休暇（年休とは別枠）の管理は、今回の版には入っていません。</li><li>計算の考え方：付与日ごとに残高を管理し、古い付与分から消化、付与日から2年後に未使用分を失効します。</li></ul></section>';
  }

  // ---------- CSV ----------
  function csv(rows) { return '﻿' + rows.map((r) => r.map((c) => { const t = String(c === null || c === undefined ? '' : c); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\r\n'); }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function csvList() {
    const rows = [['スタッフID', '氏名', '雇用区分', '在籍状況', '残有給（日・時間）', '残有給（日換算）', '次回付与日', '次回付与予定日数', '失効予定日', '失効予定（日・時間）', '年5日 義務', '年5日 取得済み', '年5日 不足']];
    db.staff.filter(matches).forEach((s) => {
      const a = analysis(s), o = a.obligation;
      rows.push([s.code, s.name, s.employment, s.status, a.hasGrant ? bal(a.remaining, a.H) : '付与前', a.hasGrant ? round1(a.remaining * 1000) / 1000 : '', a.next ? a.next.date : '', a.next && a.next.days !== null ? a.next.days : '', a.expiring ? a.expiring.date : '', a.expiring ? bal(a.expiring.days, a.H) : '', o.state === 'na' ? '対象外' : o.required, o.state === 'na' ? '' : o.done, o.state === 'na' ? '' : o.short]);
    });
    download('有給管理一覧_' + TODAY + '.csv', csv(rows));
  }
  function usageRows(s) { return (s.usages || []).slice().sort((x, y) => x.date.localeCompare(y.date)).map((u) => [s.code, s.name, u.date, Y.KIND_LABEL[u.kind], u.kind === 'hour' ? u.hours : '', u.days, u.status === 'active' ? '有効' : '取消', u.note || '', u.cancelReason || '']); }
  function csvStaff(s) {
    const a = analysis(s);
    const rp = new Map(Y.replay(s, TODAY).grants.map((g) => [g.id, g]));
    const rows = [['【付与】', '付与日', '日数', '法定日数', '状態', '使える期限', '取得済み', '失効', '残り']];
    (s.grants || []).slice().sort((x, y) => x.date.localeCompare(y.date)).forEach((g) => { const r = rp.get(g.id); rows.push(['', g.date, g.days, g.legalDays === null || g.legalDays === undefined ? '' : g.legalDays, g.status, lastDay(Y.expireOf(g)), r ? round1(r.used * 1000) / 1000 : '', r ? round1(r.expired * 1000) / 1000 : '', r ? round1(r.remaining * 1000) / 1000 : '']); });
    rows.push([], ['【取得】', 'スタッフ', '取得日', '区分', '時間数', '消費日数', '状態', 'メモ', '取消理由']);
    usageRows(s).forEach((r) => rows.push([''].concat(r.slice(1))));
    rows.push([], ['現在の残高', bal(a.remaining, a.H)]);
    download('有給台帳_' + s.name + '_' + TODAY + '.csv', csv(rows));
  }
  function csvUsage() {
    const rows = [['スタッフID', '氏名', '取得日', '区分', '時間数', '消費日数', '状態', 'メモ', '取消理由']];
    db.staff.forEach((s) => usageRows(s).forEach((r) => rows.push(r)));
    download('有給取得履歴_' + TODAY + '.csv', csv(rows));
  }

  // ---------- 操作（クリック） ----------
  const actions = {
    nav: (el) => { state.q = ''; go(el.dataset.view); },
    open: (el) => go('detail', el.dataset.id, el.dataset.tab || 'summary'),
    tab: (el) => { state.tab = el.dataset.tab; render(); },
    'mode-staff': () => { state.mode = 'staff'; localStorage.setItem('yukyu_mode', 'staff'); render(); window.scrollTo(0, 0); },
    'mode-admin': () => { state.mode = 'admin'; localStorage.setItem('yukyu_mode', 'admin'); render(); window.scrollTo(0, 0); },
    login, logout: () => { state.isAdmin = false; render(); },
    print: () => window.print(),
    'csv-list': csvList, 'csv-usage': csvUsage,
    'csv-staff': (el) => csvStaff(staffById(el.dataset.id)),
    ledger: (el) => go('ledger', el.dataset.id),
    'staff-new': () => go('form'), 'staff-edit': (el) => go('form', el.dataset.id),
    'fill-first': () => { const f = document.getElementById('staffform'); if (f.hireDate.value) f.firstGrantDate.value = Y.addMonths(f.hireDate.value, 6); else toast('先に入社日を入れてください', true); },
    'fill-daily': () => {
      const f = document.getElementById('staffform');
      const m = Y.halfDaySchedule({ start: f.start.value, end: f.end.value, breakMin: f.breakMin.value });
      if (m) f.dailyHours.value = m.netHours; else toast('勤務開始・終了を入れてください', true);
    },
    'entry-reset': () => { state.entry = { staffId: state.entry.staffId, date: TODAY, kind: 'day', hours: '', note: '', editId: null }; state.entryError = ''; render(); },
    'entry-for': (el) => { state.entry = { staffId: el.dataset.id, date: TODAY, kind: 'day', hours: '', note: '', editId: null }; go('entry'); },
    'entry-save': entrySave, 'usage-edit': usageEdit, 'usage-cancel': usageCancel,
    'grant-add': grantAdd, 'grant-recalc': grantRecalc, 'grant-recalc-all': grantRecalcAll, 'grant-days': grantDays, 'grant-expire': grantExpire, 'grant-void': grantVoid, 'grant-reeval': grantReeval, 'grant-force': grantForce,
    'att-edit': attEdit, 'obl-edit': oblEdit,
    'pw-set': pwSet, 'pw-clear': pwClear, backup, restore: () => document.getElementById('restorefile').click(),
  };

  function commit(msg) { if (save()) { render(); if (msg) toast(msg); } }

  async function entrySave() {
    if (!requireAdmin()) return;
    const e = state.entry, s = staffById(e.staffId);
    if (!s) { state.entryError = 'スタッフを選んでください'; return render(); }
    const r = Y.checkUsage(s, e, TODAY, db.settings, e.editId || undefined);
    if (!r.ok) { state.entryError = r.error; return render(); }
    if (e.editId) {
      const old = s.usages.find((u) => u.id === e.editId);
      old.status = 'cancelled'; old.cancelledAt = new Date().toISOString(); old.cancelReason = '修正'; old.replacedBy = r.usage.id;
      log('取得の修正', s, fd(old.date) + ' ' + Y.KIND_LABEL[old.kind] + ' → ' + fd(r.usage.date) + ' ' + Y.KIND_LABEL[r.usage.kind]);
    } else {
      log('取得の入力', s, fd(r.usage.date) + ' ' + Y.KIND_LABEL[r.usage.kind] + (r.usage.kind === 'hour' ? '（' + r.usage.hours + '時間）' : '') + (r.usage.note ? '／' + r.usage.note : ''));
    }
    s.usages.push(r.usage);
    state.entry = { staffId: s.id, date: e.date, kind: 'day', hours: '', note: '', editId: null }; state.entryError = '';
    commit('保存しました。残高：' + bal(Y.analyze(s, TODAY, db.settings).remaining, Y.analyze(s, TODAY, db.settings).H));
  }
  function usageEdit(el) {
    if (!requireAdmin()) return;
    const u = staffById(el.dataset.sid).usages.find((x) => x.id === el.dataset.id);
    state.entry = { staffId: el.dataset.sid, date: u.date, kind: u.kind, hours: u.hours || '', note: u.note || '', editId: u.id };
    go('entry');
  }
  async function usageCancel(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), u = s.usages.find((x) => x.id === el.dataset.id);
    const r = await openDialog({ title: '取得を取り消す', html: '<p>' + fd(u.date) + ' ' + Y.KIND_LABEL[u.kind] + (u.kind === 'hour' ? '（' + u.hours + '時間）' : '') + ' を取り消します。残高は元に戻り、記録は履歴に残ります。</p>' + field('取消の理由（任意）', 'reason', ''), ok: '取り消す', danger: true });
    if (!r) return;
    u.status = 'cancelled'; u.cancelledAt = new Date().toISOString(); u.cancelReason = r.reason || '入力ミス';
    log('取得の取消', s, fd(u.date) + ' ' + Y.KIND_LABEL[u.kind] + '／理由：' + u.cancelReason);
    commit('取り消しました');
  }

  async function grantAdd(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid);
    const r = await openDialog({
      title: '手動で付与する',
      html: field('付与日', 'date', TODAY, 'date', 'required') + field('日数', 'days', '', 'number', 'step="0.5" min="0.5" required') + field('使える期限（最終日の翌日。空欄なら2年後）', 'expire', '', 'date') +
        '<label class="f">種類<select name="kind"><option value="extra">独自の付与（法定を上回る・年5日義務の対象外）</option><option value="statutory">法定の付与（定期付与の補足など）</option></select></label>' + field('理由・メモ', 'note', ''),
      validate: (d) => !d.date ? '付与日を入力してください' : !(Number(d.days) > 0) ? '日数を入力してください' : '',
    });
    if (!r) return;
    const g = { id: Y.uid(), idx: null, date: r.date, kind: r.kind, source: 'manual', legalDays: null, days: Number(r.days), basis: '', note: r.note || '', status: 'granted', pendingReason: '', expireDate: r.expire || Y.addYears(r.date, 2), obligation: { required: 5 }, createdAt: new Date().toISOString() };
    s.grants.push(g);
    log('手動付与', s, fd(g.date) + ' ' + g.days + '日（' + (g.kind === 'extra' ? '独自' : '法定') + '）／期限 ' + fd(lastDay(g.expireDate)) + '／' + g.note);
    commit('付与しました');
  }
  async function grantDays(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const r = await openDialog({ title: '付与日数を変更（' + fd(g.date) + '）', html: '<p class="hint">法定日数：' + (g.legalDays === null || g.legalDays === undefined ? '—' : g.legalDays + '日') + '。法定より多くするのは自由ですが、少なくすることはできません（法定未満は警告します）。</p>' + field('付与日数', 'days', g.days, 'number', 'step="0.5" min="0" required') + field('理由', 'reason', ''), validate: (d) => d.days === '' ? '日数を入力してください' : '' });
    if (!r) return;
    const nd = Number(r.days);
    if (g.legalDays !== null && g.legalDays !== undefined && nd < g.legalDays - 1e-9 && g.kind !== 'extra') {
      if (!(await confirmDlg('法定日数を下回ります', '法定は ' + g.legalDays + '日ですが、' + nd + '日にしようとしています。法律違反になるおそれがあります。本当に変更しますか？', '変更する', true))) return;
    }
    log('付与日数の変更', s, fd(g.date) + ' ' + g.days + '日 → ' + nd + '日／理由：' + (r.reason || '—'));
    g.days = nd; g.manualDays = g.legalDays === null || g.legalDays === undefined || nd !== g.legalDays;
    commit('変更しました');
  }
  async function grantExpire(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const r = await openDialog({ title: '使える期限を変更（' + fd(g.date) + ' の付与）', html: '<p class="hint">法定の付与は、付与日から2年で時効になります。独自の付与などで別の期限にするときだけ変えてください。</p>' + field('失効する日（この日から使えなくなる）', 'expire', Y.expireOf(g), 'date', 'required') + field('理由', 'reason', ''), validate: (d) => !d.expire ? '日付を入力してください' : '' });
    if (!r) return;
    log('期限の変更', s, fd(g.date) + ' の付与：' + fd(Y.expireOf(g)) + ' → ' + fd(r.expire) + '／理由：' + (r.reason || '—'));
    g.expireDate = r.expire;
    commit('変更しました');
  }
  async function grantVoid(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const r = await openDialog({ title: '付与を取り消す', html: '<p>' + fd(g.date) + ' の ' + g.days + '日の付与を取り消します。記録は履歴に残ります。</p>' + field('理由', 'reason', '', 'text', 'required'), ok: '取り消す', danger: true, validate: (d) => !d.reason ? '理由を入力してください' : '' });
    if (!r) return;
    g.status = 'void'; g.pendingReason = '';
    log('付与の取消', s, fd(g.date) + ' ' + g.days + '日／理由：' + r.reason);
    commit('取り消しました');
  }
  function grantReeval(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const changed = Y.reevaluateGrant(s, g);
    if (changed) log('付与の再判定', s, fd(g.date) + ' → ' + g.status);
    commit(changed ? '再判定しました：' + (g.status === 'granted' ? '付与しました' : '保留のままです') : '変わりありません（出勤率・勤務条件を入力してから再判定してください）');
  }
  async function grantForce(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const r = await openDialog({ title: '保留を解除して付与する', html: '<p class="hint">出勤率が8割未満でも、会社の判断で付与する場合に使います。</p>' + field('付与日数', 'days', g.legalDays || g.days || '', 'number', 'step="0.5" min="0" required') + field('理由', 'reason', '', 'text', 'required'), ok: '付与する', validate: (d) => !d.reason ? '理由を入力してください' : d.days === '' ? '日数を入力してください' : '' });
    if (!r) return;
    g.days = Number(r.days); g.status = 'granted'; g.forced = true; g.pendingReason = ''; g.note = '保留を解除：' + r.reason;
    log('保留の解除（強制付与）', s, fd(g.date) + ' ' + g.days + '日／理由：' + r.reason);
    commit('付与しました');
  }
  async function attEdit(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), k = Number(el.dataset.idx), cur = (s.attendance || {})[k] || {};
    const date = Y.addYears(s.firstGrantDate, k);
    const r = await openDialog({
      title: fd(date) + ' 付与の出勤率',
      html: field('全労働日（所定労働日数）', 'required', cur.required || '', 'number', 'min="1" required') + field('出勤日数', 'attended', cur.attended || 0, 'number', 'min="0" required') +
        field('みなし出勤日数（産前産後・育児・介護休業、業務上の傷病休業、年休取得日）', 'deemed', cur.deemed || 0, 'number', 'min="0"'),
      validate: (d) => !(Number(d.required) > 0) ? '全労働日を入力してください' : Number(d.attended) + Number(d.deemed || 0) > Number(d.required) ? '出勤日数とみなし出勤日数の合計が、全労働日より多くなっています' : '',
    });
    if (!r) return;
    s.attendance = s.attendance || {};
    s.attendance[k] = { required: Number(r.required), attended: Number(r.attended), deemed: Number(r.deemed || 0) };
    const j = Y.attendanceJudge(s.attendance[k]);
    log('出勤率の入力', s, fd(date) + '：' + (j.rate * 100).toFixed(1) + '%（' + (j.state === 'ok' ? '8割以上' : '8割未満') + '）');
    const g = s.grants.find((x) => x.idx === k);
    if (g && Y.reevaluateGrant(s, g)) log('付与の再判定', s, fd(g.date) + ' → ' + (g.status === 'granted' ? '付与' : '保留'));
    commit('保存しました' + (j.state === 'ng' ? '（8割未満のため、この回の付与は保留です）' : ''));
  }
  async function oblEdit(el) {
    if (!requireAdmin()) return;
    const s = staffById(el.dataset.sid), g = s.grants.find((x) => x.id === el.dataset.id);
    const p = Y.obligationPeriods(s, TODAY).find((x) => x.grantId === g.id);
    const r = await openDialog({ title: '年5日義務の期間・日数の調整', html: '<p class="hint">前倒し付与などで義務の期間が重なる・ずれるときに調整します。日数は、期間の月数÷12×5日を目安に（端数は切り上げ）入れてください。0にすると対象外になります。</p>' + field('期間の開始', 'start', p.start, 'date', 'required') + field('期間の終了', 'end', p.end, 'date', 'required') + field('義務の日数', 'required', p.required, 'number', 'step="0.5" min="0" required') + field('理由', 'reason', ''), validate: (d) => d.end < d.start ? '終了日が開始日より前です' : '' });
    if (!r) return;
    g.obligation = { required: Number(r.required), start: r.start, end: r.end };
    log('年5日義務の調整', s, fd(r.start) + '〜' + fd(r.end) + ' ' + r.required + '日／理由：' + (r.reason || '—'));
    commit('保存しました');
  }

  async function pwSet() {
    if (!requireAdmin()) return;
    const r = await openDialog({ title: '管理者パスワードの設定', html: field('新しいパスワード（4文字以上）', 'pw', '', 'password', 'autocomplete="new-password"') + field('もう一度', 'pw2', '', 'password', 'autocomplete="new-password"'), validate: (d) => d.pw.length < 4 ? '4文字以上にしてください' : d.pw !== d.pw2 ? '2回の入力が違います' : '' });
    if (!r) return;
    db.settings.adminHash = await hashPw(r.pw); state.isAdmin = true;
    log('管理者パスワードの設定', null, ''); commit('設定しました。忘れないようにしてください');
  }
  async function pwClear() {
    if (!requireAdmin()) return;
    if (!(await confirmDlg('パスワードの解除', '解除すると、誰でも残高を変更できる状態になります。よろしいですか？', '解除する', true))) return;
    db.settings.adminHash = ''; log('管理者パスワードの解除', null, ''); commit('解除しました');
  }
  function backup() {
    db.settings.lastBackup = new Date().toISOString(); save();
    download('有給管理_バックアップ_' + TODAY + '.json', JSON.stringify(db, null, 2), 'application/json');
    render(); toast('バックアップを保存しました。安全な場所（Dropbox など）に置いてください');
  }

  // ---------- イベント ----------
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    ev.preventDefault();
    const fn = actions[el.dataset.act];
    if (fn) Promise.resolve(fn(el)).catch((e) => { console.error(e); toast('エラー：' + e.message, true); });
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'staffform') { ev.preventDefault(); submitStaffForm(ev.target).catch((e) => toast('エラー：' + e.message, true)); }
    if (ev.target.id === 'settingsform') {
      ev.preventDefault();
      if (!requireAdmin()) return;
      const f = Object.fromEntries(new FormData(ev.target));
      db.settings.hourlyEnabled = !!f.hourlyEnabled;
      db.settings.hourCapDays = Math.min(5, Math.max(0, Number(f.hourCapDays) || 0));
      db.settings.expiryWarnDays = Math.max(1, Number(f.expiryWarnDays) || 30);
      db.settings.obligationWarnDays = Math.max(1, Number(f.obligationWarnDays) || 90);
      log('設定の変更', null, '時間単位年休：' + (db.settings.hourlyEnabled ? '認める（年' + db.settings.hourCapDays + '日分）' : '認めない'));
      commit('保存しました');
    }
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.form && el.form.id === 'staffform') updatePreview(el.form);
    if (el.dataset.live) {
      state[el.dataset.live] = el.value; render();
      const n = document.getElementById(el.id); if (n) { n.focus(); if (n.setSelectionRange && n.type !== 'select-one') n.setSelectionRange(n.value.length, n.value.length); }
    } else if (el.dataset.entry && el.dataset.nore) state.entry[el.dataset.entry] = el.value;
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.form && el.form.id === 'staffform') updatePreview(el.form);
    if (el.dataset.live) return;
    if (el.dataset.me) { state.me = el.value; localStorage.setItem('yukyu_me', el.value); render(); return; }
    if (el.dataset.entry) { state.entry[el.dataset.entry] = el.value; state.entryError = ''; if (!el.dataset.nore) render(); }
    if (el.id === 'restorefile' && el.files[0]) {
      const file = el.files[0];
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const d = JSON.parse(rd.result);
          if (!Array.isArray(d.staff)) throw new Error('有給管理のバックアップではありません');
          if (!(await confirmDlg('バックアップから戻す', 'いまのデータを、ファイルの内容（スタッフ ' + d.staff.length + '人）に入れ替えます。いまのデータは念のため別名で残します。よろしいですか？', '戻す', true))) return;
          localStorage.setItem(KEY + '_before_restore_' + Date.now(), JSON.stringify(db));
          db = Object.assign(defaultDB(), d, { settings: Object.assign(defaultDB().settings, d.settings || {}) });
          state.isAdmin = !db.settings.adminHash; log('バックアップから復元', null, file.name);
          commit('戻しました');
        } catch (e) { toast('戻せませんでした：' + e.message, true); }
      };
      rd.readAsText(file);
    }
  });

  // ---------- 起動：今日までに来ている定期付与を作る ----------
  db.staff.forEach((s) => { Y.processGrants(s, TODAY).forEach((g) => log('自動付与', s, fd(g.date) + ' ' + g.days + '日（' + (g.status === 'granted' ? '付与' : '保留') + '）')); });
  save();
  render();
  window.__yukyu = { get db() { return db; }, state, render, go };
})();
