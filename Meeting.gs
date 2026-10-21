/**
 * Meeting.gs — 회의록(공지 화면의 '회의록' 탭): 부장회의와 전교직원회의 (2026-10-21, 교사 결정)
 *
 * - '회의' 탭 한 줄 = 회의 한 건. 종류는 '부장회의' 또는 '교직원회의'
 * - '회의내용' 탭 한 줄 = 회의 안의 칸 하나 또는 항목 하나. '칸'으로 구분한다
 *   · 부장회의: '교장' · '교감' · '행정실장' · 부서ID(부서마다 한 줄) · '기타'(기타 안건, 한 분이 한 줄씩 여러 줄)
 *   · 교직원회의: '연수'(내용·담당·비고=연수 시간) · '안건'(내용·담당·비고)
 * - 쓰기 권한(교사 결정)
 *   · 부장회의 부서 칸: 그 부서 선생님. 교장·교감·행정실장 칸: 직위가 맞는 분. 기타 안건: 누구나 한 줄씩(자기 줄만 고침)
 *   · 교직원회의 연수·안건: 누구나 항목을 더하고, 자기가 넣은 줄만 고친다
 *   · 관리(역할 '관리' 또는 관리자 화면)는 모두 고친다
 * - 회의 만들기: 교무기획부(부서 이름에 '교무'가 든 부서) 선생님과 관리. 고치기·지우기: 만든 분과 관리
 *   만들면 '일정'에 구분 '회의'로 함께 넣고, 날짜·시간·장소를 고치면 그 일정도 고친다
 * - 탭은 처음 저장할 때 저절로 생긴다. 지우기는 '삭제 여부' 표시만 한다
 * - 기존 회의록 가져오기(관리자): 구글 시트 주소를 넣으면 부장회의(학기 탭)·교직원회의(달 탭)를 읽어 옮긴다
 */

var MEET_KINDS_ = ['부장회의', '교직원회의'];
var MEET_HEAD_SLOTS_ = [['교장', '교장 선생님'], ['교감', '교감 선생님'], ['행정실장', '행정실장님']];

// ---------------------------------------------------------------- 도구

/** 탭이 아직 없으면(처음 저장할 때 생긴다) 빈 목록 */
function meetRows_(tab) {
  try {
    return liveRows_(tab);
  } catch (e) {
    if (e && e.code === 'SETUP') return [];
    throw e;
  }
}

function meetEnsure_() {
  ensureTab_('회의');
  ensureTab_('회의내용');
  ensureCols_('회의');
  ensureCols_('회의내용');
}

/** 'yyyy-MM-dd'의 학년도(3월~다음 해 2월) */
function meetSchoolYear_(ymd) {
  var y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  return String(m >= 3 ? y : y - 1);
}

/** 날짜의 학기: 설정의 학기 기간에 들면 그 학기, 아니면 달로(3~7월 1학기, 그 밖 2학기) */
function meetTerm_(ymd) {
  var hit = semesters_().filter(function (s) { return ymd >= s.from && ymd <= s.to; })[0];
  if (hit) return hit.name;
  var m = Number(ymd.slice(5, 7));
  return m >= 3 && m <= 7 ? '1학기' : '2학기';
}

function meetTitle_(kind, year, term, round, ymd) {
  if (kind === '부장회의') return year + '학년도 ' + term + ' 부장회의 (' + round + ')';
  return Number(ymd.slice(5, 7)) + '월 교직원 회의';
}

/** 부장회의의 칸 목록: 교장·교감·행정실장 → 부서(사용하는 것, 관리자 화면 순서) → 기타 안건 */
function meetBoardSlots_(depts) {
  return MEET_HEAD_SLOTS_.map(function (s) { return { key: s[0], name: s[1], head: true }; })
    .concat(depts.filter(function (d) { return d.active; }).map(function (d) { return { key: d.id, name: d.name, dept: true }; }))
    .concat([{ key: '기타', name: '기타 안건', many: true }]);
}

