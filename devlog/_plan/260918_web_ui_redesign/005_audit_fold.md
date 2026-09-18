# 감사 반영 (wp1 A-phase fold)

리뷰어 판정: **fail**. 블로커 7건 중 6건을 접어 넣고 1건을 근거와 함께 반박한다.
이 문서는 [000_roadmap.md](000_roadmap.md)를 보강하며, 충돌하는 부분은 **이 문서가 우선한다**.

## B2. 오디오 lifecycle 계약 (접음)

리뷰어 지적대로 삽입점만 정하고 소유권과 해제를 정하지 않았다. 다음을 고정한다.

| 항목 | 고정 |
|---|---|
| 입력 analyser 삽입점 | `createMediaStreamSource()` 직후, `source → worklet`과 **병렬**로 `source → analyser`. `worklet → gain(0) → destination` 뒤에 붙이면 측정값이 0이 되므로 금지 (voice.ts:214, 223, 224) |
| 출력 bus | `PcmPlaybackQueue`가 자신의 context에 bus `GainNode`를 1개 만들고 모든 `AudioBufferSourceNode`가 `source → bus → destination`을 거친다. analyser는 bus에서 분기 (pcm-playback.ts:32) |
| 소유자 | 입력 analyser는 `VoiceController`, 출력 bus/analyser는 `PcmPlaybackQueue`. meter 렌더러(`voice-meter.ts`)는 두 analyser를 **빌려 쓸 뿐 소유하지 않는다** |
| dispose 계약 | `voice-meter.ts`는 `dispose()`를 노출하고 rAF cancel + 참조 해제만 한다. 노드 `disconnect()`는 각 소유자가 한다 |
| 정리 지점 | `stopMedia()`(voice.ts:352-367)에서 입력 analyser disconnect + meter dispose. `PcmPlaybackQueue.dispose()`에서 bus/analyser disconnect |
| AudioContext 재생성 | start마다 새 `AudioContext`가 만들어진다(voice.ts:203). meter 노드를 이전 context와 **절대 재사용하지 않는다**. start 시 항상 새로 생성한다 |
| 인터럽션 | `speech_started`의 `cancelPlayback()`(voice.ts:270) 경로에서 출력 meter 값을 즉시 0으로 강제한다. analyser 감쇠를 기다리지 않는다 |
| 샘플레이트 의미 | 입력 analyser는 **하드웨어 sample rate 원본**이고 전송 PCM은 worklet에서 16/24kHz로 다운샘플된다(pcm-worklet.ts:23,36). 출력 PCM은 24kHz buffer로 만들어져 context rate로 재생 변환된다(pcm-playback.ts:24). 따라서 meter는 "전송 신호"가 아니라 "들리는 신호"를 표시한다고 문서화한다 |

## B3. 아이콘 전략 (접음)

**wp2가 소유한다.** `index.html` 최상단에 `<svg hidden>` 심볼 스프라이트를 인라인으로 두고 `<use href="#i-*">`로 참조한다.
인라인 SVG 엘리먼트는 `script-src` / `style-src` 대상이 아니므로 CSP를 위반하지 않으며, 외부 요청이 0이다.
외부 아이콘 CDN, 아이콘 폰트, emoji는 전부 금지 (FE-EMOJI-01, server.ts:18).
필요한 심볼은 최소한으로 고정한다: mic, mic-off, stop, send, square(중지), chevron, alert, check, wave.

## B4. 누락된 STRICT 항목 (접음 + 1건 반박)

| 규칙 | 처리 | 담당 |
|---|---|---|
| FE-VOICE-01 `muted` | **접음.** 실제 mute 토글을 추가한다. `MediaStreamTrack.enabled = false`로 구현하고 상태 칩에 반영 | wp3 |
| FE-VOICE-01 `device-preparing` | **접음.** 기존 `requesting-permission` → `minting-secret` → `connecting` 3단계가 이미 준비 단계를 분해하고 있으므로 라벨을 구체화해 충족 | wp3 |
| FE-VOICE-01 `processing` | **접음.** realtime에서 `response.created` 이후 첫 오디오 전까지를 `responding`으로 표시. 실제 이벤트 경계이므로 조작이 아니다 | wp3 |
| FE-VOICE-01 `reconnecting` | **반박.** 클라이언트에 재연결 로직이 **없다**(voice-socket.ts 전체). 없는 상태를 UI에 그리는 것은 FE-AI-HONESTY-01 정면 위반이다. 자동 재연결 구현은 전송 계층 변경이라 이 리디자인 범위 밖이다. **N/A로 기록하고 사유를 남긴다** | — |
| FE-LIVE-01 | **접음(축소).** 실데이터만 표시한다: 세션 경과 시간, 마지막 수신 이벤트 타입+시각, 입력 디바이스 라벨, `navigator.onLine` 오프라인. backoff/stale은 재연결이 없으므로 N/A | wp3 |
| FE-SCROLL-01 | **접음.** `chat.ts`를 wp4 스코프에 추가. 현재 무조건 바닥 이동(chat.ts:301)을 "하단 근처일 때만 추종 + 새 메시지 어포던스"로 교체 | wp4 |
| FE-ERROR-02 | **접음.** `app.ts`를 wp4 스코프에 추가. `/v1/models` 실패를 전역 fatal 대신 패널별 오류 + 재시도로 분리 | wp4 |
| FE-MEDIA-02 | **접음.** `media.ts`를 wp4 스코프에 추가. 결과 figure에 모델·옵션·소요시간 provenance를 실제 값으로 기록 | wp4 |
| FE-RESP-01~05 | **접음.** 브레이크포인트 전환을 wp2 산출물로 고정: 640 미만, 640, 768, 1024, 1280, 1536 | wp2 |
| 검증 뷰포트 | **접음.** 320 / 390 / 768 / 1024 / 1440 / 1536+ 전부 캡처. 기준 c-1의 3개는 최소 집합일 뿐이다 | wp5 |
| FE-TYPE-01 / FE-VISUAL-KO-01 | **N/A.** UI 카피가 영어 전용이다. 대신 긴 모델 ID와 URL fixture로 오버플로를 검증한다 | wp5 |

