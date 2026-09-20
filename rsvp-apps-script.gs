/**
 * 청첩장 RSVP 수집 (보안 강화판)
 *
 * ── 배포 방법 ─────────────────────────────────────────
 * 1. sheets.google.com 에서 새 스프레드시트 생성 (예: "청첩장 RSVP")
 * 2. 상단 메뉴 확장 프로그램(Extensions) > Apps Script 클릭
 * 3. 기본으로 열린 코드를 전부 지우고 이 파일 내용을 붙여넣기
 * 4. 아래 CONFIG.TOKEN 값이 index.html 의 RSVP_TOKEN 과 똑같은지 확인
 * 5. 오른쪽 위 배포(Deploy) > 새 배포(New deployment)
 *    - 유형: 웹 앱 (Web app)
 *    - 실행 계정(Execute as): 나 (본인 계정)
 *    - 액세스 권한(Who has access): 모든 사용자 (Anyone)
 *    - 배포 → 권한 승인 → 웹 앱 URL 복사
 * 6. 복사한 URL 을 index.html 의 RSVP_ENDPOINT 에 붙여넣기
 *
 * ※ 코드를 수정하면 반드시 "새 배포"를 다시 해야 반영됩니다.
 *   (기존 배포 관리 > 편집 > 버전: 새 버전 으로 해도 됩니다)
 *
 * ── 만들어지는 시트 ───────────────────────────────────
 *   RSVP     : 정상 접수된 응답
 *   차단로그  : 토큰 불일치 / 중복 / 과다요청으로 걸러진 시도
 *              (실수로 걸러진 하객이 있는지 가끔 확인해 보세요)
 * ──────────────────────────────────────────────────── */

var CONFIG = {
  // index.html 의 RSVP_TOKEN 과 반드시 동일해야 합니다.
  TOKEN: 'wd-olPiLGtYwyJdWUovwBHDvljgOoPG',

  SHEET_NAME: 'RSVP',
  BLOCK_SHEET_NAME: '차단로그',

  MAX_PER_MINUTE: 30,   // 전체 분당 최대 접수 (하객 정상 사용은 절대 안 걸림)
  MAX_TOTAL: 1000,      // 누적 최대 접수 건수
  DUP_WINDOW_SEC: 180,  // 같은 내용 재제출 차단 시간(초)
  MAX_NAME_LEN: 20,
  MAX_COUNT: 10,

  // 접수될 때마다 메일 알림을 받으려면 주소를 넣으세요. 비우면 안 보냄.
  NOTIFY_EMAIL: ''
};

function doGet() {
  return json({ result: 'ok' });
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    // 1) 허니팟 — 사람은 절대 채우지 않는 숨김칸. 채워져 있으면 봇.
    if (p.website) return logBlocked('허니팟', p);

    // 2) 토큰 확인 — 주소만 알아낸 외부 요청 차단
    if (String(p.token || '') !== CONFIG.TOKEN) return logBlocked('토큰 불일치', p);

    // 3) 입력값 검증 — 형식에 안 맞으면 시트에 안 들어감
    var name = String(p.name || '').trim();
    if (!name || name.length > CONFIG.MAX_NAME_LEN) return logBlocked('이름 형식 오류', p);

    var attend = String(p.attend || '');
    if (attend !== 'yes' && attend !== 'no') return logBlocked('참석값 오류', p);

    var meal = String(p.meal || '');
    if (['yes', 'no', 'maybe', '미정', '없음', ''].indexOf(meal) === -1) meal = '미정';

    var count = parseInt(p.count, 10);
    if (isNaN(count) || count < 0) count = 0;
    if (count > CONFIG.MAX_COUNT) return logBlocked('인원수 범위 초과', p);

    // 동시 접수 충돌 방지
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json({ result: 'busy' });

    try {
      var cache = CacheService.getScriptCache();

      // 4) 같은 내용 반복 제출 차단 (새로고침 중복 포함)
      var dupKey = 'dup_' + hash(name + '|' + attend + '|' + meal + '|' + count);
      if (cache.get(dupKey)) return logBlocked('중복 제출', p);

      // 5) 분당 전체 접수량 제한 — 대량 자동 제출 차단
      var minuteKey = 'rate_' + Math.floor(Date.now() / 60000);
      var hits = parseInt(cache.get(minuteKey) || '0', 10) + 1;
      cache.put(minuteKey, String(hits), 120);
      if (hits > CONFIG.MAX_PER_MINUTE) return logBlocked('분당 한도 초과', p);

      var sheet = getSheet(CONFIG.SHEET_NAME,
        ['제출시각', '성함', '참석여부', '식사여부', '인원수']);

      // 6) 누적 한도
      if (sheet.getLastRow() - 1 >= CONFIG.MAX_TOTAL) return logBlocked('누적 한도 초과', p);

      sheet.appendRow([
        now(),
        safe(name),                              // 수식 주입 방지
        attend === 'yes' ? '참석' : '불참',
        mealLabel(attend, meal),
        attend === 'yes' ? count : 0
      ]);

      cache.put(dupKey, '1', CONFIG.DUP_WINDOW_SEC);
      notify(name, attend, count);

      return json({ result: 'success' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/* ── 보조 함수 ──────────────────────────────────────── */

function getSheet(sheetName, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 구글 시트는 = + - @ 로 시작하는 값을 수식으로 해석합니다.
 * 하객 이름칸에 수식을 넣는 공격을 막기 위해 앞에 작은따옴표를 붙입니다.
 */
function safe(v) {
  var s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function mealLabel(attend, meal) {
  if (attend !== 'yes') return '없음';
  if (meal === 'yes') return '식사';
  if (meal === 'no') return '안 함';
  return '미정';
}

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function hash(s) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
  );
}

/** 걸러진 시도를 버리지 않고 기록 — 정상 하객이 잘못 걸렸는지 확인용 */
function logBlocked(reason, p) {
  try {
    var sheet = getSheet(CONFIG.BLOCK_SHEET_NAME, ['시각', '차단사유', '성함', '참석', '인원']);
    sheet.appendRow([now(), reason, safe(String(p.name || '')), String(p.attend || ''), String(p.count || '')]);
  } catch (err) { /* 로그 실패는 무시 */ }
  return json({ result: 'rejected' });
}

function notify(name, attend, count) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail(
      CONFIG.NOTIFY_EMAIL,
      '[청첩장] RSVP 도착 — ' + name,
      name + ' 님 / ' + (attend === 'yes' ? '참석 ' + count + '명' : '불참') + '\n' + now()
    );
  } catch (err) { /* 메일 실패해도 접수는 유지 */ }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
