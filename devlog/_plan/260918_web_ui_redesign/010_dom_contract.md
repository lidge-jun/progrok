# progrok 웹 UI DOM 계약 인벤토리

## 목적과 조사 범위

이 문서는 `src/web/public/index.html`을 전면 재작성할 때 현재 클라이언트 TypeScript가 깨지지 않도록 보존해야 하는 DOM 계약을 정리한다. 조사 범위는 `src/web/client/*.ts` 11개 파일, `src/web/server.ts`, `src/web/public/index.html`, `src/web/public/style.css` 전체다. 아래의 “필수”는 **현재 JS를 수정하지 않고 HTML/CSS만 재디자인할 때**의 의미다.

## 1. 정적 DOM 계약: ID, 선택자, 요소 타입

### 1.1 부팅 시 반드시 존재해야 하는 ID

`required()`는 `document.querySelector()` 결과가 없으면 즉시 예외를 던진다(`src/web/client/app.ts:7-10`). 따라서 아래 ID 중 하나라도 없으면 컨트롤러 생성 또는 치명 오류 표시 과정이 중단된다.

| ID | 현재/기대 요소 타입 | JS 근거 | 용도와 타입 변경 시 파손 지점 |
|---|---|---|---|
| `workspace-tabs` | `HTMLElement`, 실제 `nav` | `src/web/client/app.ts:22`; `src/web/client/render.ts:128-140` | 내부의 `[role="tab"]` 버튼을 찾는 탭 루트. 요소 태그 자체는 자유지만, 자식 탭 계약은 필수다. |
| `voice-mode` | `HTMLSelectElement` | `src/web/client/app.ts:25`; `src/web/client/voice.ts:33-43` | `.value`, `change` 이벤트, `disabled`를 사용한다. select가 아니면 옵션/모드 선택 UX와 타입 계약이 깨진다. |
| `voice-model` | `HTMLInputElement` | `src/web/client/app.ts:26`; `src/web/client/voice.ts:35,190,372` | `.value.trim()`과 `disabled` 사용. 텍스트 입력 호환 요소가 아니면 모델 읽기가 깨진다. |
| `voice-name` | `HTMLSelectElement` | `src/web/client/app.ts:27`; `src/web/client/voice.ts:36,309,373` | 선택된 voice의 `.value`, `disabled` 사용. |
| `voice-start` | `HTMLButtonElement` | `src/web/client/app.ts:28`; `src/web/client/voice.ts:37,68,72,378` | 클릭 시작, `disabled` 제어. 다른 태그면 버튼 의미/키보드 동작과 타입 계약이 깨진다. |
| `voice-finish` | `HTMLButtonElement` | `src/web/client/app.ts:29`; `src/web/client/voice.ts:38,73,374,380` | STT finalize 클릭, `hidden`/`disabled` 제어. |
| `voice-stop` | `HTMLButtonElement` | `src/web/client/app.ts:30`; `src/web/client/voice.ts:39,74,379` | stop 클릭과 `disabled` 제어. |
| `voice-status` | `HTMLElement` | `src/web/client/app.ts:31`; `src/web/client/voice.ts:40,383-387` | 상태 텍스트 및 `data-state` 기록. 태그는 자유지만 live-region 의미를 보존해야 한다. |
| `voice-user-transcript` | `HTMLElement` | `src/web/client/app.ts:32`; `src/web/client/voice.ts:41,93-95,246-256,274-277` | 사용자 전사 `textContent`, STT 최종 여부 `data-final`. 입력 요소로 바꾸면 `.value`가 아닌 `textContent`에 쓰이므로 화면에 안 보일 수 있다. |
| `voice-assistant-transcript` | `HTMLElement` | `src/web/client/app.ts:33`; `src/web/client/voice.ts:42,94,278-285` | 응답 전사 `textContent` 전체 교체/문자열 누적. 입력 요소로 바꾸면 표시가 깨진다. |
| `chat-model` | `HTMLSelectElement` | `src/web/client/app.ts:41`; `src/web/client/chat.ts:24-34,140-148` | 런타임 모델 `Option` 삽입, `.options[0]`, `.value`, `disabled` 사용. 반드시 select여야 한다. |
| `session-list` | `HTMLElement` | `src/web/client/app.ts:42`; `src/web/client/chat.ts:320-337` | 세션 버튼 전체를 `replaceChildren()`로 재생성. 태그는 자유지만 내부 정적 콘텐츠는 유지되지 않는다. |
| `messages` | `HTMLElement` | `src/web/client/app.ts:43`; `src/web/client/chat.ts:301-315` | 메시지 트리 전체 교체, `scrollTop/scrollHeight` 사용. 스크롤 가능한 일반 컨테이너여야 한다. |
| `chat-form` | `HTMLFormElement` | `src/web/client/app.ts:44`; `src/web/client/chat.ts:28,212-224` | `submit` 이벤트 및 `requestSubmit()` 호출. 반드시 form이어야 한다. |
| `chat-input` | `HTMLTextAreaElement` | `src/web/client/app.ts:45`; `src/web/client/chat.ts:29,215-230` | `.value`, `keydown`, `.focus()`, `disabled` 사용. textarea가 아닌 경우 줄바꿈/키보드 및 타입 계약이 달라진다. |
| `chat-send` | `HTMLButtonElement` | `src/web/client/app.ts:46`; `src/web/client/chat.ts:30,120-121,339` | form submit 버튼, `disabled`와 `hidden` 제어. `type="submit"`도 보존해야 한다(`src/web/public/index.html:61`). |
| `chat-stop` | `HTMLButtonElement` | `src/web/client/app.ts:47`; `src/web/client/chat.ts:31,226,340` | abort 클릭, `hidden` 제어. |
| `new-session` | `HTMLButtonElement` | `src/web/client/app.ts:48`; `src/web/client/chat.ts:32,122,227-231,342` | 새 세션 생성 클릭, `disabled`, 이후 입력 focus. |
| `chat-status` | `HTMLElement` | `src/web/client/app.ts:49`; `src/web/client/chat.ts:33,297,343` | 저장 오류/생성 상태/Ready 텍스트. 태그는 자유지만 live-region 유지 권장. |
| `media-kind` | `HTMLSelectElement` | `src/web/client/app.ts:54`; `src/web/client/media.ts:7-16,49-52,60-85` | image/video 모드 `.value`, `change`, `disabled`. 반드시 select 계열. |
| `media-model` | `HTMLSelectElement` | `src/web/client/app.ts:55`; `src/web/client/media.ts:9,66-70,110-139,162` | 모델 `Option` 삽입, `.options.length`, `.value`, `disabled`. 반드시 select. |
| `media-prompt` | `HTMLTextAreaElement` | `src/web/client/app.ts:56`; `src/web/client/media.ts:10,65,113-120,135,148` | 프롬프트 `.value`, `disabled`; 이미지 alt와 비디오 aria-label에도 재사용. |
| `media-form` | `HTMLFormElement` | `src/web/client/app.ts:57`; `src/web/client/media.ts:11,45-57` | submit 처리 및 모든 미디어 하위 선택자의 검색 범위. 반드시 form이며 옵션/취소 요소가 그 자손이어야 한다. |
| `media-submit` | `HTMLButtonElement` | `src/web/client/app.ts:58`; `src/web/client/media.ts:12,70,104,162` | submit과 `disabled` 제어. `type="submit"` 보존(`src/web/public/index.html:149`). |
| `media-progress` | `HTMLProgressElement` | `src/web/client/app.ts:59`; `src/web/client/media.ts:13,71,132,177-183` | `value`, `removeAttribute("value")`, `hidden` 사용. progress가 아니면 determinate/indeterminate 의미와 `.value` 계약이 깨진다. |
| `media-status` | `HTMLElement` | `src/web/client/app.ts:60`; `src/web/client/media.ts:14,82-85,107,130,140,150,154-158,180-183` | 준비/제출/진행률/완료/오류 텍스트. live-region 유지 권장. |
| `media-results` | `HTMLElement` | `src/web/client/app.ts:61`; `src/web/client/media.ts:15,106,128,149` | 실행 시작 시 자식 전체 제거 후 figure/image/video 삽입. 정적 자식은 보존되지 않는다. |
| `fatal-error` | `HTMLElement` | `src/web/client/app.ts:66-68` | 모델 초기화 예외 시 `hidden=false`, 오류 `textContent`. 이 ID까지 없으면 catch 안에서 다시 예외가 난다. |

