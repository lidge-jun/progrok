# wp14 — c-2 의 검증 가능한 부분을 덮는다 (닫지는 않는다)

## 문제

`c-2` 는 유일하게 남은 미충족 기준이다.

> 라이브 보이스 패널이 마이크 입력에 반응하는 실시간 시각화와
> 명시적 연결 상태(idle/connecting/live/speaking/error)를 렌더한다

사용자가 직접 테스트했다고 했지만 그건 내 관측이 아니다. 그렇다고 "마이크 권한이 필요하니
못 닫는다" 로 두는 것도 게으르다. 기준을 쪼개서 **검증 가능한 부분을 최대한 덮되,
남는 부분을 덮은 척하지 않는다.**

| 부분 | 마이크 필요? | 어떻게 |
|---|---|---|
| A. 연결 상태 9종 렌더링 | 아니오 | `VoicePanel.setStatus` 를 상태별로 호출해 `dataset.state` 와 문구 확인 |
| B. 분석기 데이터 → 막대 | 아니오 | 가짜 `AnalyserNode` 로 레벨을 주입해 막대가 따라가는지 확인 |
| D. 스트림 → 분석기 → 미터 **배선** | 아니오 | 가짜 `MediaStream`/`AudioContext` 로 컨트롤러 경로 자체를 검증 |
| C. 실제 마이크 장치 오디오가 그 배선에 흐름 | **예** | 닫지 못한다 |

## 초안의 거짓 주장 철회

초안은 "C 는 브라우저 배선이고 우리 코드가 아니다" 라고 썼다. **틀렸다.** 감사가
실제 코드를 짚었다. 배선은 전부 이 저장소 코드다.

| 단계 | 위치 |
|---|---|
| `getUserMedia` 호출 | `voice.ts:91` |
| `createMediaStreamSource` | `voice.ts:221` |
| `createAnalyser` + fftSize/smoothing 설정 | `voice.ts:231-233` |
| source → analyser 연결 | `voice.ts:234` |
| analyser → meter 연결 | `voice.ts:239` (`:238` 은 `createMeter()` 호출) |

플랫폼 책임은 "OS 가 마이크 샘플을 `MediaStream` 에 넣는다" 까지고, 그 뒤로는 우리가
쓴 코드다. 그래서 **D 를 추가한다.** 이걸 빼면 "분석기에서 막대까지"(B)와 "화면 상태"(A)만
덮고 정작 둘을 잇는 우리 배선은 아무도 안 보는 상태가 된다.

## c-2 는 이 단위에서 닫지 않는다

초안은 A·B 를 통과시키고 c-2 를 `met` 으로 바꾸겠다고 했다. 감사 판정은 **기준 약화**였고
맞는 지적이다. 근거가 둘 있다.

  - 원래 기준(`devlog/_plan/260918_web_ui_redesign/000_roadmap.md:124,134`)은 "실측 반응 시각화" 와
  렌더 증거를 요구한다.
- 이전 단위의 계획(`devlog/_plan/260918_web_ui_redesign/071_wp5_plan.md:178`)이 이미 **"정적 상태/레벨 테스트는 마이크 반응을
  증명하지 않으므로 met 으로 표시하지 않는다"** 고 못 박아 뒀다. 내가 지금 그걸 뒤집으려 한 것이다.

A·B·D 가 전부 통과해도 `c-2` 는 **`open` 으로 남긴다.** 대신 goalplan 에 부분 증거를
기록해서, 다음에 보는 사람이 "무엇이 증명됐고 무엇이 남았는지" 를 바로 알 수 있게 한다.

덧붙여 지금은 `progrok status` 가 `Not logged in` 이라 라이브 세션 자체를 띄울 수 없다.
이건 "못 닫는 이유" 가 아니라 "지금 시도해도 안 된다" 는 사실 기록이다.

## A — 연결 상태 9종

`VoiceStatus` 는 9개다 (`contracts.ts:43-52`): `idle`, `requesting-permission`,
`minting-secret`, `connecting`, `listening`, `responding`, `speaking`, `stopped`, `failed`.
c-2 문구의 "idle/connecting/live/speaking/error" 는 이들의 축약이다.

현재 `tests/voice-panel.test.ts` 는 `listening` 하나만 본다(`:205-207`).
(정확히는 `:205-207` 이 `dataset.state`, `:208` 이 문구, `:209-214` 가 컨트롤 단언이다.
어느 쪽이든 9개 중 1개만 본다는 요지는 같다.)
**MODIFY `tests/voice-panel.test.ts`** — 9개를 전부 돌면서 확인한다.

