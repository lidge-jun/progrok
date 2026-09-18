# wp13 — 모듈화 잔여: c-13 을 정직하게 닫는다

> 이 문서는 감사 1회 FAIL 후 전면 재작성됐다. 초판의 오류는 맨 아래 "철회" 절에 남긴다.

## 왜 아직 안 끝났나

wp11 에서 `ws-client.ts` 438 → 9 (facade) + 3개 리프로 갈랐다. c-13 이 말하는
"400줄 초과 모듈 3개" 중 둘이 그대로다.

| 모듈 | wp11 전 | 지금 | 상태 |
|---|---|---|---|
| `src/voice/ws-client.ts` | 438 | 9 | 끝남 |
| `src/web/client/voice.ts` | 595 | **549** | 줄기만 했다 |
| `src/wire/tool-calls.ts` | 458 | **458** | 손도 안 댐 |

## 기준은 줄 수가 아니다

`dev-scaffolding` §9 의 400줄은 **split smell** 이지 하드 게이트가 아니고, `dev` §0.2 는
파일 크기 임계값을 DEFAULT/STYLE_SAMPLE 로 분류한다. c-13 의 문구도 "책임 단위로 분할"
이지 "각 파일이 400줄 미만" 이 아니다.

초판은 "줄 수가 목적이 아니다" 라고 써놓고 바로 다음 절에서 `voice.ts` 549 → 400 미만을
목표로 걸었다. 자기모순이었고, 감사가 **산술적으로 불가능하다**는 것까지 계산해 보였다.
목표를 철회한다. 이 단위의 합격 기준은 **떼어낸 것이 실제로 다른 책임인가** 다.

## (1) `voice.ts` — 오케스트레이션과 패널 렌더링

> **2차 감사 반영:** 초안의 패널 범위는 얕았다. 감사 판정은 "추출 후에도 컨트롤러가
> 같은 `VoiceElements` DOM 을 7곳에서 계속 쓰므로 책임 경계가 아니다" 였고, 맞다.
> 감사가 준 두 선택지 — **전체 패널 렌더링 API 로 확장**하거나 **549줄 예외를 정직하게
> 유지** — 중 전자를 택한다. 아래 범위는 그에 맞춰 넓어졌다.

`VoiceController` 는 두 가지를 한다.

**A. 세션/전송 오케스트레이션** — 마이크 권한, 시크릿 발급, 소켓 개폐, AudioContext 와
worklet 배선, 프로토콜 이벤트 분기, 생명주기(`#generation`, `#connectionAbort`).

**B. 패널 DOM 렌더링** — 경과 시간 시계, 디바이스 라벨, 온/오프라인, 이벤트 로그,
뮤트 버튼 ARIA, 트랜스크립트 쓰기.

### NEW `src/web/client/voice-panel.ts` — DOM 의 유일한 소유자

원칙: **`VoiceElements` 를 쓰는 코드는 이 파일에만 있다.** `voice.ts` 는 `this.el.…` 을
한 번도 쓰지 않게 된다. 그게 이 분할이 진짜인지 판별하는 기계적 기준이고,
`rg -n "this\\.el\\." src/web/client/voice.ts` 가 **0건**인 것으로 증명한다.

| 옮기는 것 | 현재 위치 |
|---|---|
| `VoiceElements` 인터페이스 | `voice.ts:40-68` |
| `STATUS_COPY` | `voice.ts:25-35` |
| `EVENT_LOG_LIMIT`, `FOLLOW_THRESHOLD_PX` | `voice.ts:37-38` |
| `followBottom` | `voice.ts:70-75` |
| `renderMute` | `voice.ts:239-253` |
| `beginSessionClock` / `renderElapsed` / `stopSessionClock` | `voice.ts:255-273` |
| `renderDevice` / `renderNetwork` | `voice.ts:275-286` |
| `recordEvent` | `voice.ts:288-304` |
| `writeUserTranscript` / `writeAssistantTranscript` / `appendAssistantTranscript` | `voice.ts:455-471` |
| `syncControls` | `voice.ts:523-534` |
| `setStatus` | `voice.ts:536-541` |