초기 HTML의 실제 요소는 위 타입과 일치한다(`src/web/public/index.html:21-23,33-67,75-109,121-165`).

### 1.2 부팅 후 간접적으로 요구되는 ID와 구조

| 선택자/ID | 근거 | 계약 |
|---|---|---|
| `#workspace-tabs [role="tab"]` | `src/web/client/render.ts:128-131` | 탭은 현재 `HTMLButtonElement`로 간주된다. 각 탭은 `aria-controls`로 패널 ID를 가리켜야 한다. |
| 탭의 `aria-controls` → 패널 ID | `src/web/client/render.ts:133-140` | `aria-controls` 값을 `document.getElementById()`에 넘겨 패널의 `hidden`을 토글한다. 현재 `chat-panel`, `voice-panel`, `media-panel` 연결은 `src/web/public/index.html:34-36,43,67,114`에 있다. 이름을 바꾸는 것은 가능하지만 양쪽을 동시에 바꿔야 한다. |
| `#media-cancel` | `src/web/client/media.ts:45-47,57,105,163` | `#media-form` 자손일 때만 선택되는 선택적 button. 없으면 취소 UI만 사라지고 생성은 동작한다. 유지한다면 button이어야 한다. |
| `#image-count` | `src/web/client/media.ts:87-90,114` | `#media-form` 자손 input. 없거나 숫자가 아니면 1로 폴백한다. 현재 number 제약은 `src/web/public/index.html:132-133`. |
| `#video-duration` | `src/web/client/media.ts:87-90,136` | form 자손 input. 누락/비수치 시 5로 폴백. |
| `#video-aspect` | `src/web/client/media.ts:93-97,137` | form 자손 input/select. 누락/빈 값 시 `16:9`. |
| `#video-resolution` | `src/web/client/media.ts:93-97,138` | form 자손 input/select. 누락/빈 값 시 `480p`. |
| `#chat-panel button/select/textarea`, `#media-panel button/select/textarea` | `src/web/client/app.ts:13-18` | 모델 목록 초기화 실패 시 이 두 패널 내부의 해당 native control만 일괄 disable한다. 패널 ID/내부 native 태그를 바꾸면 fail-safe가 적용되지 않는다. Voice 패널은 의도적으로 제외된다. |

