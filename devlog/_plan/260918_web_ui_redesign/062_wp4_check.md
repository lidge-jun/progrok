# wp4 검증 기록

하네스 `PROGROK_HARNESS_FAIL_CATALOG=once`, backend: mock.

## 패널별 오류 경계 + 재시도 (FE-ERROR-02)

| 시점 | 관측 |
|---|---|
| 첫 로드 (카탈로그 500) | `rt-catalog = "unavailable"`, 챗 패널과 미디어 패널 **각각** 자기 배너 + Retry, 보이스 패널은 계속 동작(`#voice-start` 활성) |
| Retry 클릭 후 | `rt-catalog = "6 models"`, 두 배너 모두 제거, `#chat-model` 옵션 4개, Send 활성, `rt-model = "grok-4.3"` |

전역 fatal 배너는 뜨지 않았다. 카탈로그 실패가 더 이상 워크스페이스 전체를 가리지 않는다.

## 스크롤 추종 (FE-SCROLL-01)

| 상황 | 관측 | 판정 |
|---|---|---|
| 바닥에서 스트리밍 | `distanceFromBottom = 0`, jump 숨김 | 추종 |
| 위로 스크롤 후 새 응답 도착 | `scrollTop`이 0으로 **유지**, `distanceFromBottom = 1351`, jump 노출 | 위치 보존 |
| "New response" 클릭 | `distanceFromBottom = 0`, jump 숨김 | 복귀 |

## 렌더 중 발견한 레이아웃 버그 (wp2 소유 CSS, 여기서 수정)

짧은 뷰포트(525px)에서 `#chat-panel` 높이가 **1621px**로 계산돼 메시지 영역이 스크롤되지 않고
페이지 전체가 넘쳤다. 원인은 `.shell`의 암묵 행과 `.workspace`가 그리드 아이템 기본값
`min-height: auto`를 가져 콘텐츠만큼 늘어난 것이다.

수정: `.shell`에 `grid-template-rows: minmax(0, 1fr)`, `.rail`·`.workspace`에 `min-height: 0`.

수정 후: 패널 477px, `#messages` clientHeight 317 / scrollHeight 1461, 문서 오버플로 0.

wp5가 아니라 wp4에서 고친 이유는 이 버그가 wp4 자체의 완료 기준(c-3 스크롤 추종)을 검증 불가능하게
만들었기 때문이다. 스코프 이탈을 여기 기록한다.

추가로 톱바 런타임 값이 1125px에서 심하게 잘려 `#rt-endpoint-row`를 80rem 미만에서 숨기도록 조정했다.

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 234 / pass 234 / fail 0

## provenance (FE-MEDIA-02)

`run()` 진입 직후 모델·옵션·프롬프트·시작시각을 `Object.freeze` 스냅샷으로 고정하고
제출과 캡션 모두 스냅샷만 참조한다. 실행 중 컨트롤을 바꿔도 캡션이 거짓이 되지 않는다.
실측 소요초만 기록하고 남은 시간을 추정하지 않는다.
**미디어 결과 캡션은 이번 세션에서 실제 생성으로 확인하지 못했다 (UNVERIFIED)** — 하네스의 이미지 모의 응답은
data URL SVG라 실제 xAI 응답 형태와 다르고, 영상 폴링은 완료 상태를 반환하지 않는다. wp5에서 하네스를
보강해 확인한다.