- `el.status.dataset.state` 가 그 상태 문자열과 같다
- `el.status.textContent` 가 **빈 문자열이 아니다** (상태마다 사람이 읽을 문구가 있다)
- `detail` 인자를 주면 그게 문구를 덮어쓴다 (`fail(message)` 경로)
- 9개 문구가 **서로 다르다** — 상태가 화면에서 구분된다는 뜻. 이게 "명시적" 의 의미다

`STATUS_COPY` 는 `voice-panel.ts:4` 의 **비공개 상수**다 (런타임 export 는 `VoicePanel` 뿐이고,
`VoiceElements`(`:19`)는 타입 export 라 값으로 못 쓴다).
이 단위는 프로덕션 코드를 안 고치므로 export 를 추가하지 않는다. 대신 테스트가
**자기 기대 문자열 맵을 직접 선언**한다. 그래야 문구가 바뀌면 테스트가 알아챈다 —
상수를 그대로 import 해서 비교하면 "자기 자신과 같다" 는 공허한 단언이 된다.

## B — 미터가 입력 레벨에 반응한다

`createVoiceMeter`(`voice-meter.ts:91`)는 `AnalyserNode` 에서 딱 두 가지만 쓴다:
`frequencyBinCount` 와 `getByteFrequencyData(data)`. 그래서 가짜로 대체할 수 있다.

**NEW `tests/voice-meter-render.test.ts`**

가짜 부품:
- `FakeBarHost` — `querySelectorAll("i")` 로 막대 N개를 돌려준다. 막대는 `dataset.level` 만 있으면 된다
- `FakeAnalyser` — `frequencyBinCount` 와, 테스트가 정한 값으로 배열을 채우는 `getByteFrequencyData`
- `requestAnimationFrame`/`cancelAnimationFrame` — 큐에 넣고 테스트가 **직접 1프레임씩** 돌린다.
  진짜 rAF 는 Node 에 없고, 있어도 비동기라 단언이 불안정하다
- `window.matchMedia` — `matches: false` (감소 모션이면 루프 자체가 안 돌아서 B 를 못 본다)

검증할 것:

1. **무음이면 막대가 0 이다.** 분석기가 `NOISE_FLOOR`(18) 이하를 주면 모든 `dataset.level` 이 `"0"`
2. **입력이 커지면 막대가 올라간다.** 큰 값을 주고 몇 프레임 돌리면 `dataset.level` 이 0 보다 커진다.
   이게 "마이크 입력에 반응한다" 의 기계적 정의다
3. **레벨이 클수록 막대가 높다.** 중간 입력과 큰 입력을 각각 충분히 돌려 비교하면 단조 증가
4. **올라갈 때가 내려올 때보다 빠르다.** `ATTACK`(0.55) > `RELEASE`(0.16) 이므로
   같은 프레임 수에서 상승폭이 하강폭보다 크다. 미터가 말을 따라간다는 느낌의 근거다
5. **`dispose()` 후에는 막대가 0 으로 돌아가고 루프가 멈춘다** (rAF 큐가 비어야 한다)
6. **감소 모션이면 루프를 만들지 않는다.** `matchMedia().matches = true` 면
   `attachInput` 후에도 rAF 가 예약되지 않는다
   (이때 `dataset.level` 은 `"0"` 이 아니라 **`undefined`** 로 남는다. 루프가 한 번도
   안 돌아 `paint` 가 호출되지 않기 때문이다. 단언은 "rAF 예약 없음" 으로만 한다)

전역 스텁은 설치했다가 **원상 복구**한다. `window`/`requestAnimationFrame` 은 Node 에
원래 없으므로 `delete` 로 되돌린다.

## D — 스트림에서 미터까지의 배선

감사가 요구한 항목이다. **NEW `tests/voice-wiring.test.ts`**.

`VoiceController.start()` 를 가짜 브라우저 환경에서 돌려
`voice.ts:91 → 221 → 231-233 → 234 → 239` 경로가 실제로 이어지는지 본다.

필요한 가짜는 아래와 같다. **이 표가 완전하다고 주장하지 않는다.** 이 계획은 같은 표를 두고
"이 목록이 전부" 라고 세 번 썼고 세 번 다 감사가 빠진 항목을 찾아냈다 (`isSecureContext`,
정적 `WebSocket.OPEN`, `WebSocket.send`). 산문으로 브라우저 표면을 완전히 열거하려는 시도
자체가 틀린 방법이었다.

**구현 방법을 바꾼다.** 하네스를 만들 때 표를 보고 추측하지 말고, `start()` 를 돌려
`TypeError` 가 날 때마다 그 표면을 추가하는 식으로 **실행이 알려주게** 한다. 아래 표는
출발점이고, 최종 목록은 구현 후 체크 문서에 **실제로 쓴 것**을 기록한다.

