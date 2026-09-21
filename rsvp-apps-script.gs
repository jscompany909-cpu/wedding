/**
 * 청첩장 RSVP 수집 (보안 강화판)
 *
 * ── 배포 방법 ─────────────────────────────────────────
 * 1. sheets.google.com 에서 새 스프레드시트 생성 (예: "청첩장 RSVP")
 * 2. 그 시트 주소의 .../spreadsheets/d/<여기>/edit 가운데 부분을
 *    아래 CONFIG.SHEET_ID 에 넣기
 * 3. 기본으로 열린 코드를 전부 지우고 이 파일 내용을 붙여넣기
 * 4. 아래 CONFIG.TOKEN 값이 index.html 의 RSVP_TOKEN 과 똑같은지 확인
 * 5. 오른쪽 위 배포(Deploy) > 새 배포(New deployment)
 *    - 유형: 웹 앱 (Web app)
 *    - 실행 계정(Execute as): 나 (본인 계정)
 *    - 액세스 권한(Who has access): 모든 사용자 (Anyone)
 *    - 배포 → 권한 승인 → 웹 앱 URL 복사
 * 6. 복사한 URL 을 index.html 의 RSVP_ENDPOINT 에 붙여넣기
 *
 * ※ 코드를 고친 뒤에는 반드시 다시 배포해야 반영됩니다.
 *   웹앱 주소를 그대로 두고 싶으면 '새 배포'가 아니라
 *   배포 관리 > 기존 배포 편집(연필) > 버전: 새 버전 > 배포 를 쓰세요.
 *   '새 배포'는 주소가 새로 생기고, 옛 주소는 옛 코드를 계속 서비스합니다.
 *
 * ※ 연결이 잘 됐는지는 웹앱 주소를 브라우저로 열어 확인할 수 있습니다.
 *   {"result":"ok","tabs":[...]}  → 시트 연결 정상
 *   {"result":"error",...}        → SHEET_ID 확인 필요
 *
 * ── 만들어지는 시트 ───────────────────────────────────
 *   RSVP     : 정상 접수된 응답
 *   차단로그  : 토큰 불일치 / 중복 / 과다요청으로 걸러진 시도
 *              (실수로 걸러진 하객이 있는지 가끔 확인해 보세요)
 *              CONFIG 의 상한에 걸리면 기록이 멈추므로, 무한정 쌓이지 않습니다.
 * ──────────────────────────────────────────────────── */

var CONFIG = {
  // index.html 의 RSVP_TOKEN 과 반드시 동일해야 합니다.
  TOKEN: 'wd-olPiLGtYwyJdWUovwBHDvljgOoPG',

  // 기록할 스프레드시트의 ID (주소의 /spreadsheets/d/<여기>/edit 부분).
  // 이걸 지정하면 스크립트를 시트 안에서 만들었든 따로 만들었든
  // 항상 이 시트에 기록됩니다. 비워 두면 스크립트가 붙어 있는 시트를 씁니다.
  SHEET_ID: '1d9JW9D14tphfglTSpt_z5slXQUOUERSbd7yDGO2XZf8',

  SHEET_NAME: 'RSVP',
  BLOCK_SHEET_NAME: '차단로그',

  MAX_PER_MINUTE: 30,   // 시트에 기록되는 분당 최대 접수 (하객 정상 사용은 절대 안 걸림)
  MAX_TOTAL: 1000,      // 누적 최대 접수 건수

  // ── 시트를 건드리기 전에 적용되는 상한 ──────────────────
  // 웹앱 주소는 청첩장 소스에 보이므로, 토큰을 모르는 사람도 요청은 보낼 수 있습니다.
  // 아래 상한이 없으면 그런 요청 하나하나가 '차단로그'에 계속 쌓여서
  // 시트 용량과 Apps Script 할당량을 소진시킬 수 있습니다.
  MAX_REQ_PER_MINUTE: 60,     // 모든 요청(토큰 불일치 포함) 분당 상한
  MAX_BLOCK_LOG_PER_HOUR: 60, // 차단로그 시간당 기록 상한
  MAX_BLOCK_LOG_TOTAL: 5000,  // 차단로그 절대 상한(행)

  DUP_WINDOW_SEC: 180,  // 같은 내용 재제출 차단 시간(초)
  MAX_NAME_LEN: 20,
  MAX_COUNT: 10,

  // 접수될 때마다 메일 알림을 받으려면 주소를 넣으세요. 비우면 안 보냄.
  NOTIFY_EMAIL: ''
};

/**
 * 브라우저로 웹앱 주소를 열면 시트 연결 상태를 알려줍니다.
 * 응답에 시트 이름이나 ID 는 담지 않습니다(주소가 공개돼 있으므로).
 */
function doGet() {
  var out = { result: 'ok' };
  try {
    out.tabs = getSS().getSheets().map(function (s) { return s.getName(); });
  } catch (err) {
    out.result = 'error';
    out.message = '시트 연결 실패 — CONFIG.SHEET_ID 를 확인하세요';
  }
  return json(out);
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    // 0) 시트에 손대기 전 전체 요청 상한 — 캐시만 사용하므로 시트/할당량을 쓰지 않습니다.
    //    대량 요청은 여기서 조용히 끊기고 차단로그도 남기지 않습니다.
    if (!allowRequest()) return json({ result: 'rejected' });

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

/**
 * 기록 대상 스프레드시트.
 * SHEET_ID 가 있으면 그 시트를, 없으면 이 스크립트가 붙어 있는 시트를 씁니다.
 * 둘 다 없으면 조용히 실패하지 않고 오류를 냅니다.
 */
function getSS() {
  if (CONFIG.SHEET_ID) return SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('기록할 시트가 없습니다. CONFIG.SHEET_ID 를 채우세요.');
  return ss;
}

function getSheet(sheetName, header) {
  var ss = getSS();
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
    if (allowBlockLog()) {
      var sheet = getSheet(CONFIG.BLOCK_SHEET_NAME, ['시각', '차단사유', '성함', '참석', '인원']);
      sheet.appendRow([now(), reason, safe(String(p.name || '')), String(p.attend || ''), String(p.count || '')]);
    }
  } catch (err) { /* 로그 실패는 무시 */ }
  return json({ result: 'rejected' });
}

/**
 * 시트를 건드리기 전 전체 요청 상한.
 * 캐시만 읽고 쓰므로 스프레드시트 접근이 전혀 없습니다.
 */
function allowRequest() {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'req_' + Math.floor(Date.now() / 60000);
    var hits = parseInt(cache.get(key) || '0', 10) + 1;
    cache.put(key, String(hits), 120);
    return hits <= CONFIG.MAX_REQ_PER_MINUTE;
  } catch (err) {
    return true;   // 캐시가 말썽이어도 정상 하객을 막지는 않습니다
  }
}

/** 차단로그가 무한정 쌓이지 않도록 시간당·누적 상한을 둡니다. */
function allowBlockLog() {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'blog_' + Math.floor(Date.now() / 3600000);
    var n = parseInt(cache.get(key) || '0', 10) + 1;
    cache.put(key, String(n), 3900);
    if (n > CONFIG.MAX_BLOCK_LOG_PER_HOUR) return false;

    // 시간당 첫 기록에서만 시트 크기를 확인 — 절대 상한을 넘으면 더 쌓지 않습니다.
    if (n === 1) {
      var sheet = getSS().getSheetByName(CONFIG.BLOCK_SHEET_NAME);
      if (sheet && sheet.getLastRow() - 1 >= CONFIG.MAX_BLOCK_LOG_TOTAL) return false;
    }
    return true;
  } catch (err) {
    return true;
  }
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