## B5. 쓰기 스코프 재정의 (접음)

work-phase는 **순차 실행**이다. 병렬 실행하지 않는다. 그럼에도 소유권을 명시한다.

| 파일 | wp2 | wp3 | wp4 | wp5 |
|---|---|---|---|---|
| `public/style.css` | 토큰 · reset · 셸 · 톱바 · 탭 · 반응형 스켈레톤 (단독 소유) | `.voice-*` 셀렉터 섹션만 | `.chat-*` / `.media-*` / `.message*` 섹션만 | 수정 금지 |
| `public/index.html` | 셸 · 톱바 · 탭 · 아이콘 스프라이트 | voice 패널 | chat/media 패널 | 수정 금지 |
| `client/voice.ts`, `client/pcm-playback.ts`, 신규 `client/voice-meter.ts` | — | 소유 | — | 수정 금지 |
| `client/chat.ts`, `client/media.ts`, `client/render.ts`, `client/app.ts` | — | — | 소유 | 수정 금지 |

style.css는 단일 파일을 유지하되 `/* === SECTION: <이름> (wpN) === */` 배너로 구간을 나눈다.
**"wp3만 TypeScript를 건드린다"는 000_roadmap.md §4의 서술은 철회한다.** wp3와 wp4 둘 다 TypeScript를 건드린다.

wp5는 **검증 전용 phase**다. 발견된 결함은 소유 work-phase로 되돌린다(LOOP-UNIT-CHAIN-01).

## B6. 모의 하네스 실현 방법 (접음)

리뷰어 지적이 맞다. `src/web/public`에는 `assets/app.js`가 없다. 빌드 산출물은 `dist/public/`이다
(scripts/copy-public.mjs, tsup.config.ts 두 번째 엔트리 → `dist/public/assets`).

고정:

1. 캡처 전에 `npm run build`를 실행한다.
2. 하네스는 `dist/public/`을 정적 서빙한다. `src/web/public`이 아니다.
3. 하네스는 QA 전용 스크립트이며 `devlog/_plan/260918_web_ui_redesign/harness/`에 둔다. **운영 코드(src/)에 모의 경로를 넣지 않는다.**
4. 최소 엔드포인트 (api.ts 근거):

| 목적 | 엔드포인트 |
|---|---|
| 전체 UI idle | `GET /v1/models` (api.ts:51) |
| chat 스트리밍 상태 | `POST /v1/responses` SSE (api.ts:170) |
| image 결과 | `POST /v1/images/generations` (api.ts:212) |
| video 큐/폴링 | `POST /v1/videos/generations`, `GET /v1/videos/:id` (api.ts:250, 281) |
| voice 연결 직전 | `POST /v1/realtime/client_secrets` (api.ts:189) |

5. **voice listening/speaking 실사 캡처는 불가능하다.** `connect-src`가 `wss://api.x.ai`로 고정돼 있고
   (server.ts:26) 운영 코드에 dev 오버라이드를 넣는 것은 거부한다.
   대신 두 가지로 나눠 증명한다.
   - **CSS 상태 렌더링**: `data-state` 값을 직접 지정한 정적 상태 하네스 페이지로 8개 상태를 캡처한다. 캡처마다 `fixture: static state harness`를 기록한다.
   - **런타임 상태 매핑**: 상태 전이가 실제 이벤트에서 나온다는 것은 코드와 기존 테스트(`tests/voice-cli.test.ts` 계열)로 증명한다.
   이 분리를 캡처 보고서에 명시한다. 렌더 증거와 런타임 증거를 뒤섞어 주장하지 않는다.

## B7. 라이브 서피스 실질 보강 (접음 — 실데이터만)

"레벨 미터를 추가한 기존 폼"에 그치지 않도록 다음을 wp3에 추가한다. **전부 실제 값이며 추정치를 만들지 않는다.**

