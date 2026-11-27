# 기프티콘 포켓 — 작업 메모

## 구조
- `dist/`가 곧 배포되는 앱입니다(빌드·번들러 없음, ES 모듈). GitHub Pages 하위 경로(`/gifticon-pocket/`)에서 동작하도록 경로는 모두 상대 경로로 씁니다. 서버는 없습니다(만료 알림은 앱 안 배너와 캘린더 .ics).
- `dist/sw-manifest.js`는 생성 파일이라 커밋하지 않습니다(`npm run build`).
- 이미지 읽기 엔진은 `dist/vendor/<이름>-<버전>/`에 함께 배포합니다(`npm run vendor`). 외부 CDN을 쓰지 않습니다.

## 확인
- `npm test` (node:test), `npm run build`.
- 화면을 바꿨다면 Playwright로 휴대폰 크기(라이트·다크)에서 확인하고, 필요하면 `npm run screenshots`로 README 화면을 갱신합니다.
- iPhone Safari 주의: IndexedDB에서 읽은 Blob은 DB 파일에 묶여 있어 다시 저장할 때 메모리 복사본을 써야 합니다(`db.js`의 `detach`/`mutate`가 처리). 쿠폰을 쓰는 새 경로는 반드시 `mutate`/`putMany`를 거치세요.
- 실제 사용자의 쿠폰 이미지(번호가 보이는 원본)는 저장소에 넣지 않습니다. 회귀 테스트는 OCR 결과 줄로 만듭니다.

## 커밋·PR
- 커밋 메시지 끝에 저장소 주인을 공동 작성자로 넣습니다:
  `Co-Authored-By: Lim Hyun <27723925+HyunIm@users.noreply.github.com>`
- `main`에 병합하면 GitHub Actions가 테스트 후 `gh-pages`로 자동 배포합니다.
- 문구는 앱 전체가 쓰는 해요체(`~해 주세요`, `~했어요`)로 맞춥니다.