| 가짜 | 표면 |
|---|---|
| `navigator.mediaDevices.getUserMedia` | 가짜 `MediaStream` — 트랙 하나에 `label`, `enabled`, `stop` |
| `AudioContext` | `createMediaStreamSource`, `createAnalyser`, `createGain`, `audioWorklet.addModule`, `destination`, `close`, `state` |
| `AudioWorkletNode` | `port.onmessage`, `connect` |
| `WebSocket` | 생성 + 테스트가 `open` 이벤트를 **직접 발생**시킨다. 정적 `WebSocket.OPEN` 과 인스턴스 `readyState` 도 있어야 한다 |
| `WebSocket.prototype.send` | `realtime` 모드는 open 직후 세션 업데이트를 보낸다 (`voice.ts:205` → `:333-334`). 없으면 `send is not a function` 으로 죽는다 |
| `window.isSecureContext` | `true`. `voice.ts:51` 의 가용성 검사가 이걸 먼저 본다 |
| `"AudioWorkletNode" in window` | 가용성 검사가 함께 본다 (`voice.ts:53`) |
| `fetch` | `/v1/realtime/client_secrets` 성공 응답 |
| `VoiceElements` | 패널이 붙을 가짜 DOM 한 벌 (`voice.ts:46`) |
| `VoiceMeter` | `attachInput`, `attachOutput`, `resetOutput`, `dispose` **전부**. `attachInput` 만 두면 `:240` 의 `attachOutput` 에서 죽는다 |
| `window.addEventListener` | 컨트롤러가 online/offline/beforeunload 를 단다 (`voice.ts:65-71`) |
| `window.setInterval` / `clearInterval` | 패널의 경과 시간 시계 (`voice-panel.ts:165-176`) |

`VoiceElements` 가짜는 `tests/voice-panel.test.ts:8-105` 에 이미 있지만 export 되지 않는다.
**NEW `tests/helpers/fake-voice-dom.ts`** 로 옮겨 두 테스트가 같이 쓴다. 이건 테스트 헬퍼라
"프로덕션 무변경" 원칙에 걸리지 않는다.

감사가 프로토타입으로 실제 확인한 실패들이다. `isSecureContext` 를 빼면
`getUserMediaCalls: 0`, `status: failed` 로 시작조차 못 한다. 정적 `WebSocket.OPEN` 을 빼면
`start()` 가 먼저 부르는 `stop(false)` 가 `voice.ts:334` 에서 `TypeError` 로 죽는다.
`send` 를 빼면 `status: "failed"`, `contexts: 0`, `attached: 0` 이 된다.

검증할 것:

1. `getUserMedia` 가 `{ audio: { channelCount: 1, echoCancellation: true }, video: false }` 로 불린다
2. `createMediaStreamSource` 가 **그 스트림**을 받는다
3. 만들어진 analyser 에 `fftSize = 256`, `smoothingTimeConstant = 0.72` 가 설정된다
4. source 가 그 analyser 에 `connect` 된다
5. 미터의 `attachInput` 이 **그 analyser 객체**로 불린다 (동일성 비교)
6. 아래 6a / 6b (실패 경로)
7. `open` **전에는** AudioContext 도 attach 도 만들어지지 않는다
8. `open` **후 최종 상태가 `listening`** 이다

5번이 핵심이다. B 는 "분석기가 주면 막대가 움직인다" 를 보고, D 의 5번은 "마이크 스트림에서
나온 바로 그 분석기가 미터에 붙는다" 를 본다. 둘을 합치면 C 를 뺀 전 구간이 덮인다.
7번은 "소켓이 열려야 오디오가 붙는다" 는 순서를 고정한다.

8번이 없으면 하네스가 조용히 반쪽만 증명한다. 5차 감사가 실측했다: `attachOutput` 이
예외를 던지게 해도 D-1~D-5 와 D-7 은 전부 `true` 였고 최종 상태만 `failed` 였다.
배선 단언만 보면 통과한 것처럼 보인다는 뜻이다. `voice.ts:243` 의 `listening` 까지
도달했는지 확인해야 성공 경로를 끝까지 증명한 것이다.

### 하네스가 배선까지 도달하는 법

초안은 "mint 경로에서 멈춰도 6개 전부 확인된다" 고 썼다. **사실과 반대다.**
재감사가 프로토타입을 돌려 확인했다. 배선은 전부 `onOpen()`(`voice.ts:203`) 안에 있고,
거기까지 가려면 mint 와 소켓 open 을 통과해야 한다. mint 를 실패시키면 이렇게 된다.

```
status: failed
webSocketCreated: false
audioContextCreated: false
```

`createMediaStreamSource` 조차 안 불린다. 그래서 하네스는 **성공 경로를 끝까지 태워야** 한다.
재감사가 실제로 통과시킨 구성이다.

