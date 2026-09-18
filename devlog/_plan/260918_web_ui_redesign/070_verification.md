# wp5 — 검증

이 phase는 **검증 전용**이다. 결함을 발견하면 소유 work-phase로 되돌린다.

## 1. 하네스

```
npm run build                    # dist/public/assets/{app.js,pcm-worklet.js} 생성
node devlog/_plan/260918_web_ui_redesign/harness/serve.mjs
```

하네스는 `dist/public`을 정적 서빙하고 아래 엔드포인트만 모의한다. 운영 코드(src/)는 건드리지 않는다.

| 목적 | 엔드포인트 |
|---|---|
| 카탈로그 | `GET /v1/models` |
| 챗 스트리밍 | `POST /v1/responses` (SSE) |
| 이미지 | `POST /v1/images/generations` |
| 비디오 | `POST /v1/videos/generations`, `GET /v1/videos/:id` |
| 보이스 시크릿 | `POST /v1/realtime/client_secrets` |

## 2. 캡처 매트릭스

뷰포트: 320 / 390 / 768 / 1024 / 1440 / 1600.

| 화면 | 상태 |
|---|---|
| chat | empty, streaming, complete, stopped, failed, catalog-error+retry |
| voice | idle, requesting-permission, connecting, listening, speaking, stopped, failed, muted |
| media | idle, running(video progress), completed(image), failed |
| 공통 | 탭 키보드 포커스, 선택 탭, disabled 컨트롤, reduced-motion |

**보이스의 listening/speaking/muted는 런타임이 아니라 정적 상태 하네스로 캡처한다.**
`connect-src`가 `wss://api.x.ai`로 고정돼 있고 운영 코드에 dev 오버라이드를 넣지 않기 때문이다(005 B6).
각 캡처에 `fixture: static state harness`를 명시한다. 런타임 증거와 섞어 주장하지 않는다.

## 3. 게이트

```
npm run typecheck
node scripts/run-tests.mjs
```

## 4. 정적 점검

| 점검 | 방법 |
|---|---|
| emoji 0개 | `src/web` 전체 grep |
| inline style/script 0개 | `style=`, `<script>` 인라인 grep |
| 외부 리소스 0개 | `http://`, `https://` 참조 grep (CSP 허용 목록 제외) |
| `100vh` 0개 | grep |
| `transition: all` 0개 | grep |
| 필수 DOM ID 28개 | 010 문서 표와 대조 |
| CSP 위반 0건 | 브라우저 콘솔 |

## 5. 보고

각 캡처를 `checked / issue / unverified / n-a`로 기록하고 경로를 남긴다.
실행하지 못한 항목은 실패한 명령이나 누락된 fixture를 적어 `UNVERIFIED`로 남긴다.
정적 코드 검토를 렌더 검증으로 대체하지 않는다 (FE-VISUAL-REPORT-01).