| 표시 | 출처 | 가짜 위험 |
|---|---|---|
| 세션 경과 시간 | start 시각 기준 실측 | 없음 |
| 마지막 이벤트 타입 + 시각 | 소켓 `onmessage`의 실제 `event.type` | 없음 |
| 입력 디바이스 라벨 | `MediaStreamTrack.getSettings()` / `label` | 권한 전에는 빈 문자열이므로 그때는 표시하지 않음 |
| 마이크 음소거 | 실제 `track.enabled` 토글 | 없음 |
| 전송 샘플레이트 / 모드 | worklet 설정값 | 없음 |
| 오프라인 | `navigator.onLine` + `offline` 이벤트 | 없음 |
| 인터럽션 표시 | `speech_started` 중 재생 취소가 실제로 일어났을 때만 | 없음 |
| 이벤트 드로어 | 실제 수신 이벤트 타입 목록(최근 N개). **페이로드 본문과 토큰은 표시하지 않는다** | 없음 |

톱바 런타임 상태도 실데이터로 고정한다.

- 엔드포인트: `location.origin + "/v1"` — 실제 서빙 주소.
- 세션 상태: `/v1/models` 성공 여부에서 파생(성공=활성, 401/실패=비활성). 별도 API를 지어내지 않는다.
- 활성 모델: chat 모델 select의 현재 값.


---

# 2차 감사 반영 (A-phase fold, round 2)

2차 리뷰어 판정: fail. 남은 블로커 2건을 API 수준으로 확정한다.

## B2-b. 출력 meter API를 시그니처까지 고정

문구가 아니라 실제 시그니처로 못 박는다. wp3은 이 형태를 그대로 구현한다.

```ts
// pcm-playback.ts
export class PcmPlaybackQueue {
  constructor(
    context: AudioContext,
    onActive: () => void,
    onIdle: () => void,
  );
  readonly analyser: AnalyserNode;   // bus에서 분기. 소유자는 이 큐다.
  get active(): boolean;
  enqueue(buffer: ArrayBuffer, sampleRate: number): void;
  cancel(): void;                    // 재생 중단 + nextPlaybackAt 리셋
  dispose(): void;                   // cancel() + bus/analyser disconnect
}
```

```ts
// voice-meter.ts
export interface VoiceMeter {
  attachInput(analyser: AnalyserNode): void;
  attachOutput(analyser: AnalyserNode): void;
  resetOutput(): void;   // 출력 바를 즉시 0으로. analyser 감쇠를 기다리지 않는다.
  dispose(): void;       // rAF cancel + 참조 해제. 노드 disconnect는 하지 않는다.
}
```

호출 지점을 정확히 고정한다.

| 위치 | 현재 코드 | 추가되는 호출 |
|---|---|---|
| `VoiceController.cancelPlayback()` (voice.ts:335-337) | `this.#playback?.cancel()` | 바로 뒤에 `this.#meter?.resetOutput()` |
| `VoiceController.stopMedia()` (voice.ts:352-368) | `this.#playback?.cancel()` 후 참조만 버림 | `this.#meter?.dispose()`, `this.#playback?.dispose()`를 참조 해제 **전에** 호출. 입력 analyser도 `disconnect()` |
| `PcmPlaybackQueue.enqueue()` (pcm-playback.ts:34) | `source.connect(this.context.destination)` | `source.connect(this.#bus)`로 교체. bus는 생성자에서 `bus → analyser`, `bus → destination` |
| `VoiceController.onOpen()` (voice.ts:214, 226) | `source.connect(worklet)`, `worklet → silentSink → destination` | `source.connect(inputAnalyser)`를 **병렬로** 추가. silentSink 체인은 그대로 둔다 |

`cancelPlayback()`은 `stop()`, `fail()`, `speech_started`(voice.ts:271), `response.cancelled`(voice.ts:289)에서 호출되므로
인터럽션 시 출력 meter 0 처리가 네 경로 모두에서 자동으로 보장된다.

## B7-b. 톱바 라벨을 사실 그대로로 교정

2차 리뷰어 지적이 맞다. `/v1/models` 200은 "모델 카탈로그를 받았다"는 사실일 뿐
OAuth 세션 활성의 증명이 아니다(app.ts:38-39, api.ts:51-74). "세션 활성" 표기를 **철회한다.**

톱바는 다음 세 가지만 표시한다. 전부 직접 관측된 사실이다.

| 라벨 | 값 | 근거 |
|---|---|---|
| `Endpoint` | `location.origin + "/v1"` | 실제 서빙 주소 |
| `Catalog` | `N models` / `unavailable` | `listModels()`의 실제 결과 또는 실패 |
| `Model` | chat 모델 select의 현재 값 | 실제 선택값 |

OAuth 세션 상태를 알고 싶으면 CLI `progrok status`가 답한다. 웹 UI가 추측하지 않는다.
카탈로그 실패 시에는 `unavailable`과 재시도 버튼만 제공하고 원인을 단정하지 않는다.