## 2. JS가 생성·변경하는 class, data, hidden, disabled, ARIA 계약

### 2.1 클래스 및 `data-*`

현재 JS는 `classList.toggle()`을 사용하지 않는다. 대신 런타임 노드 생성 시 `className`을 지정하고, 상태는 `data-*`에 기록한다.

| 신호 | 생성/변경 위치 | 목적 | 현재 CSS 소비 |
|---|---|---|---|
| `.empty-state` | `src/web/client/chat.ts:303-311` | 빈 채팅 안내 컨테이너 | `src/web/public/style.css:204-217` |
| `.message`, `.message--user`, `.message--assistant` | `src/web/client/render.ts:97-100` | 메시지 공통 및 role별 스타일 | `src/web/public/style.css:219-225` (`message--assistant` 전용 규칙은 현재 없음) |
| `.message__label`, `.message__body` | `src/web/client/render.ts:106-112` | 메시지 작성자/본문 | `src/web/public/style.css:220-224` |
| `.reasoning` | `src/web/client/render.ts:114-122` | reasoning details | `src/web/public/style.css:230-231` |
| `.tool-call`, `.tool-call__status`, `.tool-call__payload` | `src/web/client/render.ts:42-63` | tool details, 상태, payload | `src/web/public/style.css:225,230-236` |
| `.citation-list`, `.muted` | `src/web/client/render.ts:71-92` | citation 목록/빈 payload | `src/web/public/style.css:94,237` |
| `article[data-status]` | `src/web/client/render.ts:97-104` | 메시지 상태(`composing/queued/streaming/complete/stopped/failed`) | 현재 streaming/stopped/failed 후속 문구를 CSS로 표시(`src/web/public/style.css:226-229`) |
| `details.tool-call[data-status]` | `src/web/client/render.ts:53-62` | 도구 상태(`queued/running/complete/failed`) | failed 색상 변경(`src/web/public/style.css:234`) |
| `#voice-status[data-state]` | `src/web/client/voice.ts:383-387` | 8개 음성 상태를 DOM에 노출 | 현재 CSS는 소비하지 않음. 재디자인의 상태 시각화 훅으로 그대로 활용 가능. |
| `#voice-user-transcript[data-final="true"]` | `src/web/client/voice.ts:93-95,246-252` | STT partial이 speech-final이 됐음을 표시 | 성공색 적용(`src/web/public/style.css:258`) |
| `.media-options--image`, `.media-options--video` | `src/web/client/media.ts:71-81` | kind 변경 시 관련 label/control의 `hidden` 토글 | HTML에서 각 label과 control 모두에 붙어 있음(`src/web/public/index.html:132-146`). 이름 또는 적용 대상을 바꾸면 옵션 전환이 깨진다. |