옮기는 상태: `#elapsedTimer`, `#startedAt`, `#status`, `#available`. 전부 화면 상태다.

컨트롤러에 흩어져 있던 나머지 DOM 쓰기도 패널 메서드로 흡수한다. 감사가 짚은 7곳이다.

| 현재 | 새 패널 메서드 |
|---|---|
| `voice.ts:105-109` 가용성/초기 상태 문구 | `init(available: boolean)` |
| `voice.ts:133-139` 트랜스크립트·이벤트로그 초기화 | `resetForSession()` |
| `voice.ts:319-321` transport/endpoint 표시 | `renderEndpoint(host: string)` |
| `voice.ts:363-364` 샘플레이트 표시 | `renderRate(rate: number)` |
| `voice.ts:406` user transcript final 표시 | `markUserFinal(final: boolean)` |
| `voice.ts:428,436` assistant turn interrupted 표시 | `markInterrupted(value: boolean)` |
| `voice.ts:437` assistant transcript 비우기 | `resetAssistantTranscript()` |
| `voice.ts:110-117` 버튼/셀렉트 이벤트 바인딩 | `bindControls(handlers)` |

### DOM **읽기**도 패널을 통한다

3차 감사의 High 지적이다. 초안은 DOM 쓰기만 세고 **읽기**를 빠뜨렸다. 이것들이 남으면
`this.el.` 0건은 달성되지 않는다.

| 현재 읽기 | 새 패널 API |
|---|---|
| `voice.ts:149, 203, 212, 224` `el.mode.value` | `get mode(): VoiceMode` |
| `voice.ts:313` `el.model.value.trim()` | `get model(): string` (trim 까지 패널이 한다) |
| `voice.ts:327` `el.voice.value` | `get voice(): string` |
| `voice.ts:125` 가용성 검사 | `get available(): boolean` |
| `voice.ts:177, 219, 335, 438` `#status` 읽기 | `get status(): VoiceStatus` |
| `voice.ts:360` `createVoiceMeter(el.inputMeter, el.outputMeter)` | `createMeter(): VoiceMeter` |

`createMeter` 는 패널이 자기 DOM 노드 두 개로 미터를 만들어 돌려준다. 오디오 분석기를
붙이는 것(`attachInput`/`attachOutput`)은 컨트롤러가 한다 — 그쪽이 `AnalyserNode` 를
소유하기 때문이다. 그래서 `voice-panel.ts` 는 `voice-meter.js` 를 import 하지만
`AudioContext`/`AnalyserNode` 를 직접 만들지는 않는다.

### window 리스너는 컨트롤러가 유지한다

3차 감사의 두 번째 High. 초안은 `110-118` 을 통째로 `bindControls` 로 묶었는데
`:118` 은 이미 `window` 의 `online` 리스너다. `bindControls` 가 맡는 것은
**`110-117` 의 컨트롤 요소 리스너만**이다 (`start`, `finish`, `stop`, `mute`, `mode`).

`window` 세 개는 컨트롤러에 남는다. 스트림 상태를 아는 쪽이 컨트롤러이기 때문이다.

| 리스너 | 현재 | 바뀐 뒤 |
|---|---|---|
| `online` `voice.ts:118` | `this.renderNetwork()` | `this.#panel.renderNetwork(Boolean(this.#stream))` |
| `offline` `voice.ts:119` | `this.renderNetwork()` | 같음 |
| `beforeunload` `voice.ts:120` | `void this.stop(false)` | 그대로 |

`bindControls` 는 DOM 노드에 리스너를 다는 일이라 패널 몫이고, 핸들러 **본문**은
컨트롤러가 준다. 콜백 객체 하나(`{ onStart, onFinish, onStop, onToggleMute, onModeChange }`)
로 넘긴다.

**`#stream` 의존을 인자로 바꾼다.** 1차 감사가 잡은 대목이다. 초판은 `renderMute`/`renderDevice`
둘만 인자화하고 `renderNetwork` 가 `#stream` 을 읽는 것(`voice.ts:282`)을 놓쳤다. 셋 다 고친다.

