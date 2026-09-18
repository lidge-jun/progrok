# 실시간 음성 AI 인터페이스 UI 레퍼런스 (2026)

> 조사일: 2026-09-18  
> 목적: progrok 로컬 웹 앱의 실시간 음성 화면을 재설계하기 위한 제품 패턴 및 구현 근거 정리  
> 조사 원칙: 검색 결과의 요약문이 아니라 제품 공식 문서·공식 저장소·표준 문서를 우선 확인했다. 공개 문서가 상태 이벤트만 정의하고 실제 색/모션을 규정하지 않은 경우, 아래 표에 **“커스텀” 또는 “공개 근거 부족”**이라고 명시했다. 즉, API 상태와 특정 제품 화면의 외형을 혼동하지 않는다.

## 한눈에 보는 결론

progrok에는 “큰 감성 오브 하나”보다 **작은 상태 인디케이터 + 5~9개 오디오 바 + 실시간 대화 로그 + 개발 이벤트 서랍**이 적합하다. ChatGPT의 파란 오브는 소비자용 몰입 화면에는 효과적이지만, 로컬 개발 도구에서는 연결·권한·VAD·전사·재접속을 진단할 수 있는 정보 구조가 더 중요하다. OpenAI Realtime Console도 대화뿐 아니라 클라이언트/서버 JSON 이벤트 로그를 노출하는 검사 도구다. [OpenAI Realtime Console](https://github.com/openai/openai-realtime-console)

상태의 단일 진실 원천은 화면 애니메이션이 아니라 `idle → connecting → listening/user-speaking → thinking → assistant-speaking → interrupted/error` 상태 머신이어야 한다. LiveKit은 실제로 `connecting`, `listening`, `thinking`, `speaking`, 종료/실패 상태를 프런트엔드에 제공하고, 원시 문자열보다 `canListen`, `isFinished` 같은 getter 사용을 권한다. [LiveKit Agent state](https://docs.livekit.io/frontends/build/agent-state/)

---

## 1. 제품별 UI 패턴과 상태 표현

### 1.1 상태 신호 비교표

표에서 `●`는 명시적 상태, `~`는 연속 애니메이션/레벨 반응, `T`는 텍스트, `L`은 로그/트랜스크립트, `C`는 구현자가 커스텀해야 함을 뜻한다.

| 제품 / 표면 | idle | connecting | listening | user-speaking | thinking | assistant-speaking | interrupted | error | 주 신호와 근거 |
|---|---|---|---|---|---|---|---|---|---|
| **OpenAI Realtime Console** | 연결 CTA | 연결 단계 | VAD/수동 PTT | `speech_started` 이벤트 | `response.created` 이후 진행 | 출력 오디오/이벤트 | truncate/cancel 이벤트 | error 이벤트 | 개발 콘솔답게 대화와 함께 클라이언트·서버 JSON 이벤트 로그를 제공한다. 외형보다 사건 추적성이 핵심이다. [공식 저장소](https://github.com/openai/openai-realtime-console), [Realtime server events](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/speech_stopped?lang=node) |
| **OpenAI Agents/Realtime 계열 플레이그라운드** | 시작/설정 | 연결 상태 | `speech_started/stopped` | VAD 경계 | `response.created` | audio transcript delta/done | assistant item truncate | transcription failed/error | 공개 API는 입력 음성 delta/completed, VAD, 응답 수명주기를 세밀히 분리한다. UI는 이 이벤트를 텍스트+로그로 투사하는 방식이 안전하다. [입력 전사 이벤트](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/speech_stopped?lang=node), [VAD 이벤트](https://platform.openai.com/docs/api-reference/realtime-beta-server-events/conversation/item/input_audio_transcription/segment?lang=csharp) |
| **ElevenLabs Agents 대시보드/위젯** | Start CTA | `connecting` | `listening` + T | SDK의 listening/mode | 연결됨이지만 비발화 구간 | `speaking` + T, 아바타 오브 | turn 전환 | status message/연결 종료 | 공식 위젯은 오브 색 2개, `Listening…`, `Assistant speaking` 텍스트를 커스터마이즈한다. SDK는 disconnected/connecting/connected와 listening/speaking을 분리한다. [Widget customization](https://elevenlabs.io/docs/eleven-agents/customization/widget), [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react) |
| **Vapi Web Widget** | Start CTA | call-start 전 | voice mode | transcript/event 기반 C | C | 음성 재생 + C | `user-interrupted` | call-end/error C | 완성 위젯은 음성/채팅 모드, transcript 표시, 테마/색/크기와 Start/End 문구를 제공한다. 파형 포함 완성 컴포넌트도 공식 예제가 안내한다. [Web widget](https://docs.vapi.ai/chat/web-widget), [Web calls](https://docs.vapi.ai/quickstart/web) |
| **Retell AI Web Call** | 시작 CTA | status=`connecting` | live 상태 | audio analyser/update C | C | `agent_start_talking` | update/turntaking C | `error`, ended | SDK는 `connecting → live → ended`, agent start/stop talking, transcript, analyser용 Float32Array를 노출한다. 시각 스타일은 앱이 정한다. [Retell client SDK](https://www.npmjs.com/package/retell-client-js-sdk), [공식 changelog](https://www.retellai.com/changelog) |
| **Deepgram Voice Agent** | connect CTA | session connect | mic on | `user-started-speaking` | 서버 처리 | audio queue | 즉시 player interrupt | fatal Error / nonfatal Warning | 브라우저 SDK 예시는 사용자 발화가 시작되면 재생을 즉시 끊고, 연결 재시도·버퍼링을 SDK가 맡는다. [JavaScript SDK](https://developers.deepgram.com/docs/browser-agent-javascript), [Errors & Warnings](https://developers.deepgram.com/docs/voice-agent-errors-warnings) |
| **Cartesia Line / LiveKit 예제** | 시작/연결 | LiveKit 연결 | LiveKit listening | VAD/트랙 레벨 | LiveKit thinking | TTS track/LiveKit speaking | 실시간 interruption | transport/app error | Cartesia Line은 interruption/turn-taking을 기본 제공하지만 공개 Cartesia UI 규격은 제한적이다. 최신 템플릿은 LiveKit 프런트엔드 사용을 안내한다. [Cartesia Line](https://github.com/cartesia-ai/line), [Cartesia LiveKit template](https://github.com/cartesia-ai/cartesia-livekit-voice-agent) |
| **Hume EVI** | connect CTA | socket connect | mic active | `user_message` interim/final | 응답 생성 | 스트리밍 음성 재생 | `user_interruption`; 재생 큐도 즉시 정지해야 함 | typed error | EVI는 interim 전사를 여러 번 보낼 수 있고, 모델 생성만 중지해서는 사용자가 인터럽션을 체감하지 못하므로 클라이언트 오디오 재생도 정지해야 한다. [Audio guide](https://dev.hume.ai/docs/speech-to-speech-evi/guides/audio), [Interruptibility](https://dev.hume.ai/docs/speech-to-speech-evi/features/interruptibility) |
| **LiveKit Agents Playground/컴포넌트** | disconnected | connecting/buffering | listening | 사용자 트랙 레벨 C | thinking | speaking + 바 | playback interrupted | failed/disconnected | 상태를 정식 lifecycle로 제공하며 `BarVisualizer`가 agent state에 따라 idle/active 바로 전환된다. [Agent state](https://docs.livekit.io/frontends/build/agent-state/), [BarVisualizer](https://docs.livekit.io/reference/components/react/component/barvisualizer/), [React quickstart](https://docs.livekit.io/frontends/start/react-quickstart/) |
| **ChatGPT Advanced Voice** | 보이스 아이콘 | 화면 전환 | 마이크 활성 | 오브 반응(별도 모드) | 같은 오브의 전이 | 오브 반응 + 음성 | 자연스러운 turn 전환 | 제한/종료 메시지 | 공식 도움말은 기본 채팅 안의 통합형, floating voice orb, 별도 전체 화면의 **blue orb** 세 표현을 명시한다. mute와 종료는 별도 고정 컨트롤이다. [Voice Mode FAQ](https://help.openai.com/en/articles/8400625-voice-mode-faq%23.midi) |
| **xAI Grok Voice / Voice Playground** | 시작 CTA | 세션 연결 | 음성 채팅 | full-duplex C | background reasoning | 실시간 음성 | 빈번한 interruption 대응 | C | 공식 자료는 앱의 카메라 포함 voice chat과 브라우저 Voice Playground를 보여주며, 2026 모델은 noise/accent/interruption/turn-taking을 핵심 평가 조건으로 둔다. 특정 웹 색/파형 규격은 공개 자료에서 확인되지 않아 C로 둔다. [Grok 4 Voice Mode](https://x.ai/news/grok-4), [Grok Voice Think Fast 1.0](https://x.ai/news/grok-voice-think-fast-1), [Voice Agent API](https://x.ai/news/grok-voice-agent-api) |

### 1.2 상태별 권장 시각 문법

| 상태 | 시각 신호 | 텍스트 | 움직임 | progrok 권장 |
|---|---|---|---|---|
| idle | 중성 회색 점/바, mic-off 또는 Start | `음성 세션 시작` | 없음 | 큰 오브 금지. 시작 전에는 조용해야 한다. |
| connecting | 황색/청색 점 + 단계 표시 | `연결 중…` → `마이크 준비 중…` | 1.2초 저속 pulse | 8초 이상이면 `연결 지연`과 취소/재시도 제공. |
| listening | 청록/브랜드색 얇은 링 | `듣는 중` | 아주 약한 breathing | 발화가 없을 때도 “마이크가 열림”은 명확해야 한다. |
| user-speaking | 입력 레벨 바/파형 + 사용자색 | `말씀하세요` 또는 생략 | 실제 RMS/주파수 반응 | 장식 애니메이션이 아닌 실측 입력만 반응. |
| thinking | 입력 시각화 정지, 작은 progress dot | `응답 준비 중` | 3점 또는 얇은 링 | 오디오처럼 출렁이면 “듣는 중”과 혼동된다. |
| assistant-speaking | 출력 레벨 바 + AI색 | `Grok 말하는 중` | 출력 오디오 반응 | 입력과 출력의 색·위치를 일관되게 분리. |
| interrupted | 출력 바가 80~120ms 내 수축, 잘린 말줄임 | `중단됨`을 0.8초 toast | snap-down | 중단된 assistant transcript는 들린 지점까지만 유지. |
| error | 적색 점 + 고정 카드 | 구체 원인 + 다음 행동 | 모션 없음 | 오류 중에도 장식 pulse를 계속하지 않는다. |

이 구분은 LiveKit의 연결/청취/생각/발화 lifecycle과 OpenAI의 VAD/response 이벤트 경계를 UI 상태로 정규화한 것이다. [LiveKit Agent state](https://docs.livekit.io/frontends/build/agent-state/), [OpenAI VAD events](https://platform.openai.com/docs/api-reference/realtime-beta-server-events/conversation/item/input_audio_transcription/segment?lang=csharp)

---

## 2. 오디오 시각화 기법

### 2.1 비교

| 기법 | 장점 | 단점 | 구현 난이도 | 적합한 곳 | AI 슬롭 방지 조건 |
|---|---|---|---:|---|---|
| **블롭/오브** | 상태 전이를 감성적으로 통합, 작은 화면에서 강함 | 입력/출력/생각을 구별하기 어렵고 흔한 “AI 그라디언트 구체”가 되기 쉬움 | 높음 | 소비자용 몰입 모드 | 2색 이하, 상태마다 물리 규칙 고정, 실측 레벨 반응, 과한 glow/noise/무지개 금지 |
| **바 스펙트럼** | compact, 개발 도구에 잘 맞고 입력/출력 비교가 쉬움 | FFT를 그대로 그리면 산만함 | 낮음~중간 | progrok 기본 | 5~9개 바, 대칭 또는 저주파 중심 샘플링, 고정 폭·라운드 반경, 30fps cap |
| **시간 파형** | 실제 신호라는 인상이 강하고 디버깅에 유용 | 작은 영역에서 정보 밀도가 낮고 노이즈가 그대로 보임 | 중간 | 상세/diagnostics | 1px 선, 단색, centerline, clipping 표시가 필요할 때만 사용 |
| **링 펄스** | idle/listening/connecting 상태를 최소 공간으로 표시 | 진짜 오디오 정보를 거의 전달하지 못함 | 낮음 | 상태 배지/마이크 버튼 | 일정한 CSS pulse와 오디오 반응을 섞지 말고, “연결 중”과 “입력 감지”의 속도/색을 분리 |

Web Audio API의 `AnalyserNode`는 시간영역·주파수영역 데이터를 모두 제공하고 `smoothingTimeConstant`로 프레임 간 평균을 조절한다. MDN의 표준 예제도 `requestAnimationFrame` 안에서 `getByteTimeDomainData()`를 읽어 canvas 오실로스코프를 그린다. [MDN AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)

### 2.2 AnalyserNode 구현 스케치

```ts
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;                 // compact bars: 128 bins
analyser.smoothingTimeConstant = 0.72;  // 떨림 억제, 반응성 유지
const source = ctx.createMediaStreamSource(micStream);
source.connect(analyser);               // mic은 analyser로만; speaker 출력에 연결하지 않음

const freq = new Uint8Array(analyser.frequencyBinCount);
let previous = new Float32Array(7);

function frame() {
  analyser.getByteFrequencyData(freq);
  const next = sampleLogBins(freq, 7).map((v, i) => {
    const normalized = Math.max(0, (v - 18) / 210); // noise floor 제거
    const attack = 0.55, release = 0.16;
    const k = normalized > previous[i] ? attack : release;
    return previous[i] += (normalized - previous[i]) * k;
  });
  drawBars(next);
  requestAnimationFrame(frame);
}
```

파형은 같은 구조에서 `fftSize=1024~2048`와 `getByteTimeDomainData()`를 쓰고, 오브는 FFT 전체 대신 RMS와 spectral centroid 정도만 추출해 scale/왜곡/색온도 세 축에 제한한다. 브라우저 표준상 `frequencyBinCount`는 `fftSize`의 절반이며 smoothing은 이전 프레임과의 평균 상수다. [MDN AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)

### 2.3 “AI 슬롭”으로 보이지 않게 하는 체크리스트

1. **한 상태, 한 동작:** listening은 breathe, user-speaking은 input-reactive, thinking은 discrete dots, assistant-speaking은 output-reactive로 고정한다.
2. **가짜 반응 금지:** 무음인데 계속 크게 출렁이는 파형은 신뢰를 깬다. noise floor 이하에서는 1~2px idle로 수렴한다.
3. **색보다 구조:** 사용자/AI를 색만으로 나누지 말고 좌우 정렬, 라벨, 아이콘도 함께 쓴다.
4. **무지개 그라디언트 금지:** 브랜드 강조색 1개, 사용자/AI 보조색 각 1개, 오류색 1개면 충분하다.
5. **상태 전이는 짧게:** 120~220ms. 말 끊김은 즉시, 연결 pulse만 느리게 한다.
6. **reduced motion:** `prefers-reduced-motion`에서는 blob 변형과 pulse를 끄고 색·텍스트로 상태를 보존한다.
7. **데이터의 의미를 명시:** spectrum은 “마이크 입력”, spinner는 “모델 응답 대기”로 별개다. LiveKit의 `BarVisualizer`도 상태와 실제 audio track을 함께 입력받는다. [LiveKit BarVisualizer](https://docs.livekit.io/reference/components/react/component/barvisualizer/)

---

## 3. 실시간 트랜스크립트 UI

### 3.1 partial과 final

스트리밍 STT의 partial은 확정 문장이 아니다. Google STT는 `isFinal=false` 결과가 바뀔 수 있고 `stability`는 “정확도”가 아니라 “앞으로 덜 바뀔 가능성”이라고 정의한다. final은 해당 오디오 구간에 더 이상 가설을 반환하지 않는 결과다. [StreamingRecognitionResult](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/StreamingRecognitionResult), [Streaming STT overview](https://docs.cloud.google.com/speech-to-text/docs/v1/speech-to-text-requests)

권장 렌더링:

- **final:** 본문색 100%, 정상 weight, 메시지 버블/turn에 영구 편입.
- **partial:** 같은 turn 마지막 줄에만 유지하고 55~70% opacity, 끝에 얇은 caret 또는 `···`; 새 partial이 오면 **append가 아니라 replace**.
- **고안정 partial:** `stability`가 있다면 opacity를 조금 높일 수 있지만 final처럼 고정하지 않는다.
- **전사 실패:** 빈 버블을 남기지 말고 `음성을 전사하지 못했습니다`를 해당 사용자 turn에 작은 경고로 표시. OpenAI도 input transcription failure를 일반 오류와 분리한다. [OpenAI transcription failed](https://platform.openai.com/docs/api-reference/realtime-beta-server-events/response/output_audio_transcript)

Hume EVI도 동일 음성 구간에 여러 interim `user_message`를 보낼 수 있으므로, interim을 무시하거나 동일 세그먼트로 병합하라고 공식 가이드가 경고한다. [Hume audio guide](https://dev.hume.ai/docs/speech-to-speech-evi/guides/audio)

### 3.2 화자 구분

- 사용자 turn: 왼쪽의 `You`/마이크 아이콘, 중립색.
- assistant turn: `Grok`/스피커 아이콘, 브랜드 accent.
- system/도구: 대화 버블이 아니라 접을 수 있는 event row. 음성 대화와 네트워크 진단이 같은 위계에 있으면 읽기 어렵다.
- diarization이 있는 다자 음성은 `speaker_0` 같은 내부 ID를 그대로 보여주지 말고 `화자 1` 또는 사용자가 지정한 이름으로 매핑한다. OpenAI의 diarized transcription은 완료된 segment에 speaker 정보를 제공한다. [OpenAI Audio API reference](https://platform.openai.com/docs/api-reference/audio/voice-consent-list?lang=curl)

### 3.3 자동 스크롤

1. 사용자가 하단 48px 이내에 있을 때만 새 partial/final에 자동 스크롤한다.
2. 사용자가 위로 스크롤하면 follow mode를 즉시 해제하고 현재 위치를 유지한다.
3. 하단에 `새 대화 3개 ↓` pill을 띄워 클릭 시 복귀한다.
4. partial 교체로 높이가 바뀌어도 현재 viewport의 anchor turn을 보존한다.
5. 세션 재연결/로그 대량 유입 때 `scrollIntoView({behavior:'smooth'})`를 매 이벤트 호출하지 않는다.

이 패턴은 제품별 API 요구가 아니라 실시간 로그 UI의 설계 권고다. Vapi 공식 위젯은 voice transcript를 선택적으로 노출하고, 공식 예제는 role과 text를 turn 배열로 렌더링한다. [Vapi Web widget](https://docs.vapi.ai/chat/web-widget), [Vapi docs-agent example](https://docs.vapi.ai/assistants/examples/docs-agent)

### 3.4 지연·버퍼 표시

- 0~600ms: 별도 표시 없음.
- 600~1500ms: thinking dots만 표시.
- 1500ms 초과: `응답 준비 중 · 1.8s`처럼 실시간 경과 표시.
- 재생 버퍼가 부족하면 `음성 버퍼링…`을 assistant turn 안에 표시하고 파형을 정지한다.
- 연결 전 입력을 받는다면 `연결 중 · 음성 임시 저장 중`처럼 buffering을 명시한다. LiveKit도 `pre-connect-buffering`을 독립 상태로 정의한다. [LiveKit Agent state](https://docs.livekit.io/frontends/build/agent-state/)

---

## 4. 인터럽션(바지인) UX

좋은 바지인 UX의 핵심은 **사용자가 말을 시작하는 순간 assistant의 소리와 시각화를 함께 멈추고, 서버 대화 상태도 실제로 들은 지점에 맞추는 것**이다.

권장 순서:

1. 로컬 VAD 또는 서버 `user-started-speaking` 수신.
2. 80~120ms 안에 assistant playback gain을 0으로 내리고 queue를 비운다.
3. assistant 파형/바가 즉시 수축하고 user input visualizer가 활성화된다.
4. assistant transcript는 실제 재생된 지점까지만 확정하고, 나머지는 삭제하거나 취소선이 아닌 `…`로 잘림을 표시한다.
5. 작은 `중단됨` 라벨을 0.8초 노출하되 대화를 가리지 않는다.
6. 서버에 cancel/truncate를 보내 모델 context도 동기화한다.

Deepgram 브라우저 SDK 공식 예시는 `user-started-speaking`에서 `player.interrupt()`를 호출한다. OpenAI의 `conversation.item.truncated`는 재생되지 않은 오디오와 텍스트가 서버 문맥에 남지 않도록 transcript를 잘라낸다. LiveKit은 `PlaybackFinishedEvent`에 `interrupted`, 재생 위치, 들린 부분만 담긴 partial synchronized transcript를 제공한다. [Deepgram JavaScript SDK](https://developers.deepgram.com/docs/browser-agent-javascript), [OpenAI truncated event](https://platform.openai.com/docs/api-reference/realtime-beta-server-events/response/output_audio_transcript), [LiveKit PlaybackFinishedEvent](https://docs.livekit.io/reference/agents-js/interfaces/agents.voice.PlaybackFinishedEvent.html)

Hume는 생성 중단만으로는 사용자가 인터럽션을 체감하지 못하므로 재생 중인 오디오도 정지해야 한다고 명시한다. Cartesia Line은 실시간 interruption/turn-taking을 기본 기능으로 제공한다. [Hume Interruptibility](https://dev.hume.ai/docs/speech-to-speech-evi/features/interruptibility), [Cartesia Line](https://github.com/cartesia-ai/line)

**피해야 할 것:** assistant 문장을 끝까지 화면에 남기기, 파형이 계속 움직이기, 사용자 발화를 `thinking`으로 덮기, 짧은 기침을 무조건 barge-in으로 처리하기. false interruption에는 짧은 grace window 후 재생 재개가 필요하며 LiveKit turn tuning도 false interruption resume 옵션을 제공한다. [LiveKit turn-taking tuning](https://docs.livekit.io/agents/logic/turns/tuning/)

---

## 5. 오류 상태 UX

### 5.1 오류별 화면과 복구 동작

| 오류 | 감지 | 사용자 문구 | 1차 CTA | 보조 정보 |
|---|---|---|---|---|
| 마이크 권한 거부 | `NotAllowedError` | `마이크 권한이 꺼져 있습니다` | `브라우저 설정 열기` 또는 짧은 설정 안내 | HTTPS/iframe policy 문제 가능성도 diagnostics에 표시 |
| 마이크 없음 | `NotFoundError` | `사용 가능한 마이크를 찾지 못했습니다` | `다시 검색` | 오디오 입력 선택 UI와 `기기 연결 후 재시도` |
| 장치 사용 불가 | `NotReadableError` | `다른 앱이 마이크를 사용 중일 수 있습니다` | `다시 시도` | 기기명은 노출 가능할 때만 |
| 권한 응답 대기 | Promise 미결정 | 8초 후 `브라우저의 권한 팝업을 확인하세요` | `취소` | 무한 spinner 금지 |
| 네트워크 일시 단절 | socket close/heartbeat timeout | `연결이 끊겼습니다 · 재연결 중 2/5` | 자동 backoff + `지금 재시도` | 마지막 성공 시각, local transcript 보존 |
| 서버 fatal error | typed Error | `세션을 계속할 수 없습니다` | `새 세션` | 접힌 상세에 code/request ID |
| 서버 warning | typed Warning | 작은 amber toast | 보통 없음 | 세션은 유지; 로그에 code 저장 |
| 전사만 실패 | transcription failed | 해당 turn에 `전사 실패` | `다시 말하기` | 음성 세션 전체를 종료하지 않음 |

브라우저 표준상 권한 거부는 `NotAllowedError`, 일치하는 입력 장치 없음은 `NotFoundError`이며, 사용자가 권한 팝업을 무시하면 Promise가 resolve/reject되지 않을 수도 있다. 또한 `getUserMedia()`는 secure context가 필요하다. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

Deepgram은 fatal `Error`와 세션을 계속할 수 있는 `Warning`을 분리하고, fatal 연결 오류에는 재접속을 권한다. Deepgram의 브라우저 `AgentSession`은 exponential backoff 재연결과 서버 설정 승인 전 오디오 버퍼링을 담당한다. [Deepgram Errors & Warnings](https://developers.deepgram.com/docs/voice-agent-errors-warnings), [Deepgram JavaScript SDK](https://developers.deepgram.com/docs/browser-agent-javascript)

### 5.2 오류 화면 원칙

- 색만 빨갛게 바꾸지 말고 **무슨 문제인지 + 지금 할 행동 + 기술 상세**를 3단으로 제공한다.
- 재연결 중에는 transcript를 지우지 않는다.
- 마이크 권한 문제와 서버 연결 문제를 같은 `Something went wrong`으로 합치지 않는다.
- 자동 재시도는 횟수와 다음 시도까지 시간을 보여준다.
- 개발자 도구이므로 접힌 diagnostics에 WebSocket close code, last event, request/session ID를 제공하되 토큰은 절대 표시하지 않는다.

---

## 6. progrok에 맞는 것과 과한 것

### 채택 권장

1. **LiveKit식 명시적 상태 머신:** `connecting/listening/thinking/speaking/failed`를 UI의 단일 상태로 정규화. [LiveKit Agent state](https://docs.livekit.io/frontends/build/agent-state/)
2. **OpenAI Realtime Console식 event drawer:** 사용자용 대화 화면과 raw event inspector를 분리하되 한 세션 안에서 연결. [OpenAI Realtime Console](https://github.com/openai/openai-realtime-console)
3. **ElevenLabs식 상태 텍스트:** `듣는 중`, `말하는 중`을 시각화와 함께 명시. [ElevenLabs widget](https://elevenlabs.io/docs/eleven-agents/customization/widget)
4. **LiveKit식 5~9 bar visualizer:** 작고 구현이 견고하며 상태와 실제 track을 함께 반영. [LiveKit React quickstart](https://docs.livekit.io/frontends/start/react-quickstart/)
5. **partial/final 교체 모델:** partial 한 줄을 덮어쓰고 final만 history에 확정. [Google Streaming STT](https://docs.cloud.google.com/speech-to-text/docs/v1/speech-to-text-requests)
6. **Deepgram/OpenAI식 즉시 barge-in:** 오디오·시각화·server context를 동시에 truncate. [Deepgram JavaScript SDK](https://developers.deepgram.com/docs/browser-agent-javascript), [OpenAI truncated event](https://platform.openai.com/docs/api-reference/realtime-beta-server-events/response/output_audio_transcript)
7. **원인별 오류 카드:** 권한/장치/네트워크/서버/전사 오류를 분리하고 request ID를 접힌 상세에 제공. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

### 선택적으로 채택

- **작은 링/미니 오브:** 모바일 폭이나 transcript가 접힌 compact 모드의 상태 앵커로만 사용.
- **전체 파형:** 기본 화면이 아니라 diagnostics drawer의 입력/출력 레벨 검사에 사용.
- **음성+텍스트 전환:** Vapi/ElevenLabs처럼 modality toggle을 제공하되 첫 화면의 중심 기능으로 만들 필요는 없다. [Vapi Web widget](https://docs.vapi.ai/chat/web-widget), [ElevenLabs widget](https://elevenlabs.io/docs/eleven-agents/customization/widget)

### 과함 / 비권장

- **ChatGPT식 전체 화면 대형 오브 복제:** ChatGPT는 별도 blue orb 몰입 모드를 공식 지원하지만 progrok은 상태와 이벤트를 검사해야 하는 로컬 개발 도구다. [ChatGPT Voice FAQ](https://help.openai.com/en/articles/8400625-voice-mode-faq%23.midi)
- **WebGL 유체/파티클 셰이더:** 상태 정보 대비 GPU·접근성·테스트 비용이 크다.
- **감정별 다색 오브:** Hume처럼 감정 모델 자체가 제품 핵심인 경우가 아니라면 색의 의미가 모호하다.
- **항상 움직이는 가짜 파형:** 연결·무음·생각 상태를 구분하지 못하게 한다.
- **전체 화면 블러/네온 glow:** 로컬 툴의 로그·텍스트 대비를 훼손하고 흔한 생성형 AI 랜딩 페이지 인상을 준다.
- **transcript 없는 voice-only UI:** 디버깅, 재현, 접근성, 오류 확인을 모두 약화한다. Vapi 위젯도 transcript 표시 옵션을 기본 제공한다. [Vapi Web widget](https://docs.vapi.ai/chat/web-widget)

---

## 7. progrok 권장 화면 구조

```text
┌ Voice session ─────────────── Connected · 00:42 ─ [device] [end] ┐
│                                                                  │
│         ▂ ▅ █ ▆ ▃        듣는 중                                │
│   입력: MacBook Microphone · -24 dB          latency 184 ms      │
│                                                                  │
│   You   오늘 서울 날씨하고…                         (partial)    │
│   You   오늘 서울 날씨하고 일정도 같이 알려줘.       (final)      │
│   Grok  확인해볼게요.                                              │
│                                                                  │
│                                         [새 대화 2개 ↓]           │
├ Diagnostics ▸  ws connected · vad speech_started · response... ┤
│ [mute] [push-to-talk] [auto VAD]                   [clear local] │
└──────────────────────────────────────────────────────────────────┘
```

핵심은 중앙의 시각화보다 **상태 텍스트, transcript, 지연, 장치, 이벤트 근거가 동시에 읽히는 것**이다. compact 모드에서는 transcript와 diagnostics를 접고 미니 바+상태+mute/end만 남긴다.

### 최소 구현 우선순위

1. 상태 reducer와 상태별 문구/색.
2. 입력·출력 각각의 7-bar AnalyserNode 시각화.
3. turn ID 기반 partial replace/final commit transcript.
4. user-scroll-aware follow mode.
5. barge-in 시 playback stop + transcript truncate.
6. 권한/장치/네트워크 오류 카드.
7. 접을 수 있는 raw event diagnostics.
8. 마지막에만 미니 오브/브랜드 모션을 선택적으로 추가.

---

## 8. 출처와 해석상의 한계

- OpenAI Realtime Console, LiveKit, Vapi, ElevenLabs, Deepgram, Hume는 공식 문서 또는 공식 저장소에서 UI 상태에 연결되는 이벤트/컴포넌트를 확인했다.
- ChatGPT는 공식 FAQ가 integrated/floating/separate blue orb 표현을 명시한다. [OpenAI Voice Mode FAQ](https://help.openai.com/en/articles/8400625-voice-mode-faq%23.midi)
- xAI 공식 자료는 Grok 앱 voice chat, 브라우저 Voice Playground, interruption 중심 성능을 확인해 주지만 상태별 웹 색/파형 디자인 시스템은 공개하지 않는다. 따라서 비교표의 세부 외형은 추정하지 않았다. [Grok 4](https://x.ai/news/grok-4), [Grok Voice Agent API](https://x.ai/news/grok-voice-agent-api)
- Cartesia의 공개 최신 자료는 agent orchestration과 LiveKit 기반 프런트엔드 경로를 보여주지만 독자적인 2026 웹 위젯의 상태별 시각 문법은 충분히 공개하지 않는다. [Cartesia LiveKit template](https://github.com/cartesia-ai/cartesia-livekit-voice-agent), [Cartesia Line](https://github.com/cartesia-ai/line)
- Retell의 이벤트 표면은 공식 changelog와 배포 SDK 문서로 확인했으며, 시각 스타일은 구현자 책임이다. [Retell changelog](https://www.retellai.com/changelog), [Retell client SDK](https://www.npmjs.com/package/retell-client-js-sdk)

따라서 이 문서의 **제품 사실**은 URL로 검증 가능한 범위에 제한하고, “progrok 권장”은 해당 사실을 로컬 개발자 도구 맥락에 적용한 설계 판단으로 분리했다.
