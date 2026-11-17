// 有給休暇の計算エンジン（画面に依存しない。ブラウザでも Node でも動く）
// 日付はすべて "YYYY-MM-DD" の文字列で扱う（タイムゾーンのずれを避けるため UTC で計算）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Yukyu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;

  // 労働基準法 第39条：通常の労働者（週5日以上、または週30時間以上）
  const REGULAR_TABLE = [10, 11, 12, 14, 16, 18, 20];
  // 比例付与（週30時間未満かつ週4日以下）：週所定労働日数ごと
  const PROPORTIONAL_TABLE = {
    4: [7, 8, 9, 10, 12, 13, 15],
    3: [5, 6, 6, 8, 9, 10, 11],
    2: [3, 4, 4, 5, 6, 6, 7],
    1: [1, 2, 2, 2, 3, 3, 3],
  };
  // 継続勤務期間（か月）：6か月、1年6か月、…、6年6か月
  const TENURE_MONTHS = [6, 18, 30, 42, 54, 66, 78];
  const TENURE_LABELS = ['6か月', '1年6か月', '2年6か月', '3年6か月', '4年6か月', '5年6か月', '6年6か月以上'];

  // ---------- 日付 ----------
  const pad = (n) => String(n).padStart(2, '0');
  function parseDate(s) {
    const p = String(s).split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }
  function toISO(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMonths(iso, n) {
    const { y, m, d } = parseDate(iso);
    const t = y * 12 + (m - 1) + n;
    const ny = Math.floor(t / 12);
    const nm = (t % 12) + 1;
    return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  function addYears(iso, n) { return addMonths(iso, n * 12); }
  function addDays(iso, n) {
    const { y, m, d } = parseDate(iso);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function diffDays(a, b) {
    const A = parseDate(a), B = parseDate(b);
    return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
  }
  // a から b までの満月数（月末同士は繰り上げて数える）
  function monthsBetween(a, b) {
    const A = parseDate(a), B = parseDate(b);
    let m = (B.y - A.y) * 12 + (B.m - A.m);
    if (B.d < A.d && B.d !== daysInMonth(B.y, B.m)) m--;
    return m;
  }

  // ---------- 勤務条件 ----------
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // 指定日に有効な勤務条件（変更履歴から選ぶ）
  function conditionAt(staff, date) {
    const cs = (staff.conditions || []).slice().sort((a, b) => a.from.localeCompare(b.from));
    let c = null;
    for (const x of cs) if (x.from <= date) c = x;
    return c || cs[0] || null;
  }

  // 通常付与か比例付与かの判定
  function classify(cond, employment) {
    if (!cond) return { type: 'unknown', reason: '勤務条件が未登録' };
    const wh = num(cond.weeklyHours), wd = num(cond.weeklyDays), ad = num(cond.annualDays);
    if (wh !== null && wh >= 30) return { type: 'regular', reason: '週所定労働時間が30時間以上' };
    if (wd !== null && wd >= 5) return { type: 'regular', reason: '週所定労働日数が5日以上' };
    if (wd !== null) {
      if (wd < 1) return { type: 'none', band: null, reason: '週所定労働日数が1日未満' };
      const band = Math.min(4, Math.floor(wd + EPS));
      return { type: 'proportional', band, reason: '週所定労働日数 ' + band + '日（週30時間未満）' };
    }
    if (ad !== null) {
      if (ad >= 217) return { type: 'regular', reason: '年間所定労働日数が217日以上' };
      if (ad >= 169) return { type: 'proportional', band: 4, reason: '年間所定労働日数 ' + ad + '日（週4日相当）' };
      if (ad >= 121) return { type: 'proportional', band: 3, reason: '年間所定労働日数 ' + ad + '日（週3日相当）' };
      if (ad >= 73) return { type: 'proportional', band: 2, reason: '年間所定労働日数 ' + ad + '日（週2日相当）' };
      if (ad >= 48) return { type: 'proportional', band: 1, reason: '年間所定労働日数 ' + ad + '日（週1日相当）' };
      return { type: 'none', band: null, reason: '年間所定労働日数が48日未満' };
    }
    if (employment === '正社員') return { type: 'regular', reason: '正社員（日数・時間の入力なし）' };
    return { type: 'unknown', reason: '週所定労働日数・年間所定労働日数・週所定労働時間のいずれも未入力' };
  }

  // 時間単位年休で「1日分」とみなす時間数（所定労働時間の端数は切り上げ）
  function hourUnit(cond) {
    if (!cond) return null;
    let h = num(cond.dailyHours);
    if (h === null) {
      const wh = num(cond.weeklyHours), wd = num(cond.weeklyDays);
      if (wh !== null && wd) h = wh / wd;
    }
    return h === null || h <= 0 ? null : Math.ceil(h - EPS);
  }

  // ---------- 法定付与日数 ----------
  function tenureIndex(months) {
    let t = -1;
    TENURE_MONTHS.forEach((m, i) => { if (months >= m) t = i; });
    return t;
  }

  // k 回目（0 始まり）の付与日に、法律上最低限付与すべき日数
  function legalGrantDays(staff, idx, grantDate) {
    const cond = conditionAt(staff, grantDate);
    if (!cond) return { days: null, basis: '勤務条件が未登録' };
    const cls = classify(cond, staff.employment);
    if (cls.type === 'unknown') return { days: null, basis: cls.reason };
    const months = staff.hireDate ? monthsBetween(staff.hireDate, grantDate) : 0;
    // 付与回数（前倒し付与でも不足しないよう、入社日からの勤続月数との大きいほうを使う）
    const i = Math.min(Math.max(idx, tenureIndex(months), 0), 6);
    const tenureText = '継続勤務 ' + TENURE_LABELS[i];
    if (cls.type === 'none') return { days: 0, basis: cls.reason + '（法定付与なし）', idx: i };
    if (cls.type === 'regular') {
      return { days: REGULAR_TABLE[i], basis: tenureText + '／通常付与（' + cls.reason + '）', idx: i };
    }
    return {
      days: PROPORTIONAL_TABLE[cls.band][i],
      basis: tenureText + '／比例付与（' + cls.reason + '）',
      idx: i,
    };
  }

  // 出勤率の判定（8割以上）。入力が無いときは unknown（8割以上とみなして付与）
  function attendanceJudge(att) {
    if (!att || num(att.required) === null || num(att.required) <= 0) return { state: 'unknown', rate: null };
    const required = Number(att.required);
    const present = (num(att.attended) || 0) + (num(att.deemed) || 0);
    const rate = present / required;
    return { state: present * 10 >= required * 8 ? 'ok' : 'ng', rate };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function expireOf(g) { return g.expireDate || addYears(g.date, 2); }

  // 定期付与（スケジュール）の 1 件を作る
  function buildScheduledGrant(staff, idx, date) {
    const legal = legalGrantDays(staff, idx, date);
    const att = attendanceJudge((staff.attendance || {})[idx]);
    const g = {
      id: uid(), idx, date, kind: 'statutory', source: 'auto',
      legalDays: legal.days, days: legal.days === null ? 0 : legal.days,
      basis: legal.basis, status: 'granted', pendingReason: '',
      expireDate: addYears(date, 2), obligation: { required: 5 },
      createdAt: new Date().toISOString(),
    };
    if (legal.days === null) { g.status = 'pending'; g.pendingReason = 'conditions'; }
    else if (att.state === 'ng') { g.status = 'pending'; g.pendingReason = 'attendance'; }
    return g;
  }

  // 今日までに来ている定期付与を、まだ作っていなければ作る（作った付与を返す）
  function processGrants(staff, today) {
    const created = [];
    staff.grants = staff.grants || [];
    if (!staff.firstGrantDate) return created;
    const have = new Set(staff.grants.filter((g) => g.idx !== null && g.idx !== undefined).map((g) => g.idx));
    for (let k = 0; k < 60; k++) {
      const date = addYears(staff.firstGrantDate, k);
      if (date > today) break;
      if (staff.status === '退職' && staff.retireDate && date > staff.retireDate) break;
      if (have.has(k)) continue;
      const g = buildScheduledGrant(staff, k, date);
      staff.grants.push(g);
      created.push(g);
    }
    return created;
  }

  // 出勤率・勤務条件を入れ直したあとの再判定（手動で強制付与したものは触らない）
  function reevaluateGrant(staff, g) {
    if (g.source !== 'auto' || g.forced || g.status === 'void' || g.idx === null || g.idx === undefined) return false;
    const legal = legalGrantDays(staff, g.idx, g.date);
    const att = attendanceJudge((staff.attendance || {})[g.idx]);
    const before = JSON.stringify([g.status, g.days, g.legalDays, g.pendingReason]);
    g.legalDays = legal.days;
    g.basis = legal.basis;
    if (!g.manualDays) g.days = legal.days === null ? 0 : legal.days;
    if (legal.days === null) { g.status = 'pending'; g.pendingReason = 'conditions'; }
    else if (att.state === 'ng') { g.status = 'pending'; g.pendingReason = 'attendance'; }
    else { g.status = 'granted'; g.pendingReason = ''; }
    return before !== JSON.stringify([g.status, g.days, g.legalDays, g.pendingReason]);
  }

  // ---------- 残高の計算（付与ごとに管理、古い付与分から消化） ----------
  // asOf まで（opts.all のときは未来日の取得も含めて）取得を順に割り当てる
  function replay(staff, asOf, opts) {
    const all = !!(opts && opts.all);
    const grants = (staff.grants || [])
      .filter((g) => g.status === 'granted' && Number(g.days) > 0)
      .map((g) => ({
        id: g.id, idx: g.idx, date: g.date, expire: expireOf(g), days: Number(g.days),
        kind: g.kind || 'statutory', used: 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.expire.localeCompare(b.expire));
    const usages = (staff.usages || [])
      .filter((u) => u.status === 'active' && (all || u.date <= asOf))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
    const shortages = [];
    const allocations = [];
    for (const u of usages) {
      let need = Number(u.days);
      for (const g of grants) {
        if (need <= EPS) break;
        if (g.date <= u.date && u.date < g.expire) {
          const avail = g.days - g.used;
          if (avail > EPS) {
            const take = Math.min(avail, need);
            g.used += take;
            need -= take;
            allocations.push({ usageId: u.id, grantId: g.id, amount: take });
          }
        }
      }
      if (need > EPS) shortages.push({ usageId: u.id, date: u.date, short: need });
    }
    for (const g of grants) {
      const started = g.date <= asOf;
      const expired = started && g.expire <= asOf;
      g.unused = Math.max(0, g.days - g.used);
      g.expired = expired ? g.unused : 0;
      g.remaining = started && !expired ? g.unused : 0;
    }
    return { grants, shortages, allocations };
  }

  const sum = (arr) => arr.reduce((s, x) => s + x, 0);

  // 取得 1 件が消費する日数
  function usageDays(kind, hours, H) {
    if (kind === 'day') return 1;
    if (kind === 'am' || kind === 'pm') return 0.5;
    return hours / H;
  }

  // 日数（小数）を「◯日◯時間」に直す
  function formatBalance(r, H) {
    if (r < EPS) return '0日';
    const hh = H || 8;
    let d = Math.floor(r + EPS);
    let hrs = Math.round((r - d) * hh * 10) / 10;
    if (hrs >= hh - EPS) { d += 1; hrs = 0; }
    return (d > 0 || hrs === 0 ? d + '日' : '') + (hrs > 0 ? hrs + '時間' : '');
  }

  // ---------- 年5日の取得義務 ----------
  function obligationPeriods(staff, today) {
    const list = [];
    for (const g of staff.grants || []) {
      // 法定付与が10日以上のものだけが対象（独自の上乗せ付与は対象外）。法定日数を上回って付与していても判定は法定日数
      const legalBasis = g.kind === 'extra' ? 0 : (g.legalDays !== null && g.legalDays !== undefined ? Number(g.legalDays) : Number(g.days));
      if (g.status !== 'granted' || legalBasis < 10) continue;
      const ob = g.obligation || {};
      if (ob.required === 0) continue;
      const start = ob.start || g.date;
      const end = ob.end || addDays(addYears(g.date, 1), -1);
      const required = ob.required === undefined || ob.required === null ? 5 : Number(ob.required);
      let done = 0, planned = 0;
      for (const u of staff.usages || []) {
        if (u.status !== 'active' || u.kind === 'hour') continue; // 時間単位年休は義務に算入しない
        if (u.date < start || u.date > end) continue;
        if (u.date <= today) done += Number(u.days); else planned += Number(u.days);
      }
      const short = Math.max(0, required - done);
      list.push({
        grantId: g.id, grantDate: g.date, start, end, required, done, planned, short,
        shortAfterPlan: Math.max(0, required - done - planned),
        daysLeft: diffDays(today, end),
        state: short <= EPS ? 'ok' : end < today ? 'failed' : 'open',
      });
    }
    return list.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---------- スタッフ 1 人の集計 ----------
  function analyze(staff, today, settings) {
    const st = settings || {};
    const warnDays = st.expiryWarnDays !== undefined ? st.expiryWarnDays : 30;
    const oblWarn = st.obligationWarnDays !== undefined ? st.obligationWarnDays : 90;
    const cond = conditionAt(staff, today);
    const H = cond ? hourUnit(cond) : null;
    const now = replay(staff, today);
    const fut = replay(staff, today, { all: true });
    const live = now.grants.filter((g) => g.date <= today);
    const out = {
      cond, H, hasGrant: live.length > 0,
      remaining: sum(live.map((g) => g.remaining)),
      pending: (staff.grants || []).filter((g) => g.status === 'pending'),
      shortages: fut.shortages,
      carry: 0, granted: 0, usedDays: 0, usedHourDays: 0, usedHours: 0, expiredDays: 0,
      periodStart: null, periodEnd: null,
      next: null, expiring: null, expiringSoon: [], obligation: { state: 'na' }, obligations: [],
    };

    if (live.length) {
      const ps = live.reduce((m, g) => (g.date > m ? g.date : m), live[0].date);
      out.periodStart = ps;
      out.periodEnd = addDays(addYears(ps, 1), -1);
      out.granted = sum(live.filter((g) => g.date === ps).map((g) => g.days));
      out.carry = sum(replay(staff, addDays(ps, -1)).grants.filter((g) => g.date <= addDays(ps, -1)).map((g) => g.remaining));
      for (const u of staff.usages || []) {
        if (u.status !== 'active' || u.date < ps || u.date > today) continue;
        if (u.kind === 'hour') { out.usedHourDays += Number(u.days); out.usedHours += Number(u.hours); }
        else out.usedDays += Number(u.days);
      }
      out.expiredDays = sum(now.grants.filter((g) => g.expire >= ps && g.expire <= today).map((g) => g.expired));
    }

    // 失効予定（これから消える未使用分。予定済みの取得は差し引いて見る）
    const upcoming = fut.grants
      .filter((g) => g.date <= today && g.expire > today && g.unused > EPS)
      .sort((a, b) => a.expire.localeCompare(b.expire));
    if (upcoming.length) out.expiring = { date: upcoming[0].expire, days: upcoming[0].unused };
    out.expiringSoon = upcoming.filter((g) => diffDays(today, g.expire) <= warnDays);

    // 次回付与
    if (staff.firstGrantDate && !(staff.status === '退職' && !staff.retireDate)) {
      for (let k = 0; k < 60; k++) {
        const date = addYears(staff.firstGrantDate, k);
        if (date <= today) continue;
        if (staff.status === '退職' && staff.retireDate && date > staff.retireDate) break;
        const legal = legalGrantDays(staff, k, date);
        out.next = { date, idx: k, days: legal.days, basis: legal.basis };
        break;
      }
    }

    // 年5日の取得義務
    out.obligations = obligationPeriods(staff, today);
    const cur = out.obligations.find((p) => p.start <= today && today <= p.end);
    if (cur) {
      out.obligation = Object.assign({}, cur, { state: cur.state === 'ok' ? 'ok' : 'open' });
      if (out.obligation.state === 'open') {
        out.obligation.level = cur.daysLeft <= 30 ? 'danger' : cur.daysLeft <= oblWarn ? 'warn' : 'normal';
      }
    }
    out.obligationFailedPast = out.obligations.filter((p) => p.state === 'failed');
    return out;
  }

  // ---------- 取得入力のチェック ----------
  const KIND_LABEL = { day: '1日', am: '午前半休', pm: '午後半休', hour: '時間単位' };

  // 検証して、問題なければ取得レコードを返す（staff は変更しない）。excludeId は修正時に差し替える元の ID
  function checkUsage(staff, input, today, settings, excludeId) {
    const st = settings || {};
    const kind = input.kind;
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: '取得日を入力してください' };
    if (!KIND_LABEL[kind]) return { ok: false, error: '取得区分を選んでください' };
    const cond = conditionAt(staff, input.date);
    const H = cond ? hourUnit(cond) : null;
    let hours = null;
    if (kind === 'hour') {
      if (st.hourlyEnabled === false) return { ok: false, error: '労使協定で時間単位年休を定めていないため、時間単位では取得できません（設定で変更できます）' };
      if (!H) return { ok: false, error: '1日の所定労働時間が未登録のため、時間単位年休を計算できません' };
      hours = Number(input.hours);
      if (!Number.isInteger(hours) || hours < 1) return { ok: false, error: '時間数は 1 以上の整数（1時間単位）で入力してください' };
      if (hours >= H) return { ok: false, error: '時間数は ' + (H - 1) + ' 時間以内です（' + H + ' 時間で 1 日分になるため、1日有給を選んでください）' };
    }
    const days = usageDays(kind, hours, H);
    const others = (staff.usages || []).filter((u) => u.status === 'active' && u.id !== excludeId);

    // 同じ日の合計が 1 日を超えない／同じ区分を二重に入れない
    const sameDay = others.filter((u) => u.date === input.date);
    if (sameDay.some((u) => u.kind === kind && kind !== 'hour')) return { ok: false, error: 'この日にはすでに「' + KIND_LABEL[kind] + '」が入っています' };
    if (sum(sameDay.map((u) => Number(u.days))) + days > 1 + EPS) return { ok: false, error: 'この日の取得が合計 1 日を超えます' };

    // 時間単位年休の年間上限（付与期間ごとに、既定は 5 日分）
    if (kind === 'hour') {
      const cap = st.hourCapDays !== undefined ? Number(st.hourCapDays) : 5;
      const g = (staff.grants || [])
        .filter((x) => x.status === 'granted' && x.date <= input.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (g) {
        const ps = g.date, pe = addDays(addYears(g.date, 1), -1);
        const used = sum(others.filter((u) => u.kind === 'hour' && u.date >= ps && u.date <= pe).map((u) => Number(u.days)));
        if (used + days > cap + 1e-9) {
          return { ok: false, error: '時間単位年休は 1 年間（' + ps + '〜' + pe + '）で ' + cap + ' 日分までです。すでに ' + formatBalance(used, H) + ' 取得しています' };
        }
      }
    }

    const usage = {
      id: uid(), date: input.date, kind, hours, days, H: kind === 'hour' ? H : null,
      status: 'active', note: input.note || '', createdAt: new Date().toISOString(),
    };

    // 残高が足りるか（その日に使える付与分から古い順に引き当てて確認）
    const base = Object.assign({}, staff, { usages: others });
    const baseShort = replay(base, today, { all: true }).shortages.length;
    const test = Object.assign({}, staff, { usages: others.concat([usage]) });
    const r = replay(test, today, { all: true });
    if (r.shortages.length > baseShort) {
      const avail = sum(replay(base, today, { all: true }).grants
        .filter((g) => g.date <= input.date && input.date < g.expire).map((g) => g.unused));
      return { ok: false, error: 'この日に使える有給の残りが足りません（この日に使えるのは ' + formatBalance(avail, H) + '）' };
    }
    return { ok: true, usage };
  }

  // ---------- 半休の勤務時間帯 ----------
  const toMin = (s) => { if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fromMin = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);

  function halfDaySchedule(cond) {
    if (!cond) return null;
    const s = toMin(cond.start), e = toMin(cond.end);
    if (s === null || e === null || e <= s) return null;
    const br = num(cond.breakMin) || 0;
    let bs = toMin(cond.breakStart);
    if (bs === null) bs = s + Math.round((e - s - br) / 2 / 30) * 30;
    const be = bs + br;
    const amWork = bs - s, pmWork = e - be;
    const note = (mins) => (mins / 60 > 6 ? '休憩の付与が必要（6時間超は45分以上）' : '法定上の休憩は不要（6時間以下）');
    return {
      amWork: fromMin(s) + '〜' + fromMin(bs), pmWork: fromMin(be) + '〜' + fromMin(e),
      breakText: br ? fromMin(bs) + '〜' + fromMin(be) : 'なし',
      amLeave: cond.amLeaveWork || (fromMin(be) + '〜' + fromMin(e)),
      pmLeave: cond.pmLeaveWork || (fromMin(s) + '〜' + fromMin(bs)),
      amLeaveHours: pmWork / 60, pmLeaveHours: amWork / 60,
      amLeaveNote: note(pmWork), pmLeaveNote: note(amWork),
      netHours: (e - s - br) / 60,
    };
  }

  return {
    EPS, REGULAR_TABLE, PROPORTIONAL_TABLE, TENURE_MONTHS, TENURE_LABELS, KIND_LABEL,
    parseDate, addMonths, addYears, addDays, diffDays, monthsBetween,
    num, conditionAt, classify, hourUnit, legalGrantDays, attendanceJudge,
    buildScheduledGrant, processGrants, reevaluateGrant, replay, usageDays, formatBalance,
    obligationPeriods, analyze, checkUsage, halfDaySchedule, expireOf, uid,
  };
});