| 메서드 | 지금 읽는 것 | 바뀐 시그니처 |
|---|---|---|
| `renderMute` | `this.#stream` 존재 여부 | `renderMute(active: boolean, muted: boolean)` |
| `renderDevice` | `this.#stream` 트랙 라벨 | `renderDevice(label: string)` |
| `renderNetwork` | `this.#stream` 존재 여부 | `renderNetwork(hasStream: boolean)` |

`toggleMute` 는 오디오 트랙을 만지므로 컨트롤러에 남고 패널의 `renderMute` 를 호출한다.
패널은 소켓도 스트림도 AudioContext 도 모른다.

**`#muted` 는 컨트롤러에 남는다.** 2차 감사가 잡았다. 초판은 `#muted` 를 패널로 옮긴다면서
동시에 `renderMute(active, muted)` 로 값을 넘긴다고 해서 소유권이 모순이었다. `#muted` 는
오디오 트랙의 `enabled` 와 짝이고 `toggleMute`(231)·`start`(134)·`stopMedia`(516) 가
전부 컨트롤러 쪽이다. 컨트롤러가 소유하고 패널은 **받아서 그리기만** 한다.

`#status` 는 반대로 패널이 소유한다. 3차 감사 정정: 컨트롤러의 읽기는 "onOpen 에서 한 번"
이 아니라 **네 곳**이다 — `closeSocket`(177), `stop`(219), 재생 완료 콜백(335),
`response.created`(438). 네 곳 모두 `this.#panel.status` 로 바꾼다.
`syncControls` 안의 읽기(528-533)는 패널로 같이 가므로 자동으로 해소된다.
### `VoiceElements` 소유권

감사가 잡은 두 번째 대목. 타입이 `voice.ts` 의 export 인데 패널이 그걸 쓰면서 동시에
`voice.ts` 를 import 하지 않을 수는 없다. **타입을 `voice-panel.ts` 로 옮기고 `voice.ts` 가
재수출한다.**

```ts
// voice.ts
export type { VoiceElements } from "./voice-panel.js";
```

`rg` 로 확인한 실제 소비자는 없다 — `app.ts:66` 은 객체 리터럴을 넘기므로 구조적 타이핑이라
타입을 import 하지 않는다. 그래도 공개 export 는 보존한다.

### 예상 결과 — 줄 수를 약속하지 않는다

2차 감사는 초판의 "~450" 산술도 틀렸다고 지적했다(실제 명시 범위는 123줄, 549-123=426,
거기에 접착 코드가 붙는다). 맞다. 그래서 **이 계획은 결과 줄 수를 목표로 걸지 않는다.**
범위가 넓어졌으니 더 줄겠지만 정확한 값은 구현 후 `wc -l` 로 기록한다.

합격 기준은 줄 수가 아니라 이것이다:

1. `rg -n "this\\.el\\." src/web/client/voice.ts` → **0건** (DOM 소유권이 완전히 넘어갔다)
2. `voice-panel.ts` 가 `WebSocket`/`MediaStream`/`AudioContext` 를 언급하지 않는다
3. 공개 export 와 동작이 보존된다

`onMessage`/`onSttEvent`/`onRealtimeEvent` 는 그대로 둔다. `fail`, `cancelPlayback`,
`#playback`, `#conversationId` 를 참조하므로 콜백 인터페이스를 만들어 뽑으면 간접층만
늘고 읽기는 더 어려워진다. 다만 이들 안의 **DOM 쓰기 3줄**은 위 표대로 패널로 간다.

## (2) `tool-calls.ts` — 초판의 분할선을 버린다

초판은 클래스 밖 검증 헬퍼 8개를 옮기자고 했다. 감사 판정: **"책임 분리보다 줄 수 절단에
가깝다"**. 맞는 지적이다. 실제 와이어 검증은 `ingestChat`(114), `ingestResponsesItem`(165),
`flush`(259) 안에 그대로 남고, 새 모듈은 소비자 하나짜리 얕은 헬퍼 묶음이 된다.

파일을 다시 읽고 **진짜 경계**를 찾았다. 클래스 안에 두 층이 있다.