/** 회의를 만들 수 있나: 관리, 또는 부서 이름에 '교무'가 든 부서 선생님 */
function canMakeMeeting_(ctx) {
  if (canManage_(ctx)) return true;
  if (!ctx.identity) return false;
  var name = categoryNames_('부서')[ctx.identity['부서ID']] || '';
  return name.indexOf('교무') >= 0;
}

function canEditMeeting_(m, ctx) {
  if (canManage_(ctx)) return true;
  return !!(ctx.identity && m['입력자ID'] && m['입력자ID'] === ctx.identity['교직원ID']);
}

/** 이 칸에 쓸 수 있나(부장회의의 한 줄 칸: 교장·교감·행정실장·부서) */
function canWriteSlot_(slot, ctx) {
  if (canManage_(ctx)) return true;
  var me = ctx.identity;
  if (!me) return false;
  var pos = String(me['직위'] || '');
  if (slot === '교장') return pos.indexOf('교장') >= 0;
  if (slot === '교감') return pos.indexOf('교감') >= 0;
  if (slot === '행정실장') return pos.indexOf('행정실장') >= 0;
  return !!me['부서ID'] && me['부서ID'] === slot;
}

/** 여러 줄 항목(기타 안건·연수·안건)을 고칠 수 있나: 넣은 분과 관리 */
function canEditLine_(row, ctx) {
  if (canManage_(ctx)) return true;
  return !!(ctx.identity && row['입력자ID'] && row['입력자ID'] === ctx.identity['교직원ID']);
}

function meetSummary_(m) {
  return (m['제목'] || '') + (m['날짜'] ? ' (' + m['날짜'] + ')' : '');
}

// ---------------------------------------------------------------- 읽기

/** 회의 한 건(내용 포함)을 화면에 보낼 모양으로 */
function meetView_(m, entries, ctx, depts, names) {
  var mine = entries.filter(function (e) { return e['회의ID'] === m['회의ID']; })
    .sort(function (a, b) { return (Number(a['순서']) || 0) - (Number(b['순서']) || 0) || (a['입력 시각'] < b['입력 시각'] ? -1 : 1); });
  var line = function (e) {
    return {
      id: e['내용ID'], slot: e['칸'], text: e['내용'], who: e['담당'], note: e['비고'],
      by: names[e['입력자ID']] || '', at: (e['수정 시각'] || e['입력 시각'] || '').slice(0, 16), canEdit: canEditLine_(e, ctx)
    };
  };
  var v = {
    id: m['회의ID'], kind: m['종류'], year: m['학년도'], term: m['학기'], round: m['회차'], title: m['제목'],
    date: m['날짜'], time: m['시간'], place: m['장소'], imported: !!m['가져온 곳'],
    by: names[m['입력자ID']] || '', canEdit: canEditMeeting_(m, ctx)
  };
  if (m['종류'] === '부장회의') {
    var slots = meetBoardSlots_(depts);
    var known = {};
    slots.forEach(function (s) { known[s.key] = true; });
    // 지금은 '사용 안 함'인 부서가 예전에 쓴 칸도 보이게
    mine.forEach(function (e) {
      if (!known[e['칸']] && e['칸'] !== '기타') {
        known[e['칸']] = true;
        var d = depts.filter(function (x) { return x.id === e['칸']; })[0];
        slots.splice(slots.length - 1, 0, { key: e['칸'], name: d ? d.name : '(지운 부서)', dept: true });
      }
    });
    v.rows = slots.map(function (s) {
      if (s.many) return { key: s.key, name: s.name, many: true, lines: mine.filter(function (e) { return e['칸'] === '기타'; }).map(line), canAdd: !!ctx.identity };
      var e = mine.filter(function (x) { return x['칸'] === s.key; })[0];
      return { key: s.key, name: s.name, dept: !!s.dept, id: e ? e['내용ID'] : '', text: e ? e['내용'] : '', by: e ? names[e['수정자ID'] || e['입력자ID']] || '' : '', canEdit: canWriteSlot_(s.key, ctx) };
    });
    v.missing = v.rows.filter(function (r) { return r.dept && !String(r.text || '').trim(); }).length; // 아직 안 쓴 부서 수
  } else {
    v.training = mine.filter(function (e) { return e['칸'] === '연수'; }).map(line);
    v.agenda = mine.filter(function (e) { return e['칸'] === '안건'; }).map(line);
  }
  return v;
}

