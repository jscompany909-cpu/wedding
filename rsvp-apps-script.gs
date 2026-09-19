/**
 * 사용법
 * 1. sheets.google.com 에서 새 스프레드시트 생성 (이름: 예) "청첩장 RSVP")
 * 2. 상단 메뉴 확장 프로그램(Extensions) > Apps Script 클릭
 * 3. 기본으로 열린 코드를 전부 지우고 이 파일 내용을 붙여넣기
 * 4. 오른쪽 위 배포(Deploy) > 새 배포(New deployment) 클릭
 *    - 유형 선택: 웹 앱 (Web app)
 *    - 실행 계정(Execute as): 나 (본인 계정)
 *    - 액세스 권한(Who has access): 모든 사용자 (Anyone)
 *    - 배포 클릭 → 권한 승인(본인 계정으로) → 웹 앱 URL 복사
 * 5. 복사한 URL(https://script.google.com/macros/s/xxxxx/exec 형태)을 저한테 전달
 */
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('RSVP') || ss.insertSheet('RSVP');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['제출시각', '성함', '참석여부', '식사여부', '인원수']);
    sheet.setFrozenRows(1);
  }

  var p = e.parameter;
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
    p.name || '',
    p.attend === 'yes' ? '참석' : '불참',
    p.meal || '',
    p.count || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}