이 런타임 클래스들은 HTML 정적 골격의 필수 계약은 아니지만, JS를 그대로 둘 경우 생성 이름은 고정이다. CSS를 전면 교체해도 이 이름을 스타일 훅으로 쓰거나 무시할 수 있으나, 생성 마크업 자체를 바꾸려면 `render.ts` 수정이 필요하다.

### 2.2 `hidden` 조작

| 대상 | 조작 | 근거 |
|---|---|---|
| `fatal-error` | 초기 오류 시 표시 | `src/web/client/app.ts:64-68` |
| 탭 패널 | 선택 탭만 표시 | `src/web/client/render.ts:133-140` |
| `chat-send` / `chat-stop` | 생성 중 send 숨김, stop 표시 | `src/web/client/chat.ts:338-340` |
| `voice-finish` | realtime에서는 숨기고 STT에서 표시 | `src/web/client/voice.ts:370-380` |
| `media-progress` | image에서는 숨기고 video에서는 표시 | `src/web/client/media.ts:60-72` |
| `.media-options--image/video` | kind에 맞춰 상호 토글 | `src/web/client/media.ts:72-81` |
| `media-cancel` | 요청 중 표시, 종료 시 숨김 | `src/web/client/media.ts:100-105,160-164` |

`[hidden] { display: none !important; }`가 실제 비표시를 보장한다(`src/web/public/style.css:61`). 새 CSS가 `display`를 강제로 덮더라도 `hidden` 의미가 유지되도록 이 규칙 또는 동등 동작을 보존해야 한다.

### 2.3 `disabled` 조작

| 영역 | 신호 | 근거 |
|---|---|---|
| 초기 모델 로드 | chat/media control은 HTML에서 disabled로 시작하고, 성공 후 활성화 | `src/web/public/index.html:21,47,58,61,124,129,131,149`; `src/web/client/chat.ts:111-125`; `src/web/client/media.ts:60-70` |
| fatal 모델 오류 | chat/media panel의 button/select/textarea 모두 disable | `src/web/client/app.ts:13-18,64-68` |
| chat 생성 중 | model/new-session disable; send/stop은 hidden으로 교대 | `src/web/client/chat.ts:338-343` |
| voice 모드 | STT에서 model/voice disable, realtime에서 활성화 | `src/web/client/voice.ts:370-374` |
| voice active | start disable, stop enable; finish는 STT+listening에서만 enable | `src/web/client/voice.ts:375-380` |
| media 요청 | submit disable; 종료 후 모델 옵션 유무에 따라 복원 | `src/web/client/media.ts:100-105,160-164` |