function apiMeetList_(args, actor, ctx) {
  var depts = deptOptions_(), names = staffNames_();
  var entries = meetRows_('회의내용');
  var items = meetRows_('회의').map(function (m) { return meetView_(m, entries, ctx, depts, names); })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (Number(b.round) || 0) - (Number(a.round) || 0); });
  return { year: libYear_(), today: todayYmd_(), items: items, canCreate: canMakeMeeting_(ctx), canManage: canManage_(ctx) };
}

/** 찾기(홈 검색): 제목·장소·칸 내용 */
function meetSearch_(terms) {
  var entries = meetRows_('회의내용');
  var text = {};
  entries.forEach(function (e) { text[e['회의ID']] = (text[e['회의ID']] || '') + ' ' + [e['내용'], e['담당'], e['비고']].join(' '); });
  return meetRows_('회의').filter(function (m) {
    return matchAll_(terms, [m['제목'], m['장소'], m['종류'], text[m['회의ID']] || '']);
  }).map(function (m) { return { id: m['회의ID'], title: m['제목'], kind: m['종류'], date: m['날짜'] }; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
}

// ---------------------------------------------------------------- 회의 만들기·고치기·지우기

/** args = { id?, kind, date, time, place } */
function apiMeetSave_(args, actor, ctx) {
  var date = checkYmd_(args.date, '회의 날짜');
  var time = cleanText_(args.time, 20, '시간');
  var place = cleanText_(args.place, 40, '장소');
  meetEnsure_();
  var row = null;
  if (args.id) {
    row = findRow_('회의', String(args.id));
    if (!row || row['삭제 여부']) throw userError_('회의를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    if (!canEditMeeting_(row, ctx)) throw userError_('회의를 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  } else if (!canMakeMeeting_(ctx)) {
    throw userError_('회의는 교무기획부 선생님과 연구부장·부담당이 만들어요.', 'FORBIDDEN');
  }
  var kind = row ? row['종류'] : String(args.kind || '');
  if (MEET_KINDS_.indexOf(kind) < 0) throw userError_('회의 종류를 골라 주세요.');
  return withLock_(function () {
    var year = meetSchoolYear_(date), term = meetTerm_(date);
    var rec = { '날짜': date, '시간': time, '장소': place, '학년도': year, '학기': term };
    if (row) {
      rec['회차'] = row['회차'];
      if (row['학년도'] !== year || row['학기'] !== term) rec['회차'] = kind === '부장회의' ? String(meetNextRound_(year, term, row['회의ID'])) : '';
      rec['제목'] = meetTitle_(kind, year, term, rec['회차'], date);
      updateRow_('회의', row['회의ID'], rec, actor, '회의 고침: ' + meetSummary_(rec));
      meetSyncEvent_(row['일정ID'], rec, kind, actor);
      return { id: row['회의ID'] };
    }
    rec['종류'] = kind;
    rec['회차'] = kind === '부장회의' ? String(meetNextRound_(year, term, '')) : '';
    rec['제목'] = meetTitle_(kind, year, term, rec['회차'], date);
    var ev = insertRow_('일정', meetEventRec_(rec, kind, ctx), actor, '일정 추가(회의록): ' + rec['제목']);
    rec['일정ID'] = ev['일정ID'];
    var saved = insertRow_('회의', rec, actor, '회의 추가: ' + meetSummary_(rec));
    return { id: saved['회의ID'] };
  });
}

function meetNextRound_(year, term, exceptId) {
  return meetRows_('회의').filter(function (m) {
    return m['종류'] === '부장회의' && m['학년도'] === year && m['학기'] === term && m['회의ID'] !== exceptId;
  }).reduce(function (n, m) { return Math.max(n, Number(m['회차']) || 0); }, 0) + 1;
}

function meetEventRec_(rec, kind, ctx) {
  return {
    '시작일': rec['날짜'], '끝일': '', '시간': rec['시간'], '행사명': kind === '부장회의' ? '부장회의 (' + rec['회차'] + ')' : '전교직원회의',
    '대상 학년': '교직원', '담당 부서ID': (ctx.identity && ctx.identity['부서ID']) || '', '장소': rec['장소'], '구분': '회의',
    '메모': '회의록은 공지 › 회의록에 있어요.'
  };
}

/** 회의 날짜·시간·장소를 고치면 함께 넣은 일정도 고친다(일정을 따로 지웠으면 그대로 둔다) */
function meetSyncEvent_(eventId, rec, kind, actor) {
  if (!eventId) return;
  var ev = findRow_('일정', eventId);
  if (!ev || ev['삭제 여부']) return;
  var patch = { '시작일': rec['날짜'], '시간': rec['시간'], '장소': rec['장소'] };
  if (kind === '부장회의') patch['행사명'] = '부장회의 (' + rec['회차'] + ')';
  updateRow_('일정', eventId, patch, actor, '일정 고침(회의록): ' + rec['제목']);
}

function apiMeetDelete_(args, actor, ctx) {
  var row = findRow_('회의', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('회의를 찾지 못했어요. 이미 지워졌을 수 있어요.');
  if (!canEditMeeting_(row, ctx)) throw userError_('회의를 만든 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  withLock_(function () {
    softDelete_('회의', row['회의ID'], actor, '회의 지움: ' + meetSummary_(row));
    var ev = row['일정ID'] ? findRow_('일정', row['일정ID']) : null;
    if (ev && !ev['삭제 여부']) softDelete_('일정', ev['일정ID'], actor, '일정 지움(회의록): ' + row['제목']);
  });
  return { done: true };
}

// ---------------------------------------------------------------- 칸·항목 쓰기

/**
 * args = { meetId, slot, id?, text, who?, note? }
 * - 부장회의의 한 줄 칸(교장·교감·행정실장·부서): 그 칸의 줄을 고치거나 처음이면 만든다(빈 글이면 비운다)
 * - 여러 줄 항목(기타·연수·안건): id가 있으면 고치고, 없으면 끝에 더한다
 */
function apiMeetEntrySave_(args, actor, ctx) {
  var m = findRow_('회의', String(args.meetId || ''));
  if (!m || m['삭제 여부']) throw userError_('회의를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  var slot = String(args.slot || '');
  var many = m['종류'] === '부장회의' ? slot === '기타' : (slot === '연수' || slot === '안건');
  if (m['종류'] === '교직원회의' && !many) throw userError_('칸을 다시 골라 주세요.');
  var text = cleanText_(args.text, 3000, '내용', many);
  var who = many && m['종류'] === '교직원회의' ? cleanText_(args.who, 30, '담당') : '';
  var note = many && m['종류'] === '교직원회의' ? cleanText_(args.note, 60, slot === '연수' ? '연수 시간' : '비고') : '';
  meetEnsure_();
  return withLock_(function () {
    var rows = liveRows_('회의내용').filter(function (e) { return e['회의ID'] === m['회의ID'] && e['칸'] === slot; });
    if (!many) {
      if (m['종류'] === '부장회의' && MEET_HEAD_SLOTS_.every(function (s) { return s[0] !== slot; }) && !categoryNames_('부서')[slot]) {
        throw userError_('칸을 다시 골라 주세요.');
      }
      if (!canWriteSlot_(slot, ctx)) throw userError_('이 칸은 그 부서 선생님(교장·교감·행정실장 칸은 본인)과 연구부장·부담당만 쓸 수 있어요.', 'FORBIDDEN');
      var cur = rows[0];
      if (cur) updateRow_('회의내용', cur['내용ID'], { '내용': text }, actor, '회의록 고침: ' + m['제목']);
      else if (text) insertRow_('회의내용', { '회의ID': m['회의ID'], '칸': slot, '순서': '0', '내용': text }, actor, '회의록 씀: ' + m['제목']);
      return { done: true };
    }
    if (args.id) {
      var row = rows.filter(function (e) { return e['내용ID'] === String(args.id); })[0];
      if (!row) throw userError_('항목을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
      if (!canEditLine_(row, ctx)) throw userError_('넣은 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
      updateRow_('회의내용', row['내용ID'], { '내용': text, '담당': who, '비고': note }, actor, '회의록 항목 고침: ' + m['제목']);
      return { done: true };
    }
    var order = rows.reduce(function (n, e) { return Math.max(n, Number(e['순서']) || 0); }, 0) + 1;
    insertRow_('회의내용', { '회의ID': m['회의ID'], '칸': slot, '순서': String(order), '내용': text, '담당': who, '비고': note }, actor, '회의록 항목 더함: ' + m['제목']);
    return { done: true };
  });
}

function apiMeetEntryDelete_(args, actor, ctx) {
  var row = findRow_('회의내용', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('항목을 찾지 못했어요. 이미 지워졌을 수 있어요.');
  if (!canEditLine_(row, ctx)) throw userError_('넣은 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  softDelete_('회의내용', row['내용ID'], actor, '회의록 항목 지움: ' + String(row['내용']).slice(0, 30));
  return { done: true };
}

/** 항목 순서 바꾸기(위·아래 한 칸). 회의를 만든 분과 관리 */
function apiMeetEntryMove_(args, actor, ctx) {
  var row = findRow_('회의내용', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('항목을 찾지 못했어요.');
  var m = findRow_('회의', row['회의ID']);
  if (!m || !canEditMeeting_(m, ctx)) throw userError_('순서는 회의를 만든 분과 연구부장·부담당이 바꿔요.', 'FORBIDDEN');
  return withLock_(function () {
    var list = liveRows_('회의내용').filter(function (e) { return e['회의ID'] === row['회의ID'] && e['칸'] === row['칸']; })
      .sort(function (a, b) { return (Number(a['순서']) || 0) - (Number(b['순서']) || 0) || (a['입력 시각'] < b['입력 시각'] ? -1 : 1); });
    var i = list.map(function (e) { return e['내용ID']; }).indexOf(row['내용ID']);
    var j = i + (Number(args.dir) < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return { done: true };
    var t = list[i]; list[i] = list[j]; list[j] = t;
    list.forEach(function (e, k) {
      if (String(e['순서']) !== String(k + 1)) setCellsNoLog_('회의내용', e, { '순서': String(k + 1) });
    });
    writeLog_(actor, '회의내용', row['내용ID'], '수정', '회의록 항목 순서 바꿈: ' + m['제목'], null, null);
    return { done: true };
  });
}

// ---------------------------------------------------------------- 기존 회의록 가져오기 (관리자)

/** 시트 주소 → [{ name, vals(보이는 글자) }] */
function meetReadSheet_(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url)) throw userError_('구글 시트 주소(https://docs.google.com/spreadsheets/d/…)를 넣어 주세요.');
  var ss;
  try { ss = SpreadsheetApp.openByUrl(url); } catch (e) {
    throw userError_('시트를 열지 못했어요. 주소가 맞는지, 웹앱을 만든 계정이 이 시트를 볼 수 있는지 확인해 주세요.');
  }
  return ss.getSheets().map(function (sh) { return { name: sh.getName(), vals: sh.getDataRange().getDisplayValues() }; });
}

function meetSquash_(s) { return String(s || '').replace(/\s+/g, ''); }

function meetYmd_(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }

/** 부장회의 칸 이름 → 칸 키('' = 못 찾음) */
function meetSlotOf_(label, depts) {
  var s = meetSquash_(label);
  if (!s) return '';
  if (s.indexOf('교장') === 0) return '교장';
  if (s.indexOf('교감') === 0) return '교감';
  if (s.indexOf('행정실') === 0) return '행정실장';
  if (s.indexOf('기타') === 0) return '기타';
  var base = s.replace(/\(.*$/, '');
  for (var i = 0; i < depts.length; i++) {
    var n = meetSquash_(depts[i].name);
    if (n && (n === base || base.indexOf(n) === 0 || n.indexOf(base) === 0)) return depts[i].id;
  }
  return '';
}

/**
 * 부장회의 시트: 학기마다 탭 하나, 회의가 위아래로 쌓인다
 * 제목 '2026학년도 2학기 부장회의 (5)' → 날짜 '2026년 10월 22일 (목) 15:00' → '부서 | 내용' 줄들
 */
function meetParseBoard_(sheets, depts) {
  var out = [];
  sheets.forEach(function (sh) {
    var cur = null;
    sh.vals.forEach(function (row) {
      var cells = row.map(function (c) { return String(c || '').trim(); });
      var line = cells.join(' ');
      var t = line.match(/(\d{4})\s*학년도\s*([12])\s*학기\s*부장\s*회의\s*\(?\s*(\d+)\s*\)?/);
      if (t) {
        cur = { kind: '부장회의', year: t[1], term: t[2] + '학기', round: t[3], date: '', time: '', entries: [], unmatched: [], sheet: sh.name };
        out.push(cur);
        return;
      }
      if (!cur) return;
      if (!cur.date) {
        var d = line.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (d) {
          cur.date = meetYmd_(d[1], d[2], d[3]);
          var tm = line.match(/(\d{1,2}:\d{2})/);
          cur.time = tm ? tm[1] : '';
          return;
        }
      }
      var label = cells[0];
      if (!label || meetSquash_(label) === '부서') return;
      var text = cells.slice(1).filter(Boolean).join('\n').trim();
      var slot = meetSlotOf_(label, depts);
      if (!slot) {
        cur.unmatched.push(label.replace(/\s+/g, ' '));
        if (text) cur.entries.push({ slot: '기타', text: '[' + label.replace(/\s+/g, ' ') + '] ' + text });
        return;
      }
      if (!text) return;
      var same = slot !== '기타' && cur.entries.filter(function (e) { return e.slot === slot; })[0];
      if (same) same.text += '\n' + text; // 같은 칸이 두 줄로 나뉜 경우 이어 붙인다
      else cur.entries.push({ slot: slot, text: text });
    });
  });
  out.forEach(function (m) { m.title = meetTitle_('부장회의', m.year, m.term, m.round, m.date); });
  return out;
}

/** 해가 안 적힌 날짜(지난 회의록): 올해로 두되, 두 달 넘게 앞이면 지난해로 본다 */
function meetGuessYmd_(mo, d, today) {
  var y = Number(today.slice(0, 4));
  var ymd = meetYmd_(y, mo, d);
  var limit = new Date(Date.UTC(y, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 60)).toISOString().slice(0, 10);
  return ymd > limit ? meetYmd_(y - 1, mo, d) : ymd;
}

/**
 * 교직원회의 시트: 달마다 탭 하나
 * '< 10월 교직원 회의 >' → 일시 '10월 12일 월요일 15:00~' → 장소 → '<연수>' 표(순·내용·담당·연수 시간) → '<안건>' 표(순·내용·담당·비고)
 */
function meetParseStaff_(sheets, today) {
  var out = [];
  sheets.forEach(function (sh) {
    var cur = null, sec = '';
    sh.vals.forEach(function (row) {
      var cells = row.map(function (c) { return String(c || '').trim(); });
      var line = cells.join(' ');
      var t = line.match(/(\d{1,2})\s*월\s*교직원\s*회의/);
      if (t && !cur) {
        cur = { kind: '교직원회의', month: Number(t[1]), date: '', time: '', place: '', entries: [], unmatched: [], sheet: sh.name };
        out.push(cur);
        sec = '';
        return;
      }
      if (!cur) return;
      var head = meetSquash_(cells[0]);
      if (head === '일시') {
        var d = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (d) cur.date = meetGuessYmd_(Number(d[1]), Number(d[2]), today);
        var tm = line.match(/(\d{1,2}:\d{2})/);
        cur.time = tm ? tm[1] : '';
        return;
      }
      if (head === '장소') { cur.place = cells.slice(1).filter(Boolean).join(' '); return; }
      if (/<\s*연수\s*>/.test(line)) { sec = '연수'; return; }
      if (/<\s*안건\s*>/.test(line)) { sec = '안건'; return; }
      if (!sec) return;
      if (cells.some(function (c) { return meetSquash_(c) === '내용'; })) return; // 머리글 줄
      var text = cells[1];
      if (!text) return;
      cur.entries.push({ slot: sec, text: text, who: cells[2] || '', note: cells[3] || '' });
    });
  });
  out.forEach(function (m) {
    if (!m.date) {
      m.date = meetGuessYmd_(m.month, 1, today);
      m.noDate = true;
    }
    m.year = meetSchoolYear_(m.date);
    m.term = meetTerm_(m.date);
    m.round = '';
    m.title = meetTitle_('교직원회의', m.year, m.term, '', m.date);
  });
  return out;
}

/** 이미 있는 회의인지: 부장회의는 학년도·학기·회차, 교직원회의는 날짜 */
function meetKey_(m) {
  return m.kind === '부장회의' ? '부장|' + m.year + '|' + m.term + '|' + m.round : '교직원|' + m.date;
}

function meetImportPlan_(args) {
  var kind = String(args.kind || '');
  if (MEET_KINDS_.indexOf(kind) < 0) throw userError_('가져올 회의 종류를 골라 주세요.');
  var sheets = meetReadSheet_(args.url);
  var depts = deptOptions_();
  var list = kind === '부장회의' ? meetParseBoard_(sheets, depts) : meetParseStaff_(sheets, todayYmd_());
  var have = {};
  meetRows_('회의').forEach(function (m) {
    have[meetKey_({ kind: m['종류'], year: m['학년도'], term: m['학기'], round: m['회차'], date: m['날짜'] })] = true;
  });
  var seen = {};
  list.forEach(function (m) {
    var k = meetKey_(m);
    m.state = have[k] ? 'have' : seen[k] ? 'dup' : 'new';
    seen[k] = true;
  });
  return { kind: kind, sheets: sheets.map(function (s) { return s.name; }), items: list };
}

function adminMeetImportPreview_(args) {
  var p = meetImportPlan_(args);
  return {
    kind: p.kind, sheets: p.sheets,
    items: p.items.map(function (m) {
      return { title: m.title, date: m.date, time: m.time, place: m.place || '', sheet: m.sheet, entries: m.entries.length, unmatched: m.unmatched, noDate: !!m.noDate, state: m.state };
    })
  };
}

function adminMeetImport_(args, actor) {
  var p = meetImportPlan_(args);
  var add = p.items.filter(function (m) { return m.state === 'new'; });
  if (!add.length) return { added: 0, entries: 0 };
  meetEnsure_();
  return withLock_(function () {
    var src = String(args.url).trim().slice(0, 300);
    var saved = insertRows_('회의', add.map(function (m) {
      return { '종류': m.kind, '학년도': m.year, '학기': m.term, '회차': m.round, '제목': m.title, '날짜': m.date, '시간': m.time, '장소': m.place || '', '일정ID': '', '가져온 곳': src };
    }), actor, p.kind + ' 회의록 ' + add.length + '건 가져옴');
    var lines = [];
    add.forEach(function (m, i) {
      var order = 0;
      m.entries.forEach(function (e) {
        order++;
        lines.push({ '회의ID': saved[i]['회의ID'], '칸': e.slot, '순서': String(order), '내용': e.text, '담당': e.who || '', '비고': e.note || '' });
      });
    });
    insertRows_('회의내용', lines, actor, p.kind + ' 회의록 내용 ' + lines.length + '줄 가져옴');
    return { added: add.length, entries: lines.length };
  });
}