| 가짜 | 어떻게 |
|---|---|
| `fetch` | `mintClientSecret`(`api.ts:189`)이 진짜로 부른다. `/v1/realtime/client_secrets` 에 성공 응답을 주는 스텁이 **반드시** 필요하다. 초안의 가짜 목록에 빠져 있었다 |
| `WebSocket` | 생성만으로는 부족하다. 테스트가 `open` 이벤트를 **직접 발생**시켜야 `onOpen` 이 돈다 |
| `audioWorklet.addModule` | resolved Promise 를 돌려주면 된다. URL 을 실제로 로드하지 않아 문제없다 (재감사 확인) |
| 미터 | `attachInput` 이 받은 인자를 기록하는 spy. `createVoiceMeter` 를 통째로 가짜로 두거나 호스트 DOM 을 주고 spy 를 건다 |

재감사 프로토타입 출력:

```
beforeOpen: contexts=0, attachedInputs=0
fetch: /v1/realtime/client_secrets
addModuleCalls: ["/assets/pcm-worklet.js"]
sourceConnectedToInputAnalyser: true
meterReceivedSameAnalyser: true
```

`beforeOpen` 줄이 중요하다. `open` 전에는 AudioContext 도 attach 도 0 이다.
즉 이 테스트는 "소켓이 열려야 오디오가 붙는다" 는 순서까지 같이 고정한다.

### D-6 은 두 경우로 나눈다

재감사 지적이다. 초안은 "권한 거부되면 스트림 정리가 돈다" 고 했는데, 거부되면
`voice.ts:91` 의 대입이 끝나지 않아 **정리할 스트림 자체가 없다.** 증명 대상이 없는 단언이었다.

| 6a. 권한 거부 | `getUserMedia` reject → 상태 `failed`, mint 와 WebSocket 이 **불리지 않음** |
| 6b. 스트림 획득 후 mint 실패 | 획득한 트랙의 `stop()` 이 불림 (재감사 프로토타입: `acquiredTrackStopped: 1`) |

6b 가 원래 의도한 "정리가 돈다" 다.
## 하지 않는 것

동작 변경. 이 단위는 **테스트만 추가**한다. 프로덕션 코드를 한 줄도 고치지 않는다.
(`git diff --stat -- src/` 가 비어 있어야 한다)
jsdom 등 의존성 추가도 안 한다.

## c-2 는 open 으로 남기고 부분 증거를 기록한다

재감사가 이 문서 안의 모순을 잡았다. 위에서는 "open 으로 남긴다" 고 해놓고 여기서는
"met 로 바꾸면서" 라고 쓰고 있었다. **met 로 바꾸지 않는다.** 이 절이 그 문구를 정정한다.

goalplan 의 `c-2` 는 `open` 이다. 대신 이 단위가 끝나면 무엇이 증명됐는지 기록한다.

| 부분 | 상태 |
|---|---|
| A. 연결 상태 9종이 화면에 구분되어 렌더된다 | 테스트로 증명 |
| B. 분석기 데이터가 막대를 움직인다 | 테스트로 증명 |
| D. 스트림 → 분석기 → 미터 배선이 이어진다 | 테스트로 증명 |
| C. **실제 마이크 장치 오디오가 그 배선에 흐른다** | **미관측** |

C 는 마이크 권한 승인이 필요하고, 지금은 `progrok status` 가 `Not logged in` 이라
라이브 세션조차 띄울 수 없다. 사용자가 이전에 직접 확인했다고 보고했지만 그건 사용자
진술이지 내 관측이 아니다. 둘을 섞지 않는다.

닫는 방법은 하나다. `progrok login` 후 `progrok chat` 에서 마이크 권한을 승인하고
말할 때 입력 미터가 움직이는 것을 확인하는 것. 그 승인은 사람이 눌러야 한다.

## 검증

- `npm run typecheck` exit 0
- `node scripts/run-tests.mjs` 전부 통과 (260 → 늘어난다)
- 프로덕션 코드 무변경. `git diff --stat -- src/` 만으로는 staged 변경과 untracked 를
  놓치므로 셋을 다 본다: `git status --short -- src/`, `git diff -- src/`,
  `git diff --cached -- src/`
- 새 테스트를 mutation 으로 깨뜨려 RED 확인. **신규 파일만 단독 실행**하고 실패한
  테스트 이름을 확인한다. 전체 스위트가 빨개지는 것으로는 증명이 안 된다 —
  감사가 확인했듯 `ATTACK`/`RELEASE` 교환과 `normalizeBand→0` 은 **기존**
  `voice-meter.test.ts:23-27, 42-48` 이 이미 잡는다.
- 하강 속도 단언은 1프레임 비교로 하지 않는다. 감사가 실측하니 상수를 뒤바꿔도
  `rise=2 > fall=1` 로 통과했다. **peak 까지 예열한 뒤 독립 표본으로** 비교한다.