### 2.4 ARIA와 키보드 조작

| 신호 | 근거 | 계약 |
|---|---|---|
| 탭 `aria-selected`, `tabIndex` | `src/web/client/render.ts:133-141` | roving tabindex 탭 패턴. 최초 탭들에 `role="tab"`, `aria-controls`가 필요하다. |
| 탭 키보드 Arrow/Home/End | `src/web/client/render.ts:144-159` | 탭 요소가 focus 가능한 button이라는 전제. |
| 세션 `aria-current="true"` | `src/web/client/chat.ts:320-327` | 현재 세션 버튼을 표시. 매 렌더마다 버튼을 새로 만들므로 비활성 버튼에는 속성이 남지 않는다. |
| 메시지 `aria-label` | `src/web/client/render.ts:97-104` | role과 상태를 결합해 동적 article에 부여. |
| 생성 비디오 `playsinline`, `aria-label` | `src/web/client/media.ts:143-149` | 모바일 inline 재생 및 프롬프트 기반 이름. |
| 정적 live-region | `src/web/public/index.html:41,48,50,98,156` | fatal은 `role="alert"`; chat/voice/media status와 messages는 status/live 영역이다. JS가 속성을 재생성하지 않으므로 HTML 재작성 시 직접 보존해야 한다. |

## 3. Voice 상태 전이와 UI 신호

### 3.1 상태 집합과 공통 반영 방식

상태 집합은 `idle`, `requesting-permission`, `minting-secret`, `connecting`, `listening`, `speaking`, `stopped`, `failed`다(`src/web/client/contracts.ts:42-51`). `setStatus()`는 항상 (1) 내부 상태 갱신, (2) `#voice-status.dataset.state` 갱신, (3) status 텍스트 갱신, (4) controls 재동기화를 수행한다(`src/web/client/voice.ts:383-387`). 기본 텍스트 매핑은 다음과 같다(`src/web/client/voice.ts:22-31`).

| 상태 | 진입 조건 | status 텍스트 | 컨트롤 결과 |
|---|---|---|---|
| `idle` | 초기 상태. `init()`은 `setStatus()`가 아니라 직접 텍스트만 설정 | `Microphone is idle` | active=false: start는 capability에 따라, stop disabled, finish는 STT라도 listening이 아니므로 disabled. 초기에는 `data-state`가 설정되지 않는 점에 주의(`src/web/client/voice.ts:64-80`). |
| `requesting-permission` | start 후 `getUserMedia()` 직전 | `Waiting for microphone permission` | active=true: start disabled, stop enabled, finish disabled (`src/web/client/voice.ts:83-102,375-380`). |
| `minting-secret` | client secret 요청 직전 | `Creating a one-use connection secret` | active=true (`src/web/client/voice.ts:183-195`). |
| `connecting` | secret 획득 후 WebSocket 생성 직전 | `Connecting to xAI Voice` | active=true (`src/web/client/voice.ts:187-196`). |
| `listening` | 소켓 open 후 worklet 연결 완료; playback 종료; speech_started; response.done이며 재생 없음 | `Listening` | start disabled, stop enabled, STT에서만 finish enabled (`src/web/client/voice.ts:199-227,205-210,270-287,375-380`). |
| `speaking` | PCM playback queue에 audio source가 enqueue됨 | `Grok is speaking` | active=true; finish는 STT가 아니므로 disabled (`src/web/client/pcm-playback.ts:24-47`; `src/web/client/voice.ts:205-211,280-281`). |
| `stopped` | 사용자 stop, 연결 abort, 정상 STT terminal close, response.cancelled | `Voice stopped` | active=false: start enabled(지원 시), stop/finish disabled (`src/web/client/voice.ts:125-140,149-172,286-290`). |
| `failed` | capability 부족, socket error/비정상 close, 파싱/API 오류 등 | 기본 `Voice connection failed` 대신 대개 구체적 오류 문자열 | socket/media/playback 정리 후 active=false (`src/web/client/voice.ts:83-86,112-145,238-243,257-259,291-294,390-395`). |

