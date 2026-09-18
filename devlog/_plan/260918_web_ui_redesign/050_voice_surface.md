# wp3 — 라이브 보이스 서피스

소유 파일(041_wp2_plan.md v2 재절단 반영): 이 문서의 **마크업·CSS 부분은 wp2**가 구현하고,
**런타임 부분은 wp3**가 구현한다. wp3의 파일은 `client/voice.ts`, `client/pcm-playback.ts`,
신규 `client/voice-meter.ts`이다.

## 1. 레이아웃

```
voice 패널 (grid: stage | console)
├─ stage   (좌, 1.4fr)
│  ├─ status strip : 상태 칩 + 경과시간 + 마지막 이벤트
│  ├─ meter deck   : 입력 미터(You) / 출력 미터(Grok) 2행
│  └─ transcript   : You / Grok 2행 스트림
└─ console (우, 0.85fr, 최대 340px)
   ├─ connection form : mode / model / voice
   ├─ transport rows  : endpoint, sample rate, device, online
   └─ event drawer    : 최근 수신 이벤트 타입 목록
```

1024 미만에서 console이 stage 아래로 내려간다. 640 미만에서 event drawer는 `<details>`로 접힌다.

## 2. 상태 칩

`#voice-status[data-state]`를 스타일 훅으로 쓴다. 색만으로 구분하지 않는다.

| data-state | 점 형태 | 색 | 텍스트 |
|---|---|---|---|
| (없음)/idle | 속 빈 원 | fg-muted | Microphone is idle |
| requesting-permission | 점선 링 | warning | Waiting for microphone permission |
| minting-secret | 점선 링 | warning | Creating a one-use connection secret |
| connecting | 느린 pulse 링 (1.2s) | warning | Connecting to xAI Voice |
| listening | 채워진 점 + 얇은 링 | accent | Listening |
| speaking | 채워진 점 | accent | Grok is speaking |
| stopped | 사각 | fg-muted | Voice stopped |
| failed | 삼각 경고 | danger | (구체 오류 메시지) |

`idle`에서 `data-state`가 설정되지 않는 현재 동작(voice.ts:64-71)을 고치되,
`init()`에서 `setStatus`를 부르면 `syncControls` 부작용이 생기므로 `dataset.state = "idle"`만 직접 설정한다.

`muted`는 별도 state가 아니라 `data-muted` 속성으로 칩에 겹쳐 표시한다.
`reconnecting`은 구현하지 않는다. 재연결 로직이 없으므로 N/A (005 B4).

## 3. 레벨 미터

DOM 바 방식을 쓴다. canvas가 아니다 — forced-colors 대응과 테스트가 단순하고 7개 바에 canvas는 과하다.

- 바 7개. `transform: scaleY()`만 애니메이션한다 (FE-MOTION-03).
- 입력 미터 색 `--fg-secondary`, 출력 미터 색 `--accent`. 위치와 라벨로도 구분한다.
- `fftSize = 256`, `smoothingTimeConstant = 0.72`.
- noise floor: 정규화 `(v - 18) / 210`, 하한 0. 무음에서 바는 최소 높이로 수렴한다.
- attack 0.55 / release 0.16 비대칭 보간.
- `requestAnimationFrame` 1개만 돈다. 두 미터를 한 루프에서 갱신한다.
- 매 프레임 배열 재할당 금지. `Uint8Array`를 한 번 만들어 재사용한다.
- `prefers-reduced-motion: reduce`이면 **rAF를 생성하지 않는다.** 바는 정적 최소 높이로 두고
  상태 텍스트만으로 활성 여부를 전달한다 (FE-REDUCED-01).

## 4. API 계약 (005 B2-b 그대로)

```ts
// pcm-playback.ts
export class PcmPlaybackQueue {
  constructor(context: AudioContext, onActive: () => void, onIdle: () => void);
  readonly analyser: AnalyserNode;
  get active(): boolean;
  enqueue(buffer: ArrayBuffer, sampleRate: number): void;
  cancel(): void;
  dispose(): void;
}

// voice-meter.ts
export interface VoiceMeter {
  attachInput(analyser: AnalyserNode): void;
  attachOutput(analyser: AnalyserNode): void;
  resetOutput(): void;
  dispose(): void;
}
export function createVoiceMeter(input: HTMLElement, output: HTMLElement): VoiceMeter;
```

배선:

| 지점 | 변경 |
|---|---|
| `PcmPlaybackQueue` 생성자 | bus `GainNode` 생성, `bus → analyser`, `bus → destination` |
| `enqueue` (pcm-playback.ts:34) | `source.connect(this.#bus)` |
| `onOpen` (voice.ts:214) | `this.#inputAnalyser = context.createAnalyser()`; `source.connect(inputAnalyser)` **병렬**. silentSink 체인 유지 |
| `onOpen` 말미 | `meter.attachInput(inputAnalyser)`, `meter.attachOutput(playback.analyser)` |
| `cancelPlayback` (voice.ts:335) | `playback.cancel()` 직후 `meter.resetOutput()` |
| `stopMedia` (voice.ts:352) | `meter.dispose()`, `playback.dispose()`, `inputAnalyser.disconnect()`를 참조 해제 **전에** |

AudioContext는 start마다 새로 만들어지므로(voice.ts:203) meter 노드도 매번 새로 만든다. 재사용 금지.

## 5. 트랜스크립트

`#voice-user-transcript` / `#voice-assistant-transcript` 두 요소 계약을 유지한다.

- `data-final="true"`가 없는 사용자 텍스트는 opacity 0.62 + 끝에 caret. final이면 100%.
- STT partial은 replace다. append가 아니다 (voice.ts:248이 이미 replace).
- 비어 있을 때 `:empty::before`로 안내 문구. 가짜 내용을 넣지 않는다.
- 각 스트림은 자체 스크롤 컨테이너이며 하단 48px 이내일 때만 자동 추종한다.
- 인터럽션: `speech_started`로 재생이 실제 취소됐을 때만 assistant 스트림에 `data-interrupted` 표시.

## 6. transport rows (실데이터만)

| 행 | 출처 |
|---|---|
| Endpoint | `buildVoiceSocketSpec`의 호스트. 토큰/시크릿은 절대 표시하지 않는다 |
| Sample rate | mode에 따라 16000 또는 24000 (voice.ts:202) |
| Input device | `track.label`. 권한 전에는 행 자체를 숨긴다 |
| Network | `navigator.onLine` + `online/offline` 이벤트 |
| Elapsed | start 시각 기준 실측. 1초 간격 갱신, 세션 종료 시 정지 |

## 7. event drawer

`onMessage`에서 받은 실제 이벤트 `type`과 수신 시각만 최근 30개 기록한다.
**페이로드 본문, 트랜스크립트 내용, 시크릿은 기록하지 않는다.**
바이너리 프레임은 `audio(binary)`로 표기한다.

## 8. 에러 분기 (FE-VOICE-02)

| 원인 | 판별 | 복구 안내 |
|---|---|---|
| 보안 컨텍스트/기능 미지원 | `init()`의 `#available` false | localhost 또는 HTTPS로 접속 |
| 권한 거부 | `NotAllowedError` | 브라우저 사이트 설정에서 마이크 허용 |
| 장치 없음 | `NotFoundError` | 입력 장치 연결 후 재시도 |
| 시크릿 발급 실패 | `mintClientSecret` 예외 | `progrok login` 확인 |
| 소켓 종료 | close code | 코드 그대로 표시하고 원인을 단정하지 않는다 |
