/**
 * MonthPlan.gs — 월 중 계획 가져오기와 보안관·당직(근무) (2026-10-22, 교사 결정)
 *
 * - 예전 '월 중 행사 및 교육계획' 엑셀·구글 시트를 읽어 일정(월별 계획)에 넣는다
 *   · 시트 모양: '< 10월 행사 및 교육계획 >' 제목 → 머리글(날짜·요일·행사·교육활동·부장회의 교직원회의·보안관(오전·오후)·당직) → 날마다 한 줄
 *   · '8,9월', '방학 중'처럼 달을 넘는 표는 날짜 숫자가 작아지면 다음 달로 본다. 달이 안 적힌 표('방학 중')는 붙어 있는 앞 달 표에 이어진다
 *   · 행사 칸 → 구분 '행사', 교육활동 칸 → '교육활동'(초등예술하나·문예체 등은 '협력 수업'), 회의 칸 → '회의'(대상 교직원). 한 칸의 여러 줄은 한 줄씩 따로 넣는다
 *   · '부장 회의 (15:00, 교장실)'처럼 끝 괄호의 시각·장소는 시간·장소 칸으로 나눈다
 *   · 같은 날 이름이 같은(또는 한쪽이 다른 쪽을 품은) 일정이 이미 있으면 넣지 않는다(학사일정의 공휴일과 겹치지 않게)
 * - 보안관(오전·오후)·당직은 '근무' 탭에 하루 한 줄로 두고 월별 계획 표에 칸으로 보인다. 관리가 고친다
 */

// ---------------------------------------------------------------- 근무(보안관·당직)

function dutyRows_() {
  try {
    return liveRows_('근무');
  } catch (e) {
    if (e && e.code === 'SETUP') return [];
    throw e;
  }
}

/** from~to 의 근무 → { 'yyyy-MM-dd': { am, pm, night } } */
function dutyBetween_(from, to) {
  var m = {};
  dutyRows_().forEach(function (r) {
    var d = r['날짜'];
    if (d && d >= from && d <= to) m[d] = { am: r['보안관 오전'], pm: r['보안관 오후'], night: r['당직'] };
  });
  return m;
}

/** args = { date, am, pm, night } (관리). 모두 비우면 그날 줄을 지운다 */
function apiDutySave_(args, actor, ctx) {
  if (!canManage_(ctx)) throw userError_('보안관·당직은 연구부장·부담당이 고쳐요.', 'FORBIDDEN');
  var date = checkYmd_(args.date, '날짜');
  var rec = { '보안관 오전': cleanText_(args.am, 30, '보안관(오전)'), '보안관 오후': cleanText_(args.pm, 30, '보안관(오후)'), '당직': cleanText_(args.night, 30, '당직') };
  ensureTab_('근무');
  ensureCols_('근무');
  return withLock_(function () {
    var cur = liveRows_('근무').filter(function (r) { return r['날짜'] === date; })[0];
    var empty = !rec['보안관 오전'] && !rec['보안관 오후'] && !rec['당직'];
    if (cur && empty) softDelete_('근무', cur['근무ID'], actor, '근무 지움: ' + date);
    else if (cur) updateRow_('근무', cur['근무ID'], rec, actor, '근무 고침: ' + date);
    else if (!empty) { rec['날짜'] = date; insertRow_('근무', rec, actor, '근무 넣음: ' + date); }
    return { done: true };
  });
}

// ---------------------------------------------------------------- 월 중 계획 읽기

function planSquash_(s) { return String(s || '').replace(/\s+/g, ''); }

/** 학년도 안에서 달의 차례(3월=0 … 2월=11) */
function planMonthOrder_(m) { return (m + 9) % 12; }

/** 한 칸의 글을 일정 이름 목록으로: 줄마다 하나, '('로 시작하는 줄은 앞줄에 잇는다 */
function planLines_(text) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (l) {
    l = l.trim();
    if (!l) return;
    if (/^\(/.test(l) && out.length) out[out.length - 1] += ' ' + l;
    else out.push(l);
  });
  return out;
}

/** '부장 회의 (15:00, 교장실)' → { title: '부장 회의', time: '15:00', place: '교장실' } */
function planSplitTitle_(t) {
  var m = t.match(/^(.*?)\s*\(\s*(\d{1,2}:\d{2}(?:\s*[~-]\s*(?:\d{1,2}:\d{2})?)?)\s*(?:,\s*([^)]*))?\)\s*$/);
  if (!m || !m[1].trim()) return { title: t, time: '', place: '' };
  return { title: m[1].trim(), time: m[2].replace(/\s+/g, ''), place: (m[3] || '').trim() };
}

