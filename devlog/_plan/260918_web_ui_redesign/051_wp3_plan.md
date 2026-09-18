# wp3 실행 계획 (diff-level) — 라이브 보이스 런타임

[050_voice_surface.md](050_voice_surface.md)의 API 계약과 배선표를 P에서 재검증했다. 변경 없음.
마크업과 CSS는 wp2가 이미 만들었다(041 v2 재절단). wp3은 **런타임만** 구현한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/web/client/pcm-playback.ts` | 출력 bus + analyser 추가, `dispose()` 추가 |
| `src/web/client/voice-meter.ts` | 신규. rAF 1개로 입출력 바 갱신 |
| `src/web/client/voice.ts` | 입력 analyser 병렬 연결, meter 배선, mute, transport rows, event log, elapsed, 에러 분기 |
| `src/web/client/contracts.ts` | `VoiceElements`에 새 옵셔널 엘리먼트 추가 시 타입 반영 (필요 시) |
| `src/web/client/app.ts` | 새 보이스 엘리먼트 조회 추가 |

`app.ts`는 005 B5 표에서 wp4 소유지만, 보이스 컨트롤러 생성자 인자 추가는 wp3의 배선이다.
충돌을 피하려고 wp3은 `app.ts`의 **VoiceController 생성 블록만** 건드린다. 나머지는 wp4가 소유한다.

## pcm-playback.ts

```ts
export class PcmPlaybackQueue {
  #bus: GainNode;
  readonly analyser: AnalyserNode;
  constructor(context, onActive, onIdle) {
    this.#bus = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.#bus.connect(this.analyser);
    this.#bus.connect(context.destination);
  }
  // enqueue: source.connect(this.#bus)
  dispose(): void { this.cancel(); this.#bus.disconnect(); this.analyser.disconnect(); }
}
```

## voice-meter.ts (신규)

- `createVoiceMeter(inputEl, outputEl)` → `VoiceMeter`.
- 각 엘리먼트의 `<i>` 자식 개수를 읽어 밴드 수를 정한다(마크업이 7개).
- `Uint8Array`를 생성자에서 한 번 만들고 프레임마다 재사용한다.
- 정규화 `(v - 18) / 210`, 하한 0. attack 0.55 / release 0.16.
- `el.style.setProperty("--level", value)` (CSSOM 경로. CSP inline-style 제약 대상이 아니다).
- `matchMedia("(prefers-reduced-motion: reduce)").matches`이면 rAF를 **생성하지 않는다.**
- `resetOutput()`은 출력 바 `--level`을 0으로 쓰고 내부 상태도 0으로 만든다.
- `dispose()`는 rAF cancel + analyser 참조 해제. 노드 disconnect는 하지 않는다.

## voice.ts 배선

| 지점 | 변경 |
|---|---|
| `onOpen` (214 부근) | `#inputAnalyser = context.createAnalyser()`; fft 256 / smoothing 0.72; `source.connect(#inputAnalyser)` 병렬. silentSink 체인 유지 |
| `onOpen` 말미 | `meter.attachInput(#inputAnalyser)`, `meter.attachOutput(playback.analyser)` |
| `cancelPlayback` | `playback.cancel()` 직후 `meter.resetOutput()` |
| `stopMedia` | `meter.dispose()` → `playback.dispose()` → `#inputAnalyser.disconnect()` 를 참조 해제 전에 |
| `start` | elapsed 타이머 시작, transport rows 노출, 디바이스 라벨 기록 |
| `stop`/`fail` | elapsed 타이머 정지, mute 해제, transport rows 유지(마지막 상태) |

## 새 기능

1. **mute**: `#voice-mute` 토글. `stream.getAudioTracks()[0].enabled`를 뒤집고 `aria-pressed`,
   상태 칩 `data-muted`, 아이콘 `#i-mic`/`#i-mic-off`를 바꾼다. 활성 세션에서만 보인다.
2. **elapsed**: start 시각 기준 1초 간격 `m:ss`. 세션 종료 시 정지.
3. **last event**: `onMessage`의 실제 타입과 수신 시각. 바이너리는 `audio(binary)`.
4. **event log**: 최근 30개. 타입 + 시각만. **페이로드·트랜스크립트·시크릿은 기록하지 않는다.**
5. **transport rows**: endpoint(호스트만), sample rate, 입력 디바이스 라벨, `navigator.onLine`.
6. **에러 분기**: `NotAllowedError` / `NotFoundError` / 보안 컨텍스트 / 시크릿 실패를 각각 다른 복구 문구로.
7. **인터럽션 표시**: `speech_started`로 재생이 실제 취소된 경우에만 assistant turn에 `data-interrupted`.

## 하지 않는 것

재연결(없는 기능), 가짜 지연 수치, 추정 진행률, 토큰/시크릿 노출.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- 하네스에서 마이크 권한 거부 경로 실측(권한 프롬프트를 거부해 `failed` 상태 문구 확인)
- `data-state` 8종 정적 상태 하네스 캡처는 wp5


---

# wp3 감사 반영 (A-phase fold)

리뷰어 2명이 독립적으로 같은 블로커를 지목했다. 전부 접는다.

## F1. 인라인 스타일 제거 — `data-level` 양자화 (CSP 논쟁 제거)

`el.style.setProperty("--level", ...)` 계획을 **철회한다.** CSSOM이 `style-src 'self'`에서
허용되는지 브라우저에서 결정적으로 실증하지 못했고(평가 스코프가 읽기 전용), 위험을 안고 갈 이유가 없다.

대신 각 바에 `data-level="0".."12"`를 쓰고 `style.css`에 정적 규칙 13개를 둔다.
속성 변경은 CSP 대상이 아니다. 13단계는 30fps 레벨 미터에 충분하고 세그먼트 VU 미터로 읽힌다.

```css
.meter__bars i { transform: scaleY(0.06); transition: transform 90ms linear; }
.meter__bars i[data-level="1"]  { transform: scaleY(0.14); }
/* ... 12까지 ... */
.meter__bars i[data-level="12"] { transform: scaleY(1); }
```

`<i>`의 `--level: 0` 선언도 함께 제거한다(상속되지 않아 무의미).

## F2. meter 수명주기

`stopMedia()`가 매번 `dispose()`하므로 meter는 **`onOpen`마다 새로 만든다.**
`addModule()` 이후 소켓이 바뀌어 중도 반환하는 경로에서도 이미 만든 meter/analyser를 정리한다.
`stopMedia()` 자체가 `resetOutput` 의미를 포함하도록 고정한다. `cancelPlayback()`을
거치지 않는 호출 경로가 있기 때문이다.

## F3. 레벨 산출 계약

`getByteFrequencyData`를 쓴다(time-domain 무음 중심값 128 오인 방지).
7밴드 로그 샘플링, 정규화 `(v - 18) / 210` 후 **`clamp(0, 1)`**, 그 다음 `Math.round(level * 12)`.
상한 clamp 누락으로 1.13까지 오르던 문제를 닫는다.

## F4. `responding` 상태

005 B4가 요구한 상태다. `VoiceStatus`에 `responding`을 추가하고
`response.created` → 첫 출력 오디오 전까지 적용한다. 실제 이벤트 경계이므로 조작이 아니다.
상태 칩 CSS와 검증 목록도 9종으로 늘린다.

## F5. hidden wrapper 배선

값 ID만이 아니라 wrapper도 함께 노출한다:
`voice-elapsed-row`, `voice-event-row`, `voice-transport`,
`voice-endpoint-row`, `voice-rate-row`, `voice-device-row`, `voice-network-row`.
값이 없으면 wrapper를 계속 숨긴다. 빈 값을 "Default" 같은 문구로 채우지 않는다.

## F6. 인터럽션 판정

`speech_started` 처리에서 `cancelPlayback()` **직전에** `playback.active`를 캡처하고,
true였을 때만 assistant turn에 `data-interrupted="true"`를 쓴다.
`response.created`와 `start()`에서 이 속성을 지운다.
대상 엘리먼트는 `index.html`의 assistant `.turn`이며, 참조를 위해 `id="voice-assistant-turn"`을 부여한다.

## F7. 정직한 표시

- sample rate는 **전송 목표율**이다. 라벨을 `Send rate`로 쓴다.
- `navigator.onLine`은 브라우저 네트워크 스택 상태일 뿐 API 연결 증명이 아니다. 라벨을 `Browser network`로 쓴다.
- 디바이스 라벨이 빈 문자열이면 행을 숨긴다.
- mute는 캡처 신호를 무음으로 만들 뿐 **전송을 멈추지 않는다.** worklet은 무음 PCM을 계속 보낸다.
  UI 문구를 `Mic muted (still streaming silence)` 수준으로 정직하게 쓴다.

## F8. 회귀 테스트

`tests/`에 보이스 런타임 테스트를 추가한다: 레벨 양자화 함수의 clamp/경계,
반복 start/stop에서 meter가 새로 만들어지고 정리되는지, 네 reset 경로.
DOM/오디오 의존부는 순수 함수로 분리해 테스트 가능하게 만든다.

## F9. 자동 추종

050 §3.3의 하단 48px 추종은 `.transcript` 두 개에 적용한다.
갱신 직전 `scrollHeight - scrollTop - clientHeight <= 48`이면 추종, 아니면 위치 보존.

