# 기프티콘 포켓

기프티콘 이미지와 쿠폰 번호를 보관하고, 유효기간과 사용 여부를 확인하는 한국어 웹앱입니다. 쿠폰 데이터는 현재 브라우저의 IndexedDB에 저장됩니다. 기기 간 동기화는 지원하지 않으며, 사이트 데이터를 지우면 쿠폰도 삭제됩니다.

## 로컬 실행

```sh
python3 -m http.server 8000 --directory dist
```

브라우저에서 http://localhost:8000 을 엽니다.

## Cloudflare 배포

Cloudflare 계정으로 인증한 뒤 프로젝트 루트에서 실행합니다.

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

Wrangler는 `dist` 디렉터리를 Workers Static Assets로 배포합니다. 별도 빌드나 데이터베이스 설정은 필요하지 않습니다.
