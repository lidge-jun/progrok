# wp4 실행 계획 (diff-level) — 챗·미디어 런타임 + 톱바 데이터

[060_chat_media.md](060_chat_media.md)를 P에서 재검증했다. 041 v2 재절단에 따라 이 phase는 런타임만 맡는다.
마크업/CSS는 wp2가 끝냈다. 새 마크업이 필요한 곳은 런타임이 DOM을 생성하고 기존 클래스로 스타일링한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `client/chat.ts` | 스크롤 추종 + "New response" 어포던스 |
| `client/media.ts` | 결과 provenance (모델·옵션·실측 소요시간) |
| `client/app.ts` | 톱바 런타임 값 주입, 패널별 오류 경계 + 재시도 |

`client/render.ts`는 변경하지 않는다. `article[data-status]` 6종을 이미 쓰고 있고
wp2가 6종 전부에 CSS를 붙였다.

## chat.ts — 스크롤 추종 (FE-SCROLL-01)

현재 `renderMessages()`는 매 렌더마다 무조건 `scrollTop = scrollHeight`다(chat.ts:315).

- 렌더 직전 `scrollHeight - scrollTop - clientHeight <= 48`이면 추종, 아니면 위치 보존.
- 내용이 실제로 늘었을 때만(렌더 전후 `scrollHeight` 비교) 어포던스를 띄운다.
- `#chat-jump` 클릭 시 바닥으로 이동하고 버튼을 숨긴다. 마크업은 wp2가 이미 만들었다.
- 사용자가 바닥 근처로 스크롤하면 `scroll` 리스너가 버튼을 숨긴다.
- `ChatElements`에 `jump: HTMLButtonElement` 추가.
- 새 청크 도착만으로 포커스를 옮기지 않는다 (FE-STREAM-06).

## media.ts — provenance (FE-MEDIA-02)

제출 직전 `performance.now()`를 잡고 완료 시 실측 경과를 기록한다. 남은 시간을 추정하지 않는다.

- 이미지: 각 `figure`에 `figcaption`을 항상 붙인다. 모델 id, 장수, 실측 소요초.
  revisedPrompt가 있으면 별도 줄로 덧붙인다.
- 비디오: 현재 `video`를 results에 직접 넣는다(media.ts:149). `figure`로 감싸고
  모델 id, duration, aspect, resolution, 실측 소요초, job id를 캡션에 쓴다.
- 캡션 값은 전부 실제 제출 파라미터와 실측 시간이다.

## app.ts — 톱바 런타임 값 (005 B7-b)

사실 3종만, 관측된 뒤에만 표시한다.

| 행 | 값 | 시점 |
|---|---|---|
| `#rt-endpoint` | `location.origin + "/v1"` | 부팅 즉시 |
| `#rt-catalog` | `N models` / 실패 시 `unavailable` | `listModels()` 결과 관측 후 |
| `#rt-model` | `#chat-model`의 현재 값 | 챗 초기화 후 + change 이벤트 |

각 행의 wrapper(`#rt-endpoint-row` 등)는 값이 정해질 때만 hidden을 푼다.
카탈로그 실패 시 unavailable만 쓰고 원인을 단정하지 않는다.

## app.ts — 패널별 오류 경계 (FE-ERROR-02)

현재 `/v1/models` 실패 하나가 챗·미디어를 통째로 전역 fatal 배너에 묶는다(app.ts:64-69).

- 전역 `#fatal-error`는 필수 엘리먼트 누락 같은 부팅 불능에만 남긴다.
- 카탈로그 실패는 챗 패널과 미디어 패널 각각에 인라인 오류 + Retry 버튼을 넣는다.
  요소는 런타임이 생성하고 기존 `.banner` 클래스를 쓴다. 마크업은 건드리지 않는다.
- Retry는 `listModels()`를 다시 호출하고 성공하면 해당 컨트롤러를 그 자리에서 초기화한다.
- 보이스 패널은 카탈로그와 무관하므로 계속 동작해야 한다. 이미 그렇다(app.ts:24-35).
- 재시도 중에는 버튼을 비활성화하고 상태를 알린다.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- 하네스에서 실제 스트리밍 응답을 받아 바닥 추종, 위로 스크롤 시 위치 보존 + 어포던스 노출, 어포던스 클릭 복귀를 실측
- 하네스를 `PROGROK_HARNESS_FAIL_CATALOG=1`로 재기동해 패널별 오류 + 재시도 실측
- 이미지 생성으로 provenance 캡션 실측