모드 변경은 먼저 `stop(false)`를 비동기로 호출하고 즉시 controls를 동기화한다(`src/web/client/voice.ts:75-78`). realtime 중 stop은 `response.cancel`을 보내고 정리하며, STT의 일반 stop은 `audio.done`을 보낸 뒤 최대 2초 drain한다(`src/web/client/voice.ts:149-171`).

### 3.2 트랜스크립트와 응답 UI 신호

| 이벤트/행동 | UI 반영 | 근거 |
|---|---|---|
| 새 start | user/assistant `textContent`를 빈 문자열로 만들고 user의 `data-final` 제거 | `src/web/client/voice.ts:88-96` |
| STT `transcript.partial` | user text를 최신 `event.text`로 교체; `speech_final`이면 `data-final="true"` | `src/web/client/voice.ts:246-252` |
| STT `transcript.done` | terminal 표시, 비어 있지 않은 최종 text로 교체; drain 중이면 socket close | `src/web/client/voice.ts:253-256` |
| realtime input transcription updated/completed | user text를 `event.transcript`로 교체 | `src/web/client/voice.ts:273-277` |
| `response.created` | assistant text 비움 | `src/web/client/voice.ts:278-280` |
| output transcript delta | assistant `textContent += delta` | `src/web/client/voice.ts:282-283` |
| output transcript done | assistant text를 최종 transcript로 교체 | `src/web/client/voice.ts:284-285` |
| binary/output audio | playback enqueue가 speaking/listening 상태를 간접 전환 | `src/web/client/voice.ts:230-236,280-287`; `src/web/client/pcm-playback.ts:24-47` |
| 오류 | status에 구체 오류 문자열; 트랜스크립트 자체에는 오류를 쓰지 않음 | `src/web/client/voice.ts:390-395` |

### 3.3 오디오 레벨/볼륨 훅

- 현재 `AnalyserNode`, RMS/peak 계산, 볼륨 meter 데이터, `requestAnimationFrame` 샘플링은 **없다**.
- 입력 PCM은 이미 `MediaStreamAudioSourceNode → AudioWorkletNode("pcm-capture") → gain=0 → destination` 그래프를 지난다(`src/web/client/voice.ts:212-226`). worklet은 각 입력 채널을 16-bit PCM으로 다운샘플링해 `port.postMessage()`로 보낸다(`src/web/client/pcm-worklet.ts:30-51`).
- 가장 자연스러운 입력 레벨 훅은 두 가지다. UI thread에서 시각화하려면 `#source` 뒤에 `AnalyserNode`를 병렬 연결하고 rAF로 time-domain 값을 읽는 방식이 기존 네트워크 PCM 메시지를 건드리지 않는다. 더 정확히 전송 PCM과 동일한 샘플을 쓰려면 worklet에서 PCM과 함께 RMS/peak 메타데이터를 별도 메시지로 보내되, 현재 `onmessage`가 모든 `event.data`를 그대로 socket에 보내므로 메시지 타입을 구분하도록 `voice.ts:218-222`도 함께 바꿔야 한다.
- 출력 레벨 훅은 현재 각 `AudioBufferSourceNode`가 바로 `context.destination`에 연결된다(`src/web/client/pcm-playback.ts:24-40`). 출력 meter가 필요하면 `PcmPlaybackQueue`에 공유 `GainNode`/`AnalyserNode`를 주입하거나 queue 내부 공통 bus를 만들어 모든 source가 그 bus를 거치게 하는 위치가 자연스럽다.
- stop 시 worklet/source/silent sink/context를 정리한다(`src/web/client/voice.ts:352-367`). 새 analyser와 rAF도 이 경로에서 disconnect/cancel해야 누수가 없다.

## 4. 반드시 보존할 계약과 자유 영역

### 4.1 JS를 수정하지 않는 재디자인에서 반드시 보존

