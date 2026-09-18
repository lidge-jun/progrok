# wp4 — 챗과 미디어 서피스

소유 파일: `index.html` chat/media 패널, `style.css`의 `.chat-*`/`.media-*`/`.message*` 섹션,
`client/chat.ts`, `client/media.ts`, `client/render.ts`, `client/app.ts`.

## 1. 챗

- 패널 소개 문단과 h1 제거. 상단은 compact toolbar 한 줄(모델 select + 상태)만 남긴다.
- 메시지 최대폭 `68ch`. 사용자 메시지는 우측 정렬 버블, 어시스턴트는 좌측 평문.
- `article[data-status]`의 6개 상태(composing/queued/streaming/complete/stopped/failed)에 각각 시각 처리를 준다.
  현재 CSS는 3개만 소비한다.
- **스크롤 추종 (FE-SCROLL-01)**: `chat.ts:301`의 무조건 바닥 이동을 교체한다.
  렌더 직전 `scrollHeight - scrollTop - clientHeight <= 48`이면 추종, 아니면 위치 보존.
  보존 중이고 새 메시지가 있으면 하단에 "New response" 버튼을 띄운다.
- 컴포저: `textarea` 자동 높이(최대 12rem), Cmd/Ctrl+Enter 전송 유지, send/stop 교대 유지.
- reasoning과 tool-call `details`는 좌측 accent bar 하나로만 강조한다. 카드로 만들지 않는다 (FE-CARD-01).

## 2. 미디어

- 소개 문단과 h1 제거.
- `.media-options--image` / `.media-options--video` 계약 유지(label과 control 양쪽).
- `<progress>` 타입 유지. video만 표시, indeterminate 전환 유지.
- **provenance (FE-MEDIA-02)**: 결과 `figcaption`에 모델 ID, 옵션(개수/길이/비율/해상도), 실제 소요 시간을 기록한다.
  소요 시간은 제출~완료 실측이다. 남은 시간을 추정하지 않는다.
- 결과 그리드는 이미지 개수에 따라 열 수가 달라진다. 1장이면 크게, 여러 장이면 격자.

## 3. 오류 경계 (FE-ERROR-02)

현재 `app.ts:64-69`는 `/v1/models` 실패 하나로 전체를 fatal 배너에 묶는다.

변경:

- 전역 fatal 배너는 **부팅 자체가 불가능할 때만** 남긴다.
- 카탈로그 실패는 chat 패널과 media 패널 각각의 인라인 오류 + "Retry" 버튼으로 표시한다.
- 재시도는 `listModels()`를 다시 호출하고 성공하면 해당 컨트롤러를 그 자리에서 초기화한다.
- 보이스 패널은 카탈로그와 무관하므로 계속 동작해야 한다. 지금도 그렇다(app.ts:24-35).

## 4. 세션 rail

- `#session-list` 버튼 재생성 계약 유지, `aria-current` 유지.
- 활성 항목은 좌측 2px accent bar + 배경 tint. 글자색만 바꾸지 않는다.
- 768 미만에서 가로 스크롤 스트립으로 전환한다.