**층 1 — 와이어 해석**: `ingestChat`, `ingestResponsesItem`, `ingestResponsesDelta`,
`completeResponsesItem`, `flush`. "들어온 프레임이 무엇을 말하는가."

**층 2 — 미완성 콜의 별칭 레지스트리**: `#calls`, `#byIndex`, `#byOutputIndex`,
`#byItemId`, `#byId`, `#nextKey`, `#totalBytes` 와 그것들을 지키는
`#createCall`(303), `#resolveChat`(316), `#resolveResponses`(329), `#bindIndex`(348),
`#bindId`(361), `#bindResponseId`(382), `#bindName`(396), `#bindItemId`(408),
`#bindOutputIndex`(420), `#appendArguments`(435). "이 조각이 **어느 콜**에 속하는가."

층 2 는 다섯 개의 인덱스 맵과 그 사이의 불변식(같은 콜이 index·id·item_id·output_index
어느 쪽으로 들어와도 하나로 모이고, 서로 다른 콜로 갈리면 충돌로 던진다)을 가진
자족적인 자료구조다. 층 1 은 그걸 "어느 콜인지 알려줘" 로만 쓴다.

### NEW `src/wire/tool-call-wire.ts`

`ToolCallWireError`(5-18), `isRecord`(36-38), `valueType`(40-42), `invalid`(44-54),
`readOptionalString`(56-66), `readIndex`(68-74), `assertArgumentsObject`(76-94),
`readRequiredNonBlankString`(455-458).

이게 필요한 이유는 층 2 도 충돌 시 `ToolCallWireError` 를 던지기 때문이다. 에러 타입이
`tool-calls.ts` 에 남으면 레지스트리 → 퍼사드 역참조가 생겨 순환이 된다. 그래서
**에러와 필드 판독기를 공통 리프로 내린다.** 초판처럼 "헬퍼니까 모은다" 가 아니라
순환을 피하려는 구조적 이유다.

### NEW `src/wire/pending-call-registry.ts`

`PendingCall` 타입(`tool-calls.ts:24-34`)과 위 층 2 전체. `PendingCallRegistry` 클래스로
노출하고 `resolveChat`/`resolveResponses`/**`resolveDelta`**/`bind*`/`appendArguments`/
`clear`/`pendingCount`/`values` 를 공개 메서드로 만든다.

**`resolveDelta` 를 빠뜨렸던 것이 2차 감사의 High 지적이다.** `ingestResponsesDelta` 는
`#byItemId`(203) 와 `#byOutputIndex`(206) 를 **직접** 조회해 충돌·미존재를 판정한다.
그 로직을 대체할 API 가 없으면 맵을 밖으로 노출해야 하고, 그러면 자족적인 레지스트리가
아니다. 그래서:

```ts
resolveDelta(itemId: string | undefined, outputIndex: number | undefined): PendingCall
```