---

# wp4 감사 반영 (A-phase fold)

## G1. `#chat-jump` 배선 명시

`ChatElements`에 `jump`를 추가하고 `app.ts`의 chat 생성 블록에
`jump: required("#chat-jump")`를 넣는다. 마크업은 wp2가 `hidden`으로 만들어뒀다.

## G2. provenance 스냅샷

완료 시점에 DOM을 읽으면 사용자가 실행 중 모델/옵션을 바꿨을 때 캡션이 거짓이 된다.
`run()` 진입 직후 **불변 스냅샷**을 만들고 캡션은 스냅샷만 참조한다.

```ts
const request = Object.freeze({
  kind: this.el.kind.value,
  model: this.el.model.value,
  prompt: this.el.prompt.value,
  count: this.formNumber("#image-count", 1),
  duration: this.formNumber("#video-duration", 5),
  aspect: this.formValue("#video-aspect", "16:9"),
  resolution: this.formValue("#video-resolution", "480p"),
  startedAt: performance.now(),
});
```

제출 호출도 스냅샷 값을 쓴다. 현재처럼 호출 시점에 DOM을 다시 읽지 않는다.

## G3. 독립 오류 경계

현재 `app.ts`는 chat과 media를 하나의 `try`에 넣어 chat 실패가 media 생성을 막는다.

```ts
const models = await loadCatalog();          // 한 번만 호출
await mountChat(models);                     // 자체 try/catch
mountMedia(models);                          // 자체 try/catch
```

- 카탈로그 호출은 1회. 결과(성공/실패)를 두 마운트에 각각 전달한다.
- 각 패널은 자기 실패만 자기 배너로 표시한다. 한쪽 실패가 다른 쪽을 가리지 않는다.
- 배너는 마운트 함수가 소유한다. 재시도 전에 **기존 배너를 제거**하고 컨트롤러를 새로 만든다.
- 중복 바인딩 방지: 각 패널에 `mounted` 플래그를 두고 이미 마운트됐으면 재시도를 무시한다.
  `ChatController`/`MediaController`는 생성자에서만 리스너를 붙이므로 재생성이 곧 재바인딩이다.
- 재시도 중에는 버튼 `disabled` + 상태 문구를 바꾼다.

## G4. 하네스 fail-once

현재 하네스는 환경변수가 켜져 있으면 영구 실패라 "실패 후 재시도 성공"을 증명할 수 없다.

- `PROGROK_HARNESS_FAIL_CATALOG=once` → 첫 호출만 500, 이후 정상.
- `PROGROK_HARNESS_FAIL_CATALOG=1` → 계속 실패(영구 실패 상태 캡처용).
- 하네스는 QA 전용이며 운영 코드가 아니다.

## G5. 렌더 비용 (비블로커, 기록)

스트리밍 중 매 청크마다 `renderMessages()`가 전체 메시지를 `replaceChildren`로 재생성한다.
이번 phase의 범위(스크롤 추종)를 넘어서므로 바꾸지 않는다. 증분 렌더는 별도 단위로 남긴다.


## G3-b. 리스너 해제 (재감사 잔여 지적)

`mounted` 플래그만으로는 `init()`가 중간에 실패한 경우를 막지 못한다.
`bind()`가 이미 리스너를 붙인 뒤 `persist()`나 `render()`가 던지면 재시도가 중복 바인딩을 만든다.

해결: **마운트마다 `AbortController`를 만들고 모든 `addEventListener`에 `{ signal }`를 넘긴다.**
재시도 직전에 이전 마운트의 컨트롤러를 `abort()`하면 브라우저가 리스너를 전부 떼어낸다.
부분 실패 여부와 무관하게 멱등이다.

- `ChatController`는 생성자에서 `AbortSignal`을 받아 `bind()`의 모든 등록에 전달한다.
- `MediaController`도 동일하게 `init()`의 등록에 전달한다.
- `app.ts`의 각 마운트 함수가 자기 `AbortController`를 소유하고, 재시도 시 `abort()` 후 새로 만든다.

