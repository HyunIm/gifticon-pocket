# 기프티콘 포켓

기프티콘 이미지와 쿠폰 번호를 보관하고, 유효기간과 사용 여부를 확인하는 한국어 웹앱입니다. 쿠폰 데이터는 현재 브라우저의 IndexedDB에 저장됩니다. 기기 간 동기화는 지원하지 않으며, 사이트 데이터를 지우면 쿠폰도 삭제됩니다.

## 홈 화면에서 사용하기

[기프티콘 포켓](https://gifticon-pocket.limhyun.workers.dev)을 열고 상단의 **앱 설치**를 누릅니다. iPhone에서는 Safari의 공유 메뉴에서 **홈 화면에 추가**를 선택합니다. 추가한 아이콘을 누르면 보관함이 독립 창에서 열립니다.

온라인에서 한 번 열고 앱 파일이 저장되면 오프라인에서도 쿠폰과 원본 이미지를 열고 사용 여부를 변경할 수 있습니다. 쿠폰은 현재 앱 또는 브라우저의 저장 공간에 보관됩니다. 기기와 브라우저에 따라 홈 화면 앱의 저장 공간이 분리될 수 있습니다.

## 로컬 실행

```sh
node scripts/refresh-offline-cache.mjs
python3 -m http.server 8000 --directory dist
```

브라우저에서 http://localhost:8000 을 엽니다.

## Cloudflare 배포

Cloudflare 계정으로 인증한 뒤 프로젝트 루트에서 실행합니다.

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

Wrangler는 `dist` 디렉터리를 Workers Static Assets로 배포합니다. 배포 전에 앱 파일의 해시를 계산해 오프라인 캐시 버전을 자동으로 갱신합니다.