1. §1.1의 모든 필수 ID와 명시된 native 요소 타입.
2. `#workspace-tabs` 아래의 button `[role="tab"]`, 각 탭의 `aria-controls`, 대응 패널 ID, 초기 `aria-selected/tabindex/hidden`의 일관성(`src/web/client/render.ts:128-159`).
3. `#chat-form`과 `#media-form`의 form 의미, submit 버튼의 `type="submit"`; 미디어의 옵션/취소 요소가 `#media-form` 자손이라는 구조.
4. `.media-options--image`/`.media-options--video`가 각각 label과 control 양쪽에 붙는 계약.
5. `hidden`이 실제 비표시가 되는 CSS 의미, native controls의 `disabled` 의미.
6. `media-progress`의 `<progress>` 타입과 chat/media model의 `<select>` 타입.
7. status/messages/fatal 영역의 `role` 및 `aria-live`; JS는 텍스트만 바꾸므로 재작성 시 접근성 속성을 자동 복구하지 않는다.
8. `/assets/app.js`, `/style.css`, `/favicon.svg`, `/assets/pcm-worklet.js`와 같은 self-hosted 경로. 앱 엔트리는 정적 module script다(`src/web/public/index.html:9-10,172`; `src/web/client/voice.ts:212`).
9. 런타임 생성 class/data schema를 기존 CSS로 계속 스타일링하려면 §2.1의 이름을 보존해야 한다.

### 4.2 자유롭게 변경 가능

- app shell, sidebar, topbar, panel 내부의 비계약 wrapper 태그·순서·레이아웃·정적 class 이름은 자유다. 단 필수 form 자손 및 tab 연결 범위는 유지한다.
- 정적 카피, 헤딩, eyebrow, brand, sidebar note, key hint, empty-state 초기 마크업은 바꿀 수 있다. 다만 `messages`, `session-list`, `media-results` 내부 초기 콘텐츠는 첫 렌더/실행에서 교체된다.
- 색상, 타이포그래피, spacing, breakpoint, grid, border/radius 등 CSS는 전면 교체 가능하다.
- `voice-status[data-state]`는 현재 CSS가 사용하지 않으므로 상태별 색/아이콘/애니메이션의 안전한 신규 스타일 훅이다. 단 상태 텍스트를 숨길 경우 live-region에 의미 있는 텍스트는 남겨야 한다.
- `message--assistant`, queued/complete 상태, tool queued/running/complete 상태는 현재 전용 CSS가 거의 또는 전혀 없어 새 시각화를 추가할 수 있다.
- `#media-cancel`과 네 개 미디어 세부 옵션은 런타임 관점에서 폴백 가능한 “완화된 계약”이지만, 제거하면 기능/사용자 제어가 축소되므로 전면 재디자인에서도 유지하는 편이 맞다.

## 5. CSP 및 보안 헤더 제약

`WEB_CSP`는 모든 응답에 적용된다(`src/web/server.ts:18-30,36-50,62`). 재디자인 구현 제약은 다음과 같다.