/**
 * sheets = [{ name, vals }] → { blocks: [{ label, from, to, days }], events: [{ date, kind, title, time, place }], duty: [{ date, am, pm, night }] }
 */
function planParse_(sheets, schoolYear) {
  var blocks = [];
  sheets.forEach(function (sh) {
    var cur = null;
    sh.vals.forEach(function (row) {
      var cells = row.map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); });
      var t = cells.join(' ').match(/<\s*([^>]*?)\s*행\s*사\s*및\s*교\s*육\s*계\s*획\s*>/);
      if (t) {
        var months = (t[1].match(/\d{1,2}(?=\s*[월,])/g) || []).map(Number).filter(function (m) { return m >= 1 && m <= 12; });
        cur = { label: t[1].trim() || '(제목 없음)', months: months, col: null, rows: [], sheet: sh.name };
        blocks.push(cur);
        return;
      }
      if (!cur) return;
      var sq = cells.map(planSquash_);
      if (sq[0] === '날짜') { // 머리글
        var find = function (f) { for (var i = 0; i < sq.length; i++) if (f(sq[i])) return i; return -1; };
        var guard = find(function (x) { return x.indexOf('보안관') === 0; });
        cur.col = {
          event: find(function (x) { return x === '행사'; }),
          act: find(function (x) { return x === '교육활동'; }),
          meet: find(function (x) { return x.indexOf('회의') >= 0; }),
          am: guard, pm: guard >= 0 ? guard + 1 : -1,
          night: find(function (x) { return x.indexOf('당직') === 0; })
        };
        return;
      }
      if (sq[0] === '' && sq.indexOf('오전') >= 0 && cur.col) { // 보안관 아래 '오전·오후' 줄
        cur.col.am = sq.indexOf('오전');
        if (sq.indexOf('오후') >= 0) cur.col.pm = sq.indexOf('오후');
        return;
      }
      if (cur.col && /^\d{1,2}(\.0+)?$/.test(cells[0])) cur.rows.push({ day: Math.round(Number(cells[0])), cells: cells });
    });
  });

  // 달이 안 적힌 표: 붙어 있는 표 가운데 학년도 차례로 앞선 달의 표에 이어진다
  blocks.forEach(function (b, i) {
    if (b.months.length) { b.start = b.months[0]; return; }
    var near = [blocks[i - 1], blocks[i + 1]].filter(function (x) { return x && x.months.length; });
    near.sort(function (a, c) { return planMonthOrder_(a.months[a.months.length - 1]) - planMonthOrder_(c.months[c.months.length - 1]); });
    b.start = near.length ? near[0].months[near[0].months.length - 1] : 0;
  });

  var events = [], duty = [], out = [];
  var get = function (cells, i) { return i >= 0 ? cells[i] || '' : ''; };
  blocks.forEach(function (b) {
    if (!b.start || !b.rows.length) { out.push({ label: b.label, sheet: b.sheet, from: '', to: '', days: 0, skipped: true }); return; }
    var m = b.start, prev = 0, first = '', last = '';
    b.rows.forEach(function (r) {
      if (r.day < prev) m = m % 12 + 1;
      prev = r.day;
      var y = Number(schoolYear) + (m >= 3 ? 0 : 1);
      var date = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + r.day).slice(-2);
      if (!isDate_(date)) return;
      first = first || date;
      last = date;
      [['행사', b.col.event], ['교육활동', b.col.act], ['회의', b.col.meet]].forEach(function (k) {
        planLines_(get(r.cells, k[1])).forEach(function (line) {
          var p = planSplitTitle_(line);
          var kind = k[0] === '교육활동' && COOP_HINT_.test(p.title) && !COOP_NOT_.test(p.title) ? '협력 수업' : k[0]; // 초등예술하나·문예체 등
          events.push({ date: date, kind: kind, title: p.title, time: p.time, place: p.place });
        });
      });
      var am = get(r.cells, b.col.am), pm = get(r.cells, b.col.pm), night = get(r.cells, b.col.night);
      if (am || pm || night) duty.push({ date: date, am: am.replace(/\s+/g, ' '), pm: pm.replace(/\s+/g, ' '), night: night.replace(/\s+/g, ' ') });
    });
    out.push({ label: b.label, sheet: b.sheet, from: first, to: last, days: b.rows.length });
  });
  return { blocks: out, events: events, duty: duty };
}

