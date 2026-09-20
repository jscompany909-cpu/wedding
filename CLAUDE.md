# 모바일 청첩장 — 배진섭 · 서보미

2026년 11월 7일(토) 오후 3시, 사랑의교회 북측 2층 언약채플.

- 배포 주소: https://jscompany909-cpu.github.io/wedding/
- 저장소: https://github.com/jscompany909-cpu/wedding (public, GitHub Pages)
- 로컬 경로: `C:\Users\Nick-Judy\Documents\Claude`
- `main`에 push하면 GitHub Pages가 자동 재배포 (보통 1~2분)

## 파일 구성

| 파일 | 설명 |
|---|---|
| `index.html` | 청첩장 전체 (HTML/CSS/JS 단일 파일). 거의 모든 수정은 여기서 한다 |
| `photos/main.jpg` | 히어로 사진 |
| `photos/photo*.jpg` | 갤러리. 순서는 `index.html`의 `GALLERY_FILES` 배열이 결정한다 |
| `photos/og.jpg` | 카카오톡·SNS 링크 미리보기 전용 이미지 (800x400) |
| `robots.txt` | 검색엔진 차단 + 링크 미리보기 봇 허용 |
| `rsvp-apps-script.gs` | RSVP를 구글 시트에 저장하는 Apps Script (시트 쪽에 붙여넣어 배포) |

## 건드리면 안 되는 것

**`RSVP_ENDPOINT`** (`index.html`) — 배포된 Apps Script 웹앱 주소. 사용자가 요청하지 않는 한 변경 금지.

**`RSVP_TOKEN`** (`index.html`)과 **`CONFIG.TOKEN`** (`rsvp-apps-script.gs`) — 두 값이 **반드시 같아야** RSVP가 저장된다. 한쪽만 바꾸면 모든 응답이 '토큰 불일치'로 차단된다.

**`robots.txt`의 미리보기 봇 허용 규칙** — 카카오톡 스크랩 봇의 UA는
`facebookexternalhit/1.1;kakaotalk-scrap/1.0` 이다.
`User-agent: *` 전면 차단만 두면 카톡 링크 미리보기가 아예 안 뜬다.
검색엔진(Googlebot/Yeti/Daum/bingbot)은 차단을 유지하되 미리보기 봇은 반드시 Allow.

## 미완료 설정

**카카오 공유 카드** — `index.html`의 `const KAKAO_JS_KEY='';` 가 비어 있다.
developers.kakao.com에서 JavaScript 키를 발급받아 넣고,
[앱 설정 > 플랫폼 > Web]에 `https://jscompany909-cpu.github.io` 를 등록해야
큰 사진 + [청첩장 보기][위치 보기] 버튼 카드가 전송된다.
키가 비어 있으면 기존 딥링크 방식으로 자동 대체되므로 그대로 두어도 동작은 한다.

**Apps Script 재배포** — `rsvp-apps-script.gs`를 고쳤다면 Apps Script 편집기에서
반드시 **새 배포**를 해야 반영된다. 기존 배포를 수정만 하면 안 바뀐다.

**추가 예정 사진** — 촛불, 정원 벤치(앉아있는 컷), 그 외 2장. 파일을 받으면
`photos/`에 넣고 `GALLERY_FILES`에 추가한다.

## 작업 규칙

- 커밋 메시지는 한국어, `feat:` / `fix:` / `design:` / `refactor:` / `chore:` 접두어.
- `git add -A` 대신 변경한 파일만 이름으로 지정한다.
- 사진은 용량이 크다. 원본을 그대로 넣지 말고 필요한 크기로 줄여서 교체한다.
- **검증 후 커밋**: Playwright(Chromium)로 모바일 폭 390px에서 열어 수정한
  부분을 확인하고 콘솔 에러가 없는지 본다. 인트로 애니메이션이 약 6.6초이므로
  페이지 로드 후 충분히 기다린 뒤 조작해야 한다.
- 라디오 버튼 등은 CSS로 숨겨져 있어 `<input>` 직접 클릭이 안 된다.
  `label[for="..."]` 를 클릭할 것.

## 알려진 제약

- 무료 플랜이라 저장소를 private으로 바꾸면 GitHub Pages가 꺼진다.
  (Pages는 무료 플랜에서 public 저장소만 지원)
- 정적 페이지라 `RSVP_TOKEN`은 소스에서 보인다. 자동화된 장난 제출을 막는
  수준이지 작정한 사람을 막지는 못한다.
- `og.jpg`를 교체하면 `index.html`의 `og:image` 끝 `?v=1` 숫자를 올려야
  카카오가 캐시를 버리고 새로 읽어간다.
- 계좌번호 6개가 공개 웹에 노출되어 있다. 식이 끝나면 해당 섹션 정리 검토.