| 지시어 | 구현 영향 |
|---|---|
| `default-src 'self'` | 별도 허용이 없는 리소스는 동일 origin만 가능하다. |
| `script-src 'self'` | inline `<script>`, inline event handler(`onclick` 등), `javascript:` 실행, 외부 CDN script는 허용되지 않는다. 현재처럼 self-hosted module script를 써야 한다. nonce/hash 및 `'unsafe-inline'`/`'unsafe-eval'`은 없다(`src/web/server.ts:24`; `src/web/public/index.html:172`). |
| `style-src 'self'` | inline `<style>`와 `style="..."`, 외부 CSS CDN은 허용되지 않는다. 모든 스타일은 self-hosted stylesheet로 이동해야 한다(`src/web/server.ts:25`; `src/web/public/index.html:10`). |
| 폰트 | `font-src`가 없으므로 `default-src 'self'`로 폴백한다. Google Fonts/Adobe Fonts 등 외부 폰트 로드는 불가하며, self-hosted font 또는 system stack만 가능하다. `data:` font도 명시 허용되지 않는다. |
| `connect-src 'self' wss://api.x.ai` | fetch/SSE는 same-origin proxy, voice WebSocket은 정확히 `wss://api.x.ai`만 가능하다. 신규 analytics/API/WebSocket origin은 차단된다(`src/web/server.ts:26`; `src/web/client/api.ts:43-48,174-186`; `src/web/client/voice-socket.ts:18-31`). |
| `img-src 'self' data: blob: https://assets.grok.com https://*.x.ai` | self/data/blob 및 지정 xAI 이미지 호스트만 표시 가능하다. 임의 외부 이미지/아이콘 CDN은 차단된다. |
| `media-src 'self' blob: https://assets.grok.com https://*.x.ai` | 생성 영상/오디오는 지정 origin 또는 self/blob만 허용된다. |
| `worker-src 'self' blob:` | self-hosted worker/worklet 또는 blob worker만 가능하다. 현재 PCM worklet은 `/assets/pcm-worklet.js`라 허용된다(`src/web/client/voice.ts:212`). |
| `form-action 'self'` | form의 외부 origin submit은 금지된다. 현재 JS가 submit을 가로채므로 문제없다. |
| `base-uri 'none'` | `<base>`를 둘 수 없다. 상대 URL 기준 변경 설계는 불가하다. |
| `frame-ancestors 'none'`, `X-Frame-Options: DENY` | 앱을 iframe에 임베드할 수 없다. |
| `object-src 'none'` | `<object>/<embed>` 기반 미디어·SVG 삽입은 금지된다. |

추가로 `Permissions-Policy`는 camera/geolocation을 금지하고 microphone은 self에만 허용한다(`src/web/server.ts:47-50`). 음성은 secure context, `getUserMedia`, `AudioWorkletNode` 지원을 모두 확인하며 미지원이면 start를 disable하고 상태 문구를 바꾼다(`src/web/client/voice.ts:64-71`).

## 6. 재디자인 구현 체크리스트

| 체크 | 검증 방법 |
|---|---|
| 필수 ID/타입 | §1.1 표와 새 HTML을 1:1 대조한다. 특히 select/form/progress/textarea/button 타입을 확인한다. |
| 탭 | click 및 Arrow/Home/End 후 `aria-selected`, `tabindex`, panel `hidden`이 함께 바뀌는지 확인한다. |
| 초기/오류 | 모델 로드 전 disabled 상태와 모델 로드 실패 시 fatal banner 및 chat/media fail-safe를 확인한다. |
| chat | 새 세션, 모델 변경, submit, Cmd/Ctrl+Enter, streaming 중 send/stop 교대, stop/failed 상태 표시를 확인한다. |
| voice | STT/realtime 모드별 finish 가시성, 8개 `data-state`, 버튼 disabled, partial/final transcript, speaking→listening 복귀를 확인한다. |
| media | image/video 옵션 토글, cancel, progress의 indeterminate/determinate 전환, image/video 결과 렌더를 확인한다. |
| CSP | 브라우저 콘솔의 CSP violation이 0인지 확인하고 inline style/script 및 외부 font/icon CDN이 없는지 점검한다. |

## 결론

HTML 재작성의 가장 큰 위험은 스타일 class가 아니라 **필수 ID에 결합된 native 요소 타입과 form/tab 자손 구조**다. 시각 구조는 폭넓게 바꿀 수 있지만, 컨트롤러가 `.options`, `.value`, `requestSubmit()`, progress `.value`, `hidden`, `disabled`를 직접 사용하므로 native control을 div 기반 커스텀 위젯으로 치환하면 JS도 함께 수정해야 한다. Voice 시각화에는 이미 상태용 `data-state`와 PCM 오디오 그래프가 있으나 레벨 데이터는 아직 없으며, 입력은 `MediaStreamAudioSourceNode` 뒤 병렬 `AnalyserNode`, 출력은 playback queue 공통 bus가 가장 낮은 결합도의 확장점이다.