// ---------------------------------------------------------------- 가져오기 (관리자)

function planImportPlan_(args) {
  var sheets = sheetsFromArgs_(args);
  var year = libYear_() || meetSchoolYear_(todayYmd_());
  var p = planParse_(sheets, year);
  var byDay = {};
  liveRows_('일정').forEach(function (e) {
    if (!e['시작일']) return;
    (byDay[e['시작일']] = byDay[e['시작일']] || []).push(planSquash_(e['행사명']));
  });
  var same = function (a, b) { return a === b || (a.length >= 2 && b.length >= 2 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)); };
  var seen = {};
  p.events.forEach(function (e) {
    var k = planSquash_(e.title), key = e.date + '|' + k;
    e.state = (byDay[e.date] || []).some(function (x) { return same(x, k); }) ? 'have' : seen[key] ? 'dup' : 'new';
    seen[key] = true;
  });
  var have = {};
  dutyRows_().forEach(function (r) { have[r['날짜']] = r; });
  var seenDay = {};
  p.duty.forEach(function (d) {
    var h = have[d.date];
    if (seenDay[d.date]) { d.state = 'dup'; return; } // 달을 넘는 표가 겹치는 날(예: 방학 중 끝날 = 8,9월 첫날)
    seenDay[d.date] = true;
    d.state = !h ? 'new' : (h['보안관 오전'] === d.am && h['보안관 오후'] === d.pm && h['당직'] === d.night) ? 'have' : 'change';
    if (h) d.id = h['근무ID'];
  });
  p.year = year;
  return p;
}

function adminPlanPreview_(args) {
  var p = planImportPlan_(args);
  var count = function (list, kind, state) { return list.filter(function (x) { return (!kind || x.kind === kind) && x.state === state; }).length; };
  return {
    year: p.year,
    blocks: p.blocks,
    events: { total: p.events.length, add: count(p.events, '', 'new'), have: count(p.events, '', 'have'), dup: count(p.events, '', 'dup'),
      byKind: ['행사', '교육활동', '협력 수업', '회의'].map(function (k) { return { kind: k, add: count(p.events, k, 'new') }; }) },
    duty: { total: p.duty.length, add: count(p.duty, '', 'new'), change: count(p.duty, '', 'change'), have: count(p.duty, '', 'have') },
    sample: p.events.filter(function (e) { return e.state === 'new'; }).slice(0, 12),
    skipped: p.events.filter(function (e) { return e.state === 'have'; }).slice(0, 8)
  };
}

function adminPlanImport_(args, actor) {
  var p = planImportPlan_(args);
  var add = p.events.filter(function (e) { return e.state === 'new'; });
  var duty = p.duty.filter(function (d) { return d.state === 'new' || d.state === 'change'; });
  if (duty.length) { ensureTab_('근무'); ensureCols_('근무'); }
  var memo = '월 중 계획에서 옮김(' + sourceOfArgs_(args).slice(0, 80) + ')';
  return withLock_(function () {
    if (add.length) {
      insertRows_('일정', add.map(function (e) {
        var title = e.title.length > 60 ? e.title.slice(0, 59) + '…' : e.title;
        return {
          '시작일': e.date, '끝일': '', '시간': e.time.slice(0, 20), '행사명': title, '대상 학년': e.kind === '회의' ? '교직원' : '',
          '담당 부서ID': '', '장소': e.place.slice(0, 40), '구분': e.kind, '메모': (e.title.length > 60 ? e.title + '\n' : '') + memo, '중요': ''
        };
      }), actor, '월 중 계획 ' + add.length + '건 일정에 넣음');
    }
    var news = duty.filter(function (d) { return d.state === 'new'; });
    if (news.length) {
      insertRows_('근무', news.map(function (d) { return { '날짜': d.date, '보안관 오전': d.am, '보안관 오후': d.pm, '당직': d.night }; }), actor, '보안관·당직 ' + news.length + '일 넣음');
    }
    duty.filter(function (d) { return d.state === 'change'; }).forEach(function (d) {
      updateRow_('근무', d.id, { '보안관 오전': d.am, '보안관 오후': d.pm, '당직': d.night }, actor, '근무 고침(월 중 계획): ' + d.date);
    });
    return { events: add.length, duty: duty.length };
  });
}