별칭 충돌("function call aliases conflicted")과 미존재("function call delta had no matching
item")를 **레지스트리 안에서** 던진다. 별칭 불변식은 별칭을 소유한 쪽이 지키는 게 맞다.

`maxBytes` 는 생성자로 받는다. 기본값 적용과 `Number.isSafeInteger` 검증은
`ToolCallAssembler` 생성자(`tool-calls.ts:106`)에 **남기고** 검증된 값만 넘긴다.
옵션 파싱은 어셈블러 계약이고 레지스트리는 숫자 하나만 알면 된다.

### `tool-calls.ts` 에 남는 것

`DEFAULT_MAX_TOOL_CALL_BYTES`(3), `ToolCallAssemblerOptions`(20-22), `ToolCallAssembler`
의 공개 메서드(층 1). 감사가 물은 `DEFAULT_MAX_TOOL_CALL_BYTES` 소유권은 **여기**다 —
검증이 아니라 어셈블러 설정이다.

(2차 감사 정정: 초판은 `ToolCallAssemblerOptions` 를 `20-34` 라고 썼는데 실제로는
`20-22` 이고 `24-34` 는 별도 `PendingCall` 타입이다. `PendingCall` 은 레지스트리로 간다.
초판 표기는 두 파일의 소유권을 겹치게 만들고 있었다.)

`ToolCallWireError` 는 `tool-call-wire.js` 에서 가져와 **재수출**한다.

### 공개 계약을 깨지 않는다

`tool-calls.js` 를 import 하는 곳은 정확히 셋이고, 가져가는 심볼은 이렇다.

| 파일 | 가져가는 것 |
|---|---|
| `src/wire/chat-stream.ts:12` | `ToolCallAssembler`, `ToolCallWireError`, `ToolCallAssemblerOptions` |
| `src/wire/responses-stream.ts:12` | 같음 |
| `tests/tool-calls.test.ts:6` | `ToolCallAssembler`, `ToolCallWireError` |

세 파일은 **한 줄도 고치지 않는다.** 고쳐야 한다면 계약을 깬 것이고 실패다.
`git diff --stat` 으로 변경 0줄을 증명한다.

## 경계 테스트

`tests/module-boundaries.test.ts` 에 역-import 검사를 추가한다. 레이어 방향 검사
(`:83`) 는 같은 레이어 안의 import 를 건너뛰므로 — 새 파일들은 전부 같은 레이어다 —
**별도 assertion 으로** 넣어야 한다. 감사가 짚은 대로다.

- `voice-panel.ts` 가 `./voice.js` 를 import 하지 않는다
- `pending-call-registry.ts` 와 `tool-call-wire.ts` 가 `./tool-calls.js` 를 import 하지 않는다
- `voice.ts` 소스에 `this.el.` 이 0건이다 (DOM 소유권 이전의 기계적 증거)
- `voice-panel.ts` 소스에 `WebSocket`/`MediaStream`/`AudioContext` 가 0건이다

### 패널 동작 회귀 테스트

2차 감사가 "역-import 검사만으로는 동작 회귀를 못 잡는다" 고 지적했다. 맞다.
**NEW `tests/voice-panel.test.ts`** 를 만든다.

기존 `tests/voice-meter.test.ts` 는 DOM 을 만들지 않고 순수 함수만 테스트한다.
이 저장소에는 jsdom 이 없고 의존성 추가는 이 단위의 비대상이다. 그래서 패널 테스트는
`VoiceElements` 모양의 **가짜 엘리먼트**를 직접 만들어 넣는다.

3차 감사가 초안의 스텁 목록으로는 실행이 안 된다고 확인했다. 필요한 표면은 이렇다.

| 필요한 것 | 쓰는 곳 |
|---|---|
| `textContent`, `dataset`, `hidden`, `disabled` | 전반 |
| `setAttribute`, `querySelector` (`use` 반환) | `renderMute` |
| `value` (`mode`/`model`/`voice`) | `syncControls`, 읽기 getter |
| `replaceChildren`, `append` | `resetForSession`, `recordEvent` |
| `childElementCount`, `firstElementChild.remove()` | 이벤트 로그 상한 |
| `scrollTop`/`scrollHeight`/`clientHeight` | `followBottom` |
| `addEventListener` | `bindControls` |
| 전역 `document.createElement` | `recordEvent` (Node 에서 `document` 는 `undefined`) |

`document` 는 테스트 시작에 최소 스텁을 설치하고 끝나면 **원상 복구**한다
(`globalThis.document` 가 원래 없었으므로 `delete` 로 되돌린다).
`createMeter` 는 `AnalyserNode` 없이 생성 단계만 만지거나, 테스트에서 빼고 사유를 적는다.

검증할 동작:

- `renderMute(active, muted)` 가 `aria-pressed`/`aria-label`/`use[href]`/`dataset.muted`
  를 현재와 같게 쓴다
- `renderDevice(label)` 가 빈 라벨이면 행을 숨기고 아니면 표시한다
- `renderNetwork(hasStream)` 가 스트림 없고 transport 가 숨겨져 있으면 아무것도 안 한다
- `renderElapsed` 가 `m:ss` 로 0 패딩한다
- `recordEvent` 가 `EVENT_LOG_LIMIT` 을 넘으면 앞에서 지운다
- `setStatus` 가 `dataset.state` 와 문구를 쓰고 `syncControls` 를 부른다
- `followBottom` 이 임계값 안쪽이면 바닥을 따라가고 밖이면 위치를 보존한다

## 하지 않는 것

동작 변경, 공개 export 제거·개명, 의존성 추가, 400줄 미만 파일 건드리기, 레이어 배럴 신설,
`onMessage`/`onSttEvent`/`onRealtimeEvent` 추출(위 (1) 참조).
`auth ↔ utils` 순환은 범위 밖이고 `ALLOWED` 예외로 남는다.

## 검증

- `npm run typecheck` exit 0
- `node scripts/run-tests.mjs` **전부 통과** (신규 경계 테스트가 추가되므로 248 고정이 아니다)
- `npm run build` 성공, `node dist/index.js --version` → 3.0.0
- `git diff --stat` 에서 `chat-stream.ts`, `responses-stream.ts`, `tests/tool-calls.test.ts`,
  `src/web/client/app.ts` 가 **변경 0줄**
- `wc -l` 분할 전후 기록
- `rg -n "this\\.el\\." src/web/client/voice.ts` 가 0건

## 철회 — 초판의 오류

감사가 잡은 것을 그대로 남긴다.

| 초판 주장 | 실제 |
|---|---|
| `voice.ts` 를 400줄 미만으로 만든다 | 산술적으로 불가능. 줄 수 목표 자체를 철회했다 |
| 결과가 "대략 450" | 2차 감사: 명시 범위는 123줄이라 426 + 접착 코드. 예측 자체를 철회 |
| 패널로 옮길 멤버는 `this.el` 만 만진다 | `renderNetwork`(282) 도 `#stream` 을 읽는다 |
| 패널 추출이 렌더링 책임 경계다 | 2차 감사: 컨트롤러가 7곳에서 같은 DOM 을 계속 쓴다. 범위를 전체 DOM 소유로 넓혔다 |
| `#muted` 를 패널로 옮긴다 | 2차 감사: `toggleMute`/`start`/`stopMedia` 가 컨트롤러다. 컨트롤러에 남긴다 |
| `VoiceElements` 소유권 | 언급 자체가 없었다. 패널이 쓰려면 옮기고 재수출해야 한다 |
| `VoiceElements` `40-67` | `40-68` (닫는 중괄호 누락) |
| `tool-calls.ts` 는 검증 헬퍼를 떼면 된다 | 얕은 헬퍼 이동이다. 진짜 경계는 별칭 레지스트리다 |
| 레지스트리 공개 API 목록 | `resolveDelta` 누락. `ingestResponsesDelta` 가 맵을 직접 본다 |
| `ToolCallAssemblerOptions` `20-34` | `20-22`. `24-34` 는 `PendingCall` (레지스트리로 간다) |
| 상수 위치 `36-37` | `37-38` |
| 트랜스크립트 `455-473` | `455-471` (472 빈 줄, 473 은 `sendJson`) |
| `ToolCallWireError` `5-19` | `5-18` |
| `ToolCallAssembler` `96-454` | `96-453` |
| `voice-session.ts` 55줄 | 54줄 |
| 테스트 248건 유지 | 경계 테스트를 추가하므로 248 고정은 틀리다 |
| 신규 테스트는 역-import 만 | 동작 회귀를 못 잡는다. `tests/voice-panel.test.ts` 추가 |
| 패널 API 가 `this.el` 사용을 전부 덮는다 | 3차 감사: **읽기** 경로(mode/model/voice/meter/available)와 `:437` 누락. 읽기 getter 를 추가 |
| `voice.ts:110-118` 이 컨트롤 바인딩 | `:118` 은 이미 `window.online`. 컨트롤은 `110-117`, window 3개는 컨트롤러가 유지 |
| 컨트롤러의 `#status` 읽기는 한 곳 | 네 곳 (177, 219, 335, 438) |
| `syncControls` `523-533` / `setStatus` `535-540` | `523-534` / `536-541` |
| `init` `105-108` / reset `133-138` | `105-109` / `133-139` |
| 스텁 목록이 충분하다 | `value`, `childElementCount`, `firstElementChild`, `addEventListener`, 전역 `document` 가 더 필요 |
