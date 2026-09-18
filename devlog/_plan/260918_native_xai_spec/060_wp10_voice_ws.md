# WP10 Voice WebSocket·Realtime·SIP 구현 PRD

## 0. 결론과 단계 경계

이 단계는 xAI Voice의 세 장기 연결과 SIP 제어 경로를 네이티브 타입드 클라이언트로 구현한다.

- `wss://api.x.ai/v1/stt`: binary audio, `finalize`/`audio.done`, transcript 상태기계
- `wss://api.x.ai/v1/tts`: `text.delta`/`text.done`, `audio.delta`/`audio.done`, multi-utterance
- `wss://api.x.ai/v1/realtime`: native speech-to-speech, VAD, tool call, resumption, `force_message`, DTMF
- `POST /v2/phone-numbers`, `POST /v1/realtime/calls/{id}/refer|hangup`: SIP 등록·제어

이 단계는 STT→LLM→TTS 파이프라인을 조립하지 않는다. Grok Voice는 native end-to-end speech-to-speech 모델이라는 X 전용 근거를 따른다(`002_x_only_voice_research.md:7-16`). `grok-voice-latest`는 2026-09-18 현재 `grok-voice-think-fast-2.0`을 가리키지만 rolling alias이므로 새 realtime client의 기본값은 pinned ID로 둔다(`002_x_only_voice_research.md:20-35`, `209-236`). caller가 명시하면 alias도 그대로 전달한다.

공식 스키마 보조 원문은 다음이며 확인일은 2026-09-18이다.

- <https://docs.x.ai/voice-realtime.ws.json>
- <https://docs.x.ai/stt-streaming.ws.json>
- <https://docs.x.ai/tts-streaming.ws.json>
- <https://docs.x.ai/developers/rest-api-reference/inference/voice.md>
- <https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip.md>

## 1. 실측 우선 규칙

`001_endpoint_inventory.md:54-86`의 라이브 결과가 문서 예제보다 우선한다.

1. STT는 `transcript.created`를 받은 뒤에만 binary audio를 보낸다.
2. `transcript.partial`의 `speech_final=true` text가 utterance 최종값이다.
3. `transcript.done.text`가 빈 문자열이어도 앞의 `speech_final` text를 덮지 않는다.
4. `audio.done` 뒤 1006 close가 관측됐다. `speech_final` 또는 `transcript.done`을 이미 받았다면 `completed-with-transport-close`로 분류하고, terminal 전에 1006이면 실패다.
5. `finalize`는 현재 utterance만 확정하고 socket을 유지한다. `audio.done`은 전체 input 종료이며 `transcript.done` 뒤 연결이 닫힌다.
6. stream commit 이후 network close를 자동 retry하지 않는다.

## 2. 구조 결정

```text
voice/stt.ts, client-secrets.ts      (wp9 REST 계약)
voice/protocol.ts                    (browser-safe event 이름·타입·상수)
voice/ws-client.ts                   (WS dial/auth/frame queue + STT/TTS session)
voice/realtime.ts                    (S2S reducer/client/session)
voice/sip.ts                         (SIP REST + webhook wire types)
       │
       ├─ auth/token-store.ts        OAuth bearer snapshot
       ├─ transport/headers.ts       server-side WS auth/trace headers
       ├─ transport/fetch.ts         SIP REST
       └─ ws                         Node >=18 WebSocket client
```

구조 선택:

- `protocol.ts`는 STT/TTS/realtime event 이름·타입·공유 상수와 순수 decoder의 단일 소유자다. Node import가 전혀 없어 wp13 browser bundle이 직접 import한다.
- `ws-client.ts`는 socket lifecycle, byte budget, auth handshake, STT/TTS reducer/session만 소유하고 wire 계약과 decoder는 `protocol.ts`에서 import한다.
- `realtime.ts`는 S2S reducer/client/session만 소유하고 wire 계약과 decoder는 `protocol.ts`에서 import한다.
- `sip.ts`는 `/v2/phone-numbers`, call control, incoming webhook wire 타입만 소유한다.
- browser에서는 custom Authorization header를 만들 수 없으므로 ephemeral token을 `Sec-WebSocket-Protocol`에만 넣는다.
- server-side Node 연결은 OAuth bearer header를 쓴다. token을 URL query에 넣지 않는다.
- automatic reconnect는 없다. realtime resumption만 caller가 `conversation_id`를 명시해 새 socket으로 수행한다.

거절한 대안:

- Node 18 최소 지원에서 global `WebSocket`을 가정하지 않는다.
- WebSocket endpoint를 Express HTTP proxy의 일반 `app.all`로 흉내 내지 않는다.
- abnormal close마다 무조건 reconnect하지 않는다. STT/TTS의 binary/text commit을 중복 전송할 수 있다.
- `grok-voice-latest`를 production 기본으로 두지 않는다. alias drift가 prompt/cadence를 바꿀 수 있다는 X 근거가 있다.
- SIP signing secret, ephemeral token, bearer를 loggable error/context에 넣지 않는다.

## 3. 공개 계약과 마이그레이션

- Voice 공개 API의 권위자는 `createTtsClient(options?: VoiceClientOptions): TtsClient`, `createSttClient(options?: VoiceClientOptions): SttClient`, `createRealtimeClient(options: CreateRealtimeClientOptions, deps?: VoiceWsDeps): Promise<RealtimeClient>` 세 factory다. 호출 계약은 `createTtsClient().synthesize()`, `createSttClient().transcribe()`, `createRealtimeClient()`이며 wp12 CLI와 wp13 웹앱은 이 이름을 그대로 쓴다. `synthesizeSpeech`, `transcribeSpeech`, `connectRealtime` 같은 별도 top-level helper를 만들지 않는다.
- `~/.progrok/auth.json` 스키마와 저장 경로는 변경하지 않는다. server-side WS는 wp5의 `getValidBearerSnapshot()`을 읽기 전용으로 사용한다.
- 기존 CLI 명령은 변경하지 않는다. Voice CLI는 wp12가 추가한다.
- `/health` payload는 변경하지 않는다.
- HTTP `/v1/*` opaque relay는 유지한다. 로컬 WebSocket relay는 만들지 않으며 wp10 client와 wp13 browser는 `wss://api.x.ai`에 직접 연결한다. proxy whitelist나 WS upgrade route를 추가하지 않는다.
- browser에는 raw OAuth token을 전달하지 않는다. wp9 `POST /v1/realtime/client_secrets`로 받은 short-lived secret만 전달한다.
- SIP `call_id` 연결에는 ephemeral secret을 허용하지 않는다. 공식 계약대로 server bearer만 허용한다.
- 새 `ws`/`@types/ws` 의존성 추가와 lockfile 갱신의 단독 소유자는 wp10이다. wp11 이후 단계는 이를 추가·재설치하지 않고 `NO CHANGE — precondition`으로만 적는다. npm package 공개 계약에는 포함되지만 CLI/HTTP behavior migration은 필요 없다.

## 4. 파일 변경 manifest

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| MODIFY | `package.json` | Node 18용 `ws`, TypeScript용 `@types/ws` 추가 |
| MODIFY | `package-lock.json` | npm이 생성한 exact dependency graph |
| MODIFY | `src/transport/base-url.ts` | `/v2/phone-numbers`를 `/v1/v2/...`로 오염시키지 않는 versioned path 지원 |
| NEW | `src/voice/protocol.ts` | Node 의존 없는 STT/TTS/realtime event 이름·타입·공유 상수·decoder; wp13 browser import 경계 |
| NEW | `src/voice/ws-client.ts` | WS 인증·bounded queue·STT/TTS session |
| NEW | `src/voice/realtime.ts` | realtime session/event/reducer/resumption |
| NEW | `src/voice/sip.ts` | phone-number 등록, webhook 타입, refer/hangup |
| NEW | `tests/voice-ws.test.ts` | local WS server 기반 protocol tests |
| NEW | `tests/voice-sip.test.ts` | fake HTTP transport 기반 SIP tests |
| DELETE | 없음 | 기존 HTTP relay와 auth 저장소 유지 |

`tests/voice-ws.test.ts`의 생성 소유자는 wp10이다. `100_wp14_verification.md:284-305`는 이를 NEW로 다시 만들지 않고 **MODIFY만** 하여 보강/감사한다. `ws`/`@types/ws`와 lockfile의 추가도 wp10 단독 소유다. wp11은 같은 변경을 수행하지 않고 `NO CHANGE — precondition`으로만 기록한다.

## 5. MODIFY `package.json`

현재 `package.json:40-50`:

```json
"dependencies": {
  "commander": "^13.0.0",
  "express": "^4.21.0",
  "open": "^10.1.0"
},
"devDependencies": {
  "typescript": "^5.7.0",
  "tsup": "^8.4.0",
  "@types/express": "^4.17.0",
  "@types/node": "^22.0.0",
  "tsx": "^4.19.0"
}
```

변경 후:

```json
"dependencies": {
  "commander": "^13.0.0",
  "express": "^4.21.0",
  "open": "^10.1.0",
  "ws": "^8.18.3"
},
"devDependencies": {
  "typescript": "^5.7.0",
  "tsup": "^8.4.0",
  "@types/express": "^4.17.0",
  "@types/node": "^22.0.0",
  "@types/ws": "^8.18.1",
  "tsx": "^4.19.0"
}
```

실행 명령:

```bash
npm install ws@^8.18.3
npm install -D @types/ws@^8.18.1
```

`ws` 8.x는 공식 Voice JavaScript 예제 계열과 같은 구현이며 install script를 갖지 않는다. 구현 시 lock diff와 registry provenance를 다시 확인한다.

## 6. MODIFY `package-lock.json`

현재 `package-lock.json:7-28`의 root package에는 dependency가 `open`까지, devDependency가 `@types/node`/`tsup`/`tsx`/`typescript`만 있다.

변경 후 root package에 다음 두 항목이 추가되어야 한다.

```json
"dependencies": {
  "commander": "^13.0.0",
  "express": "^4.21.0",
  "open": "^10.1.0",
  "ws": "^8.18.3"
},
"devDependencies": {
  "@types/express": "^4.17.0",
  "@types/node": "^22.0.0",
  "@types/ws": "^8.18.1",
  "tsup": "^8.4.0",
  "tsx": "^4.19.0",
  "typescript": "^5.7.0"
}
```

`node_modules/ws`, `node_modules/@types/ws`와 npm이 요구하는 transitive entry는 설치 명령으로 생성한다. integrity/resolved 값을 손으로 쓰지 않는다.

## 7. MODIFY `src/transport/base-url.ts`

이 파일은 현재 baseline에는 아직 없고 wp6이 먼저 NEW로 만든다. 구현 직전 실제 파일을 다시 읽는다. wp6 PRD의 before 계약은 `020_wp6_transport_core.md:77-129`이며 현재 계획의 핵심은 다음과 같다.

```ts
export const XAI_PUBLIC_API_BASE_URL = "https://api.x.ai/v1";

export function normalizeXaiPath(pathname: string): string {
  const parsed = new URL(pathname, "https://local.invalid");
  const path = parsed.pathname.startsWith("/v1/") || parsed.pathname === "/v1"
    ? parsed.pathname
    : `/v1/${parsed.pathname.replace(/^\/+/, "")}`;
  return `${path}${parsed.search}`;
}

export function resolveUpstreamUrl(pathname: string, authKind: UpstreamAuthKind): URL {
  const normalized = normalizeXaiPath(pathname);
  const decision = resolveUpstreamBase(normalized, authKind);
  const suffix = normalized.replace(/^\/v1/, "");
  return new URL(`${decision.baseUrl}${suffix}`);
}
```

이대로면 `/v2/phone-numbers`가 `/v1/v2/phone-numbers`가 된다. 변경 후 versioned public path를 보존한다.

```ts
export const XAI_PUBLIC_API_ORIGIN = "https://api.x.ai";
export const XAI_PUBLIC_API_BASE_URL = `${XAI_PUBLIC_API_ORIGIN}/v1`;

const PUBLIC_VERSIONED_PATH = /^\/v\d+(?:\/|$)/;

export function normalizeXaiPath(pathname: string): string {
  const parsed = new URL(pathname, "https://local.invalid");
  const path = PUBLIC_VERSIONED_PATH.test(parsed.pathname)
    ? parsed.pathname
    : `/v1/${parsed.pathname.replace(/^\/+/, "")}`;
  return `${path}${parsed.search}`;
}

export function resolveUpstreamUrl(pathname: string, authKind: UpstreamAuthKind): URL {
  const normalized = normalizeXaiPath(pathname);
  const decision = resolveUpstreamBase(normalized, authKind);
  if (decision.kind === "public-api") return new URL(normalized, XAI_PUBLIC_API_ORIGIN);
  if (!normalized.startsWith("/v1")) {
    throw new Error("session API supports only /v1 paths");
  }
  return new URL(`${decision.baseUrl}${normalized.replace(/^\/v1/, "")}`);
}
```

테스트는 `/v1/models`, `models`, `/v2/phone-numbers`, `https://evil.invalid/v2/phone-numbers?x=1`을 넣는다. 마지막 입력은 host를 버리고 `https://api.x.ai/v2/phone-numbers?x=1`로 정규화되어야 한다. session-only 경로의 기존 판정은 유지한다.

## 8. NEW `src/voice/protocol.ts`

이 파일은 wp10이 만드는 browser-safe wire SSOT다. **어떤 Node builtin, `ws`, auth, transport 모듈도 import하지 않는다.** `src/voice/ws-client.ts`와 `src/voice/realtime.ts`는 아래 계약을 import하고, wp13의 `src/web/client/voice.ts`도 `../../voice/protocol.js`에서 동일한 이벤트 이름·타입·상수를 import한다.

```ts
export const XAI_VOICE_WS_ORIGIN = "wss://api.x.ai" as const;
export const PINNED_REALTIME_MODEL = "grok-voice-think-fast-2.0" as const;
export const REALTIME_MODEL_ALIAS = "grok-voice-latest" as const;
export const XAI_EPHEMERAL_PROTOCOL_PREFIX = "xai-client-secret." as const;
export const OPENAI_REALTIME_PROTOCOLS = ["realtime", "openai-beta.realtime-v1"] as const;

export const STT_CLIENT_EVENT_TYPES = ["finalize", "Finalize", "audio.done"] as const;
export const STT_SERVER_EVENT_TYPES = ["transcript.created", "transcript.partial", "transcript.done", "error"] as const;
export const TTS_CLIENT_EVENT_TYPES = ["text.delta", "text.done"] as const;
export const TTS_SERVER_EVENT_TYPES = ["audio.delta", "audio.done", "error"] as const;
export const REALTIME_CLIENT_EVENT_TYPES = [
  "session.update", "input_audio_buffer.append", "input_audio_buffer.commit", "input_audio_buffer.clear",
  "conversation.item.create", "conversation.item.delete", "conversation.item.truncate",
  "response.create", "response.cancel", "pong",
] as const;
export const REALTIME_SERVER_EVENT_TYPES = [
  "session.created", "session.updated", "conversation.created", "conversation.item.added",
  "conversation.item.created", "conversation.item.deleted", "conversation.item.truncated",
  "conversation.item.input_audio_transcription.updated", "conversation.item.input_audio_transcription.completed",
  "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "input_audio_buffer.committed",
  "input_audio_buffer.cleared", "input_audio_buffer.timeout_triggered", "input_audio_buffer.dtmf_event_received",
  "response.created", "response.done", "response.output_item.added", "response.output_item.done",
  "response.content_part.added", "response.content_part.done", "response.output_audio.delta",
  "response.output_audio.done", "response.output_audio_transcript.delta", "response.output_audio_transcript.done",
  "response.text.delta", "response.output_text.delta", "response.function_call_arguments.delta",
  "response.function_call_arguments.done", "mcp_list_tools.in_progress", "mcp_list_tools.completed",
  "mcp_list_tools.failed", "response.mcp_call_arguments.delta", "response.mcp_call_arguments.done",
  "response.mcp_call.in_progress", "response.mcp_call.completed", "response.mcp_call.failed",
  "response.cancelled", "ping", "error",
] as const;

export type EphemeralProtocolStyle = "xai" | "openai-compatible";
export function ephemeralProtocols(secret: string, style: EphemeralProtocolStyle = "xai"): string[] {
  if (!secret || /[\r\n,]/.test(secret)) throw new RangeError("invalid ephemeral client secret");
  return style === "xai"
    ? [`${XAI_EPHEMERAL_PROTOCOL_PREFIX}${secret}`]
    : [OPENAI_REALTIME_PROTOCOLS[0], `openai-insecure-api-key.${secret}`, OPENAI_REALTIME_PROTOCOLS[1]];
}

export interface StreamingSttWord {
  text: string; start: number; end: number; confidence?: number; speaker?: number;
}
export type SttClientControl =
  | { type: "finalize" | "Finalize"; channel?: number }
  | { type: "audio.done" };
export type SttServerEvent =
  | { type: "transcript.created"; id: string }
  | { type: "transcript.partial"; text: string; words: StreamingSttWord[]; is_final: boolean; speech_final: boolean; start: number; duration: number; channel_index?: number; end_of_turn_confidence?: number }
  | { type: "transcript.done"; text: string; words: StreamingSttWord[]; duration: number; channel_index?: number }
  | { type: "error"; message: string };

export type TtsClientEvent =
  | { type: "text.delta"; delta: string }
  | { type: "text.done" };
export interface StreamingAudioTimestamps { graph_chars: string[]; graph_times: [number, number][] }
export type TtsServerEvent =
  | { type: "audio.delta"; delta: string; audio_timestamps?: StreamingAudioTimestamps; audio_duration?: number }
  | { type: "audio.done"; trace_id?: string }
  | { type: "error"; message: string };

export type RealtimeVoiceModel = typeof PINNED_REALTIME_MODEL | typeof REALTIME_MODEL_ALIAS;
export type RealtimeReasoningEffort = "high" | "none";
export type RealtimeAudioType = "audio/pcm" | "audio/pcmu" | "audio/pcma" | "audio/opus";
export type RealtimeAudioRate = 8000 | 11025 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RealtimeAudioTransport = "json" | "binary";
export interface RealtimeAudioFormat { type: RealtimeAudioType; rate?: RealtimeAudioRate }
export interface RealtimeTurnDetection {
  type: "server_vad";
  threshold?: number;
  silence_duration_ms?: number;
  prefix_padding_ms?: number;
  idle_timeout_ms?: number | null;
}
export interface RealtimeInputTranscription { model?: "grok-transcribe"; language_hint?: string; keyterms?: string[] }
export interface RealtimeAudioConfig {
  input?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; transcription?: RealtimeInputTranscription };
  output?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; speed?: number };
}
export type RealtimeTool =
  | { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }
  | { type: "web_search"; location?: { country?: string; city?: string; region?: string; timezone?: string }; allowed_domains?: string[]; excluded_domains?: string[]; enable_image_understanding?: boolean }
  | { type: "x_search"; allowed_x_handles?: string[]; excluded_x_handles?: string[]; from_date?: string; to_date?: string; enable_image_understanding?: boolean; enable_video_understanding?: boolean }
  | { type: "file_search"; vector_store_ids: string[]; max_num_results?: number }
  | { type: "mcp"; server_label: string; server_url: string; server_description?: string; allowed_tools?: string[]; authorization?: string; headers?: Record<string, string> };
export interface RealtimeSessionConfig {
  model?: RealtimeVoiceModel;
  instructions?: string;
  reasoning?: { effort?: RealtimeReasoningEffort };
  voice?: string;
  turn_detection?: RealtimeTurnDetection | null;
  resumption?: { enabled: boolean };
  audio?: RealtimeAudioConfig;
  tools?: RealtimeTool[];
  replace?: Record<string, string> | null;
}
export type RealtimeContentPart =
  | { type: "input_text" | "text"; text: string }
  | { type: "input_audio" | "audio"; audio: string; transcript?: string };
export type RealtimeConversationItem =
  | { type: "message"; id?: string; role: "user" | "assistant" | "system"; content: RealtimeContentPart[] }
  | { type: "function_call"; id?: string; name: string; arguments: string; call_id?: string }
  | { type: "function_call_output"; id?: string; call_id: string; output: string }
  | { type: "force_message"; role: "assistant"; content: [{ type: "output_text"; text: string }]; interruptible?: boolean };
export type RealtimeClientEvent =
  | { type: "session.update"; session: RealtimeSessionConfig }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" }
  | { type: "conversation.item.create"; item: RealtimeConversationItem; previous_item_id?: string }
  | { type: "conversation.item.delete"; item_id: string }
  | { type: "conversation.item.truncate"; item_id: string; content_index: number; audio_end_ms: number }
  | { type: "response.create"; response?: { modalities?: ("text" | "audio")[] | null; instructions?: string | null; metadata?: Record<string, string> | null } }
  | { type: "response.cancel"; response_id?: string }
  | { type: "pong"; ping_timestamp: number };

export interface RealtimeEventBase { event_id?: string }
export type RealtimeServerEvent =
  | (RealtimeEventBase & { type: "session.created" | "session.updated"; session: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.created"; conversation: { id: string } })
  | (RealtimeEventBase & { type: "conversation.item.added" | "conversation.item.created"; previous_item_id?: string; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.item.deleted"; item_id: string })
  | (RealtimeEventBase & { type: "conversation.item.truncated"; item_id: string; content_index: number; audio_end_ms: number; transcript?: string })
  | (RealtimeEventBase & { type: "conversation.item.input_audio_transcription.updated" | "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_started"; item_id: string; audio_start_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_stopped"; item_id: string; audio_end_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.committed"; item_id: string; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.cleared" })
  | (RealtimeEventBase & { type: "input_audio_buffer.timeout_triggered"; item_id: string; audio_start_ms: number; audio_end_ms: number; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.dtmf_event_received"; event: "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"*"|"#"; received_at: number })
  | (RealtimeEventBase & { type: "response.created" | "response.done"; response: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_item.added" | "response.output_item.done"; response_id: string; output_index: number; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.content_part.added" | "response.content_part.done"; response_id: string; item_id: string; output_index: number; content_index: number; part: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_audio.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio.done"; response_id: string; item_id: string; output_index: number; content_index: number })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.done"; response_id: string; item_id: string; output_index: number; content_index: number; transcript: string })
  | (RealtimeEventBase & { type: "response.text.delta" | "response.output_text.delta"; response_id: string; item_id: string; delta: string; output_index?: number; content_index?: number })
  | (RealtimeEventBase & { type: "response.function_call_arguments.delta"; response_id: string; item_id: string; output_index: number; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.function_call_arguments.done"; response_id: string; item_id: string; output_index: number; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.in_progress" | "mcp_list_tools.completed"; item_id: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.failed"; item_id: string; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.delta"; response_id: string; item_id: string; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.done"; response_id: string; item_id: string; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "response.mcp_call.in_progress" | "response.mcp_call.completed"; item_id: string; output_index: number })
  | (RealtimeEventBase & { type: "response.mcp_call.failed"; item_id: string; output_index: number; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.cancelled"; response_id?: string })
  | { type: "ping"; timestamp: number }
  | (RealtimeEventBase & { type: "error"; error: { code?: string; type?: string; message: string } });

export type RealtimeNormalizedEvent =
  | RealtimeServerEvent
  | { type: "response.output_audio.binary"; bytes: Uint8Array };

export class VoiceProtocolError extends Error {
  constructor(
    readonly code: "invalid_event" | "unexpected_binary" | "abnormal_close" | "queue_limit",
    message: string,
  ) {
    super(message);
    this.name = "VoiceProtocolError";
  }
}

function protocolRecord(wire: unknown, label: string): Record<string, unknown> {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) {
    throw new VoiceProtocolError("invalid_event", `${label} must be object`);
  }
  return wire as Record<string, unknown>;
}

function protocolString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") throw new VoiceProtocolError("invalid_event", `${key} must be string`);
  return value[key] as string;
}

export function parseSttServerEvent(text: string): SttServerEvent {
  let wire: unknown;
  try { wire = JSON.parse(text) as unknown; }
  catch { throw new VoiceProtocolError("invalid_event", "STT server event was not JSON"); }
  const value = protocolRecord(wire, "STT event");
  if (value.type === "transcript.created" && typeof value.id === "string") return { type: value.type, id: value.id };
  if (value.type === "error" && typeof value.message === "string") return { type: value.type, message: value.message };
  if (value.type === "transcript.partial" || value.type === "transcript.done") {
    if (typeof value.text !== "string" || typeof value.duration !== "number" || !Array.isArray(value.words)) {
      throw new VoiceProtocolError("invalid_event", "transcript event fields are invalid");
    }
    const words = value.words.map((rawWord): StreamingSttWord => {
      const word = protocolRecord(rawWord, "STT word");
      if (typeof word.start !== "number" || typeof word.end !== "number") {
        throw new VoiceProtocolError("invalid_event", "STT word fields are invalid");
      }
      return {
        text: protocolString(word, "text"), start: word.start, end: word.end,
        ...(typeof word.confidence === "number" ? { confidence: word.confidence } : {}),
        ...(Number.isInteger(word.speaker) ? { speaker: word.speaker as number } : {}),
      };
    });
    if (value.type === "transcript.done") {
      return { type: value.type, text: value.text, words, duration: value.duration,
        ...(Number.isInteger(value.channel_index) ? { channel_index: value.channel_index as number } : {}) };
    }
    if (typeof value.is_final !== "boolean" || typeof value.speech_final !== "boolean" || typeof value.start !== "number") {
      throw new VoiceProtocolError("invalid_event", "transcript.partial state fields are invalid");
    }
    return {
      type: value.type, text: value.text, words, duration: value.duration, start: value.start,
      is_final: value.is_final, speech_final: value.speech_final,
      ...(Number.isInteger(value.channel_index) ? { channel_index: value.channel_index as number } : {}),
      ...(typeof value.end_of_turn_confidence === "number" ? { end_of_turn_confidence: value.end_of_turn_confidence } : {}),
    };
  }
  throw new VoiceProtocolError("invalid_event", `unsupported STT event type: ${String(value.type)}`);
}

export function parseTtsServerEvent(text: string): TtsServerEvent {
  let wire: unknown;
  try { wire = JSON.parse(text) as unknown; }
  catch { throw new VoiceProtocolError("invalid_event", "TTS server event was not JSON"); }
  const value = protocolRecord(wire, "TTS event");
  if (value.type === "audio.done") return { type: value.type, ...(typeof value.trace_id === "string" ? { trace_id: value.trace_id } : {}) };
  if (value.type === "error" && typeof value.message === "string") return { type: value.type, message: value.message };
  if (value.type === "audio.delta" && typeof value.delta === "string") {
    return { type: value.type, delta: value.delta,
      ...(typeof value.audio_duration === "number" ? { audio_duration: value.audio_duration } : {}) };
  }
  throw new VoiceProtocolError("invalid_event", "unsupported TTS event");
}

export function parseRealtimeServerEvent(text: string): RealtimeServerEvent {
  let wire: unknown;
  try { wire = JSON.parse(text) as unknown; }
  catch { throw new VoiceProtocolError("invalid_event", "realtime event was not JSON"); }
  const value = protocolRecord(wire, "realtime event");
  const type = protocolString(value, "type");
  // 실제 파일은 RealtimeServerEvent의 모든 discriminant를 exhaustive switch로 나누고
  // required scalar/object를 검사해 새 객체를 만든다. default cast는 두지 않는다.
  switch (type) {
    case "ping":
      if (typeof value.timestamp !== "number") throw new VoiceProtocolError("invalid_event", "ping timestamp is invalid");
      return { type, timestamp: value.timestamp };
    case "conversation.created": {
      const conversation = protocolRecord(value.conversation, "conversation");
      return { type, conversation: { id: protocolString(conversation, "id") },
        ...(typeof value.event_id === "string" ? { event_id: value.event_id } : {}) };
    }
    case "input_audio_buffer.dtmf_event_received": {
      const event = protocolString(value, "event");
      if (!/^[0-9*#]$/.test(event) || typeof value.received_at !== "number") {
        throw new VoiceProtocolError("invalid_event", "DTMF event is invalid");
      }
      return { type, event: event as Extract<RealtimeServerEvent, {type: typeof type}>["event"], received_at: value.received_at,
        ...(typeof value.event_id === "string" ? { event_id: value.event_id } : {}) };
    }
    case "session.created":
    case "session.updated":
      return { type, session: protocolRecord(value.session, "session"),
        ...(typeof value.event_id === "string" ? { event_id: value.event_id } : {}) };
    case "error": {
      const error = protocolRecord(value.error, "error");
      return { type, error: {
        message: protocolString(error, "message"),
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        ...(typeof error.type === "string" ? { type: error.type } : {}),
      }, ...(typeof value.event_id === "string" ? { event_id: value.event_id } : {}) };
    }
    // 나머지 case는 위 union 순서대로 구현하고 assertNever로 누락을 막는다.
  }
  throw new VoiceProtocolError("invalid_event", `unsupported realtime event type: ${type}`);
}
```

`protocol.ts`의 runtime export는 문자열/배열, 순수 `ephemeralProtocols()`, browser-safe event decoder와 typed 오류뿐이다. browser bundle은 `ws-client.ts`나 `realtime.ts`를 경유하지 않는다. wp13은 `ephemeralProtocols`, `parseRealtimeServerEvent`, `parseSttServerEvent`, `RealtimeClientEvent`, `RealtimeServerEvent`, `SttClientControl`, `SttServerEvent`를 여기서 직접 import한다. Streaming TTS도 같은 SSOT를 쓰도록 `TtsClientEvent`/`TtsServerEvent`와 `parseTtsServerEvent`를 함께 둔다.

## 9. NEW `src/voice/ws-client.ts`

### 9.1 공통 WS 타입과 인증

```ts
import WebSocket, { type RawData } from "ws";
import { randomUUID } from "node:crypto";
import { getValidBearerSnapshot } from "../auth/token-store.js";
import { buildUpstreamHeaders } from "../transport/headers.js";
import { readPackageVersion } from "../utils/version.js";
import {
  XAI_VOICE_WS_ORIGIN,
  VoiceProtocolError,
  ephemeralProtocols,
  parseSttServerEvent,
  parseTtsServerEvent,
  type EphemeralProtocolStyle,
  type SttClientControl,
  type SttServerEvent,
  type TtsClientEvent,
  type TtsServerEvent,
} from "./protocol.js";

export { ephemeralProtocols } from "./protocol.js";

export const VOICE_WS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const VOICE_WS_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
export const VOICE_WS_OPEN_TIMEOUT_MS = 30_000;

export type VoiceWsAuth =
  | { kind: "oauth" }
  | { kind: "ephemeral"; clientSecret: string; style?: EphemeralProtocolStyle };

export type VoiceWsFrame =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array }
  | { kind: "close"; code: number; reason: string };

export interface VoiceSocket {
  sendJson(value: unknown): void;
  sendBinary(bytes: Uint8Array): void;
  frames(): AsyncGenerator<VoiceWsFrame>;
  close(code?: number, reason?: string): void;
}

export interface VoiceWsDeps {
  dial?: typeof WebSocket;
  endpointOrigin?: string; // test injection only; public factory does not expose arbitrary host
  clientVersion?: string;
}

```

`VoiceWsDeps.endpointOrigin`은 local test server 주입용이며 production `create*` factory의 일반 options에 노출하지 않는다. production origin은 상수 `wss://api.x.ai`다.

### 9.2 bounded dial 핵심 본문

```ts
export async function openVoiceSocket(
  path: string,
  auth: VoiceWsAuth,
  signal: AbortSignal | undefined,
  deps: VoiceWsDeps,
): Promise<VoiceSocket> {
  if (signal?.aborted) throw signal.reason;
  const origin = deps.endpointOrigin ?? XAI_VOICE_WS_ORIGIN;
  const url = new URL(path, origin);
  if (!deps.endpointOrigin && (url.protocol !== "wss:" || url.hostname !== "api.x.ai")) {
    throw new Error("Voice WebSocket destination must be api.x.ai over wss");
  }

  let protocols: string[] = [];
  const wsOptions: WebSocket.ClientOptions = {
    maxPayload: VOICE_WS_MAX_MESSAGE_BYTES,
    handshakeTimeout: VOICE_WS_OPEN_TIMEOUT_MS,
    perMessageDeflate: false,
  };
  if (auth.kind === "ephemeral") {
    protocols = ephemeralProtocols(auth.clientSecret, auth.style);
  } else {
    const bearer = await getValidBearerSnapshot({ signal });
    const headers = buildUpstreamHeaders({
      auth: { kind: "oauth", bearer: bearer.token },
      clientVersion: deps.clientVersion ?? readPackageVersion(),
      trace: { requestId: randomUUID() },
    });
    wsOptions.headers = Object.fromEntries(headers);
  }

  const Ctor = deps.dial ?? WebSocket;
  const ws = new Ctor(url, protocols, wsOptions);
  ws.binaryType = "arraybuffer";
  // open/error/abort를 경쟁시킨다. open 전 401은 socket을 폐기하고 OAuth bearer만
  // getValidBearerSnapshot({forceRefresh:true,rejectedAccessToken})으로 정확히 한 번 redial한다.
  // open 뒤 close/error는 절대 자동 redial하지 않는다.

  const queue: VoiceWsFrame[] = [];
  let queuedBytes = 0;
  let waiter: (() => void) | undefined;
  const push = (frame: VoiceWsFrame, size: number) => {
    queuedBytes += size;
    if (queuedBytes > VOICE_WS_MAX_QUEUE_BYTES) {
      ws.close(1009, "voice receive queue exceeded");
      return;
    }
    queue.push(frame);
    waiter?.();
    waiter = undefined;
  };
  ws.on("message", (data: RawData, isBinary: boolean) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : Array.isArray(data)
        ? new Uint8Array(Buffer.concat(data))
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    push(isBinary
      ? { kind: "binary", bytes: bytes.slice() }
      : { kind: "text", text: Buffer.from(bytes).toString("utf8") }, bytes.byteLength);
  });
  ws.on("close", (code, reason) => push({ kind: "close", code, reason: reason.toString("utf8") }, 0));
  const onAbort = () => ws.close(1000, "caller aborted");
  signal?.addEventListener("abort", onAbort, { once: true });

  return {
    sendJson(value) { ws.send(JSON.stringify(value)); },
    sendBinary(bytes) { ws.send(bytes, { binary: true }); },
    async *frames() {
      try {
        for (;;) {
          if (queue.length === 0) await new Promise<void>((resolve) => { waiter = resolve; });
          const frame = queue.shift();
          if (!frame) continue;
          if (frame.kind !== "close") queuedBytes -= frame.kind === "text" ? Buffer.byteLength(frame.text) : frame.bytes.byteLength;
          yield frame;
          if (frame.kind === "close") return;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    close(code = 1000, reason = "client close") { signal?.removeEventListener("abort", onAbort); ws.close(code, reason); },
  };
}
```

실제 구현은 open promise가 끝나기 전에 message queue를 노출하지 않고, `error` listener와 `unexpected-response` body를 정리한다. 오류에는 URL query/token/header를 넣지 않는다. queue waiter가 close 시 항상 깨어나도록 한다.

### 9.3 Streaming STT option·session 타입

```ts
export type StreamingSttEncoding = "pcm" | "mulaw" | "alaw" | "opus";
export type StreamingSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;

export interface StreamingSttOptions {
  encoding?: StreamingSttEncoding;
  sample_rate?: StreamingSampleRate;
  interim_results?: boolean;
  endpointing?: number;
  language?: string;
  multichannel?: boolean;
  channels?: number;
  diarize?: boolean;
  keyterm?: string[];
  filler_words?: boolean;
  smart_turn?: number;
  smart_turn_timeout?: number;
  vad_threshold?: number;
  signal?: AbortSignal;
}
export interface SttCompletion {
  kind: "completed" | "completed-with-transport-close";
  finalText: string;
  finalEvent: "transcript.partial:speech_final" | "transcript.done";
  closeCode?: number;
}
export interface StreamingSttSession {
  sendAudio(bytes: Uint8Array): void;
  finalize(channel?: number): void;
  finish(): void;
  events(): AsyncGenerator<SttServerEvent | SttCompletion>;
  close(): void;
}
```

`StreamingSttWord`, `SttClientControl`, `SttServerEvent`는 `protocol.ts`에서 import한다. 이 파일에서 재정의하지 않는다.

### 9.4 STT URL·reducer·factory

```ts
function sttUrl(options: StreamingSttOptions): string {
  if (options.endpointing !== undefined && (options.endpointing < 0 || options.endpointing > 5000)) throw new RangeError("endpointing must be 0..5000");
  if (options.vad_threshold !== undefined && (options.vad_threshold < 0 || options.vad_threshold > 1)) throw new RangeError("vad_threshold must be 0..1");
  if (options.smart_turn !== undefined && (options.smart_turn < 0 || options.smart_turn > 1)) throw new RangeError("smart_turn must be 0..1");
  if (options.multichannel && (!options.channels || options.channels < 2 || options.channels > 8)) throw new RangeError("multichannel requires channels 2..8");
  if (options.encoding === "opus" && options.multichannel) throw new RangeError("opus does not support multichannel");
  if ((options.keyterm?.length ?? 0) > 100 || options.keyterm?.some((term) => term.length === 0 || term.length > 50)) throw new RangeError("invalid keyterm");
  const query = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined) => { if (value !== undefined) query.set(key, String(value)); };
  set("encoding", options.encoding); set("sample_rate", options.sample_rate);
  set("interim_results", options.interim_results); set("endpointing", options.endpointing);
  set("language", options.language); set("multichannel", options.multichannel);
  set("channels", options.channels); set("diarize", options.diarize);
  for (const term of options.keyterm ?? []) query.append("keyterm", term);
  set("filler_words", options.filler_words); set("smart_turn", options.smart_turn);
  set("smart_turn_timeout", options.smart_turn_timeout); set("vad_threshold", options.vad_threshold);
  return `/v1/stt${query.size ? `?${query}` : ""}`;
}

interface SttState {
  ready: boolean;
  finishSent: boolean;
  speechFinal?: Extract<SttServerEvent, { type: "transcript.partial" }>;
  done?: Extract<SttServerEvent, { type: "transcript.done" }>;
}

export function reduceSttEvent(state: SttState, event: SttServerEvent): SttState {
  if (event.type === "transcript.created") return { ...state, ready: true };
  if (event.type === "transcript.partial" && event.speech_final) return { ...state, speechFinal: event };
  if (event.type === "transcript.done") return { ...state, done: event };
  return state;
}

export async function createSttSession(
  options: StreamingSttOptions = {},
  deps: VoiceWsDeps = {},
): Promise<StreamingSttSession> {
  const socket = await openVoiceSocket(sttUrl(options), { kind: "oauth" }, options.signal, deps);
  let state: SttState = { ready: false, finishSent: false };
  return {
    sendAudio(bytes) {
      if (!state.ready) throw new Error("wait for transcript.created before sending audio");
      if (state.finishSent) throw new Error("audio.done was already sent");
      socket.sendBinary(bytes);
    },
    finalize(channel) {
      const event: SttClientControl = channel === undefined ? { type: "finalize" } : { type: "finalize", channel };
      socket.sendJson(event);
    },
    finish() {
      state = { ...state, finishSent: true };
      socket.sendJson({ type: "audio.done" } satisfies SttClientControl);
    },
    async *events() {
      for await (const frame of socket.frames()) {
        if (frame.kind === "binary") throw new VoiceProtocolError("unexpected_binary", "STT server sent a binary frame");
        if (frame.kind === "text") {
          const event = parseSttServerEvent(frame.text);
          if (event.type === "error") throw new VoiceProtocolError("invalid_event", "xAI STT returned an error event");
          state = reduceSttEvent(state, event);
          yield event;
          continue;
        }
        const terminal = state.speechFinal ?? state.done;
        if (!terminal || !state.finishSent) throw new VoiceProtocolError("abnormal_close", `STT closed before terminal evidence (${frame.code})`);
        yield {
          kind: frame.code === 1006 ? "completed-with-transport-close" : "completed",
          finalText: state.speechFinal?.text ?? state.done?.text ?? "",
          finalEvent: state.speechFinal ? "transcript.partial:speech_final" : "transcript.done",
          ...(frame.code === 1006 ? { closeCode: frame.code } : {}),
        };
        return;
      }
    },
    close() { socket.close(); },
  };
}
```

`events()`는 `VoiceSocket.frames()`를 한 번만 소비한다. text frame이 object가 아니거나 알려진 event의 필수 field가 틀리면 typed protocol error 후 1002 close한다. `transcript.done.text`가 비어 있으면 `state.speechFinal?.text`를 최종값으로 사용한다.

### 9.5 Streaming TTS option·session·factory

```ts
export interface StreamingTtsOptions {
  voice?: string;
  language: string;
  codec?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  bit_rate?: 32000 | 64000 | 96000 | 128000 | 192000;
  optimize_streaming_latency?: 0 | 1;
  speed?: number;
  text_normalization?: boolean;
  with_timestamps?: boolean;
  signal?: AbortSignal;
}
export interface StreamingTtsSession {
  sendText(delta: string): void;
  finishUtterance(): void;
  events(): AsyncGenerator<TtsServerEvent>;
  close(): void;
}

export async function createTtsSession(
  options: StreamingTtsOptions,
  deps: VoiceWsDeps = {},
): Promise<StreamingTtsSession> {
  if (!options.language.trim()) throw new RangeError("language is required");
  if (options.speed !== undefined && (options.speed < 0.7 || options.speed > 1.5)) throw new RangeError("speed must be 0.7..1.5");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && value !== undefined) query.set(key, String(value));
  }
  const socket = await openVoiceSocket(`/v1/tts?${query}`, { kind: "oauth" }, options.signal, deps);
  let awaitingDone = false;
  return {
    sendText(delta) {
      if (awaitingDone) throw new Error("wait for audio.done before the next utterance");
      if (delta.length === 0 || delta.length > 60_000) throw new RangeError("text delta must contain 1..60000 characters");
      socket.sendJson({ type: "text.delta", delta } satisfies TtsClientEvent);
    },
    finishUtterance() { awaitingDone = true; socket.sendJson({ type: "text.done" } satisfies TtsClientEvent); },
    async *events() {
      for await (const frame of socket.frames()) {
        if (frame.kind === "binary") throw new VoiceProtocolError("unexpected_binary", "streaming TTS server sent binary instead of JSON");
        if (frame.kind === "close") return;
        const event = parseTtsServerEvent(frame.text);
        if (event.type === "error") throw new VoiceProtocolError("invalid_event", "xAI TTS returned an error event");
        if (event.type === "audio.done") awaitingDone = false;
        yield event;
      }
    },
    close() { socket.close(); },
  };
}
```

`TtsClientEvent`, `StreamingAudioTimestamps`, `TtsServerEvent`는 `protocol.ts`가 소유한다. Node session 구현은 type-only import만 사용하며 wp13 browser code도 같은 타입을 직접 import한다.

STT/TTS streaming은 bearer auth만 쓴다. ephemeral subprotocol은 realtime browser 연결에만 노출한다.

## 10. NEW `src/voice/realtime.ts`

### 10.1 protocol import·re-export

```ts
import {
  openVoiceSocket, type VoiceSocket,
  type VoiceWsAuth, type VoiceWsDeps,
} from "./ws-client.js";
import {
  PINNED_REALTIME_MODEL,
  parseRealtimeServerEvent,
  type EphemeralProtocolStyle,
  type RealtimeClientEvent,
  type RealtimeConversationItem,
  type RealtimeNormalizedEvent,
  type RealtimeReasoningEffort,
  type RealtimeSessionConfig,
  type RealtimeVoiceModel,
} from "./protocol.js";

export {
  PINNED_REALTIME_MODEL,
  REALTIME_MODEL_ALIAS,
  type RealtimeClientEvent,
  type RealtimeConversationItem,
  type RealtimeNormalizedEvent,
  type RealtimeReasoningEffort,
  type RealtimeServerEvent,
  type RealtimeSessionConfig,
  type RealtimeVoiceModel,
} from "./protocol.js";
```

model/session/client/server event 계약은 `protocol.ts`가 소유한다. `realtime.ts`는 기존 Node caller가 같은 공개 import 경로를 쓸 수 있도록 위 타입과 model 상수만 re-export한다. wp13 browser는 이 re-export를 거치지 않고 `protocol.ts`를 직접 import한다.

### 10.2 client event 전송 규칙

`RealtimeClientEvent`의 전체 union은 §8에 있다. `force_message`는 자체로 완전한 response lifecycle을 시작하므로 전송 뒤 `response.create`를 자동 호출하면 안 된다. VAD validation은 threshold 0.1–0.9, silence/prefix 0–10,000 ms, output speed 0.7–1.5를 강제한다. `allowed_domains`/`excluded_domains`, `allowed_x_handles`/`excluded_x_handles`는 각각 상호 배타다. MCP authorization/header는 error/log에 넣지 않는다.

### 10.3 server event decoder import·session validation

`parseRealtimeServerEvent(text: string): RealtimeServerEvent`는 §8의 browser-safe decoder를 그대로 import한다. Node 전용 `realtime.ts` 안에 두 번째 decoder를 만들지 않는다.

```ts
function validateSessionConfig(session: RealtimeSessionConfig): void {
  const vad = session.turn_detection;
  if (vad) {
    if (vad.threshold !== undefined && (vad.threshold < 0.1 || vad.threshold > 0.9)) throw new RangeError("VAD threshold must be 0.1..0.9");
    for (const [name, value] of [["silence_duration_ms", vad.silence_duration_ms], ["prefix_padding_ms", vad.prefix_padding_ms]] as const) {
      if (value !== undefined && (value < 0 || value > 10_000)) throw new RangeError(`${name} must be 0..10000`);
    }
  }
  const speed = session.audio?.output?.speed;
  if (speed !== undefined && (speed < 0.7 || speed > 1.5)) throw new RangeError("output speed must be 0.7..1.5");
  for (const tool of session.tools ?? []) {
    if (tool.type === "web_search" && tool.allowed_domains && tool.excluded_domains) throw new RangeError("allowed_domains and excluded_domains are mutually exclusive");
    if (tool.type === "x_search" && tool.allowed_x_handles && tool.excluded_x_handles) throw new RangeError("allowed_x_handles and excluded_x_handles are mutually exclusive");
  }
}
```

`conversation.item.created`는 resumption replay에서 관측/문서화된 xAI 형태이고, 현재 WS schema의 `conversation.item.added`도 함께 처리한다. 알 수 없는 `type`은 cast하지 않고 typed protocol error다.

### 10.4 reducer와 client

```ts
export interface RealtimeState {
  phase: "connecting" | "ready" | "responding" | "closed" | "failed";
  conversationId?: string;
  responseId?: string;
  speechActive: boolean;
  lastDtmf?: string;
  errorCode?: string;
}

export function reduceRealtimeEvent(state: RealtimeState, event: RealtimeNormalizedEvent): RealtimeState {
  switch (event.type) {
    case "conversation.created": return { ...state, phase: "ready", conversationId: event.conversation.id };
    case "session.updated": return { ...state, phase: state.phase === "connecting" ? "ready" : state.phase };
    case "input_audio_buffer.speech_started": return { ...state, speechActive: true };
    case "input_audio_buffer.speech_stopped": return { ...state, speechActive: false };
    case "input_audio_buffer.dtmf_event_received": return { ...state, lastDtmf: event.event };
    case "response.created": return { ...state, phase: "responding", responseId: typeof event.response.id === "string" ? event.response.id : state.responseId };
    case "response.done": return { ...state, phase: "ready", responseId: undefined };
    case "error": return { ...state, phase: "failed", errorCode: event.error.code };
    default: return state;
  }
}

export type RealtimeAuth =
  | { kind: "oauth" }
  | { kind: "ephemeral"; clientSecret: string; style?: EphemeralProtocolStyle };
export interface CreateRealtimeClientOptions {
  auth: RealtimeAuth;
  model?: RealtimeVoiceModel;
  reasoningEffort?: RealtimeReasoningEffort;
  callId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}
export interface RealtimeClient {
  updateSession(config: RealtimeSessionConfig): void;
  appendAudioBase64(audio: string): void;
  appendAudioBinary(audio: Uint8Array): void;
  commitAudio(): void;
  clearAudio(): void;
  createItem(item: RealtimeConversationItem, previousItemId?: string): void;
  forceMessage(text: string, interruptible?: boolean): void;
  deleteItem(itemId: string): void;
  truncateItem(itemId: string, contentIndex: number, audioEndMs: number): void;
  createResponse(response?: Extract<RealtimeClientEvent, {type:"response.create"}>["response"]): void;
  cancelResponse(responseId?: string): void;
  events(): AsyncGenerator<RealtimeNormalizedEvent>;
  close(): void;
}

export async function createRealtimeClient(
  options: CreateRealtimeClientOptions,
  deps: VoiceWsDeps = {},
): Promise<RealtimeClient> {
  if (options.callId && options.auth.kind === "ephemeral") {
    throw new RangeError("SIP call_id sessions require server-side bearer authentication");
  }
  const query = new URLSearchParams();
  if (!options.callId) query.set("model", options.model ?? PINNED_REALTIME_MODEL);
  if (options.callId) query.set("call_id", options.callId);
  if (options.conversationId) query.set("conversation_id", options.conversationId);
  if (options.reasoningEffort) query.set("reasoning.effort", options.reasoningEffort);
  const auth: VoiceWsAuth = options.auth.kind === "oauth"
    ? { kind: "oauth" }
    : { kind: "ephemeral", clientSecret: options.auth.clientSecret, style: options.auth.style };
  const socket: VoiceSocket = await openVoiceSocket(`/v1/realtime?${query}`, auth, options.signal, deps);
  return makeRealtimeClient(socket);
}

function makeRealtimeClient(socket: VoiceSocket): RealtimeClient {
  const send = (event: RealtimeClientEvent) => socket.sendJson(event);
  return {
    updateSession(session) { validateSessionConfig(session); send({ type: "session.update", session }); },
    appendAudioBase64(audio) { send({ type: "input_audio_buffer.append", audio }); },
    appendAudioBinary(audio) { socket.sendBinary(audio); },
    commitAudio() { send({ type: "input_audio_buffer.commit" }); },
    clearAudio() { send({ type: "input_audio_buffer.clear" }); },
    createItem(item, previous_item_id) { send({ type: "conversation.item.create", item, ...(previous_item_id ? { previous_item_id } : {}) }); },
    forceMessage(text, interruptible) {
      send({ type: "conversation.item.create", item: {
        type: "force_message", role: "assistant", content: [{ type: "output_text", text }],
        ...(interruptible === undefined ? {} : { interruptible }),
      } });
    },
    deleteItem(item_id) { send({ type: "conversation.item.delete", item_id }); },
    truncateItem(item_id, content_index, audio_end_ms) { send({ type: "conversation.item.truncate", item_id, content_index, audio_end_ms }); },
    createResponse(response) { send(response === undefined ? { type: "response.create" } : { type: "response.create", response }); },
    cancelResponse(response_id) { send(response_id === undefined ? { type: "response.cancel" } : { type: "response.cancel", response_id }); },
    async *events() {
      for await (const frame of socket.frames()) {
        if (frame.kind === "binary") { yield { type: "response.output_audio.binary", bytes: frame.bytes }; continue; }
        if (frame.kind === "close") return;
        const event = parseRealtimeServerEvent(frame.text);
        if (event.type === "ping") send({ type: "pong", ping_timestamp: event.timestamp });
        yield event;
      }
    },
    close() { socket.close(); },
  };
}
```

`openVoiceSocket`은 `ws-client.ts`의 공용 transport seam이며 endpoint별 factory만 호출한다. resumption 절차는 caller가 첫 연결의 `conversation.created.conversation.id`를 저장하고, 새 client에 `conversationId`를 넣은 뒤 첫 메시지로 `session.update({resumption:{enabled:true}})`를 보내는 것이다. replay는 `conversation.item.created|added`로 들어오며 별도 completion event를 기다리지 않는다. SIP 재접속은 공식 FAQ대로 새 `call_id`와 이전 conversation/call identifier를 함께 쓸 수 있다. history는 현재 문서상 30분 inactivity 후 만료된다.

## 11. NEW `src/voice/sip.ts`

### 11.1 endpoint 요청/응답 타입 전부

```ts
import { createVoiceHttpClient, expectRecord, expectString, jsonBody, type VoiceClientOptions } from "./http.js";

export type SipAuthInput =
  | { allowed_addresses: string[]; auth_username?: never; auth_password?: never }
  | { auth_username: string; auth_password: string; allowed_addresses?: never };
export interface SipWebhookInput {
  name?: string;
  url: string;
  auth_url?: string;
  auth_token?: string;
}
type SipDestination =
  | { agent_id: string; webhook?: never }
  | { webhook: SipWebhookInput; agent_id?: never };
type PhoneOrigin =
  | { origin: "byo_trunk"; phone_number: string; area_code?: never }
  | { origin: "xai_provisioned"; area_code?: string; phone_number?: never };
export type CreatePhoneNumberRequest = PhoneOrigin & SipDestination & {
  name: string;
  sip_auth?: SipAuthInput;
};
export interface RegisteredSipAuth { auth_username?: string; allowed_addresses?: string[] }
export interface PhoneNumberResource {
  phone_number_id: string;
  team_id: string;
  phone_number: string;
  name: string;
  agent_id?: string;
  webhook_id?: string;
  origin: "xai_provisioned" | "byo_trunk";
  sip_host: string;
  inbound_trunk_id?: string;
  sip_auth?: RegisteredSipAuth;
  created_at: string;
  updated_at: string;
  agent_name?: string;
}
export interface PhoneWebhookSecret {
  webhook_id: string;
  dispatch_signing_secret: string;
}
export interface CreatePhoneNumberResponse {
  phone_number: PhoneNumberResource;
  webhook?: PhoneWebhookSecret;
}
export interface ReferCallRequest { target_uri: `tel:${string}` | `sip:${string}` }
export type ReferCallResponse = Record<string, never>;
export type HangupCallResponse = Record<string, never>;

export interface RealtimeCallIncomingWebhook {
  object: "event";
  id: string;
  type: "realtime.call.incoming";
  created_at: number;
  data: {
    call_id: string;
    sip_headers: Array<{ name: string; value: string }>;
    metadata: Record<string, unknown>;
  };
}

export interface SipClient {
  createPhoneNumber(request: CreatePhoneNumberRequest, signal?: AbortSignal): Promise<CreatePhoneNumberResponse>;
  refer(callId: string, request: ReferCallRequest, signal?: AbortSignal): Promise<ReferCallResponse>;
  hangup(callId: string, signal?: AbortSignal): Promise<HangupCallResponse>;
}
```

OpenAPI는 `xai_provisioned`를 enum에 남겼지만 현재 SIP 가이드는 API provisioning 미지원이라고 명시한다. 타입은 wire 호환을 위해 둘 다 표현하되, 문서와 CLI는 `byo_trunk`만 지원으로 표시한다. caller가 `xai_provisioned`를 명시하면 upstream 결과를 그대로 받으며 성공을 가정하지 않는다.

### 11.2 핵심 본문

```ts
function callPath(callId: string, action: "refer" | "hangup"): string {
  if (!/^[0-9a-zA-Z_-]+$/.test(callId)) throw new RangeError("invalid call id");
  return `/v1/realtime/calls/${encodeURIComponent(callId)}/${action}`;
}

function decodeEmptyObject(wire: unknown): Record<string, never> {
  const value = expectRecord(wire, "call control response");
  if (Object.keys(value).length !== 0) throw new TypeError("call control success must be an empty object");
  return {};
}

function validatePhoneRequest(request: CreatePhoneNumberRequest): void {
  const raw = request as Partial<{ agent_id: string; webhook: SipWebhookInput }>;
  const hasAgent = typeof raw.agent_id === "string";
  const hasWebhook = raw.webhook !== undefined;
  if (hasAgent === hasWebhook) throw new RangeError("exactly one of agent_id or webhook is required");
  if (!request.name.trim()) throw new RangeError("phone number name is required");
  if (request.origin === "byo_trunk" && !/^\+[1-9]\d{7,14}$/.test(request.phone_number)) throw new RangeError("phone_number must be E.164");
  if ("webhook" in request && request.webhook) {
    const url = new URL(request.webhook.url);
    if (url.protocol !== "https:") throw new RangeError("webhook url must use https");
  }
  if (request.sip_auth && "allowed_addresses" in request.sip_auth && request.sip_auth.allowed_addresses.length === 0) {
    throw new RangeError("allowed_addresses must not be empty");
  }
}

function decodePhoneResponse(wire: unknown): CreatePhoneNumberResponse {
  const root = expectRecord(wire, "phone number response");
  const phone = expectRecord(root.phone_number, "phone_number");
  const result: CreatePhoneNumberResponse = {
    phone_number: {
      phone_number_id: expectString(phone, "phone_number_id"),
      team_id: expectString(phone, "team_id"),
      phone_number: expectString(phone, "phone_number"),
      name: expectString(phone, "name"),
      origin: expectString(phone, "origin") as PhoneNumberResource["origin"],
      sip_host: expectString(phone, "sip_host"),
      created_at: expectString(phone, "created_at"),
      updated_at: expectString(phone, "updated_at"),
    },
  };
  if (root.webhook !== undefined) {
    const webhook = expectRecord(root.webhook, "webhook");
    result.webhook = {
      webhook_id: expectString(webhook, "webhook_id"),
      dispatch_signing_secret: expectString(webhook, "dispatch_signing_secret"),
    };
  }
  // optional phone fields는 타입 검사 후 조건부 assign한다. auth_password는 응답에 없어야 한다.
  return result;
}

export function createSipClient(options: VoiceClientOptions = {}): SipClient {
  const http = createVoiceHttpClient(options);
  return {
    createPhoneNumber(request, signal) {
      validatePhoneRequest(request);
      return http.requestJson("/v2/phone-numbers", { method: "POST", ...jsonBody(request), signal }, decodePhoneResponse);
    },
    refer(callId, request, signal) {
      if (!/^(?:tel:\+[1-9]\d{7,14}|sip:[^\s@]+@[^\s]+)$/.test(request.target_uri)) throw new RangeError("target_uri must be tel:+E164 or sip:user@host");
      return http.requestJson(callPath(callId, "refer"), { method: "POST", ...jsonBody(request), signal }, decodeEmptyObject);
    },
    hangup(callId, signal) {
      return http.requestJson(callPath(callId, "hangup"), { method: "POST", ...jsonBody({}), signal }, decodeEmptyObject);
    },
  };
}
```

`dispatch_signing_secret`는 response에서 단 한 번만 제공될 수 있다. client는 저장·로그 기능을 추가하지 않고 caller가 즉시 secret store에 넣도록 반환만 한다. inbound webhook을 소비하는 서버는 raw body와 `webhook-id`, `webhook-timestamp`, `webhook-signature`를 signing secret으로 검증한 뒤 `RealtimeCallIncomingWebhook` decoder를 호출해야 한다. webhook server 구현은 이 단계 범위가 아니다.

`refer`는 동기 결과다. 200 `{}`는 destination answer까지 완료된 성공이다. 400은 URI 오류, 404는 SIP participant 없음, 502는 downstream SIP 거절, 504는 timeout이다. 실패해도 기존 realtime WS는 유지되며 자동 hangup/reconnect하지 않는다.

## 12. NEW `tests/voice-ws.test.ts`

`ws.WebSocketServer({port: 0})`를 사용하고 sleep을 쓰지 않는다. `once(server, "listening")`, message promise, close promise로 동기화한다.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createSttSession, createTtsSession, ephemeralProtocols } from "../src/voice/ws-client.js";
import { createRealtimeClient, reduceRealtimeEvent, PINNED_REALTIME_MODEL } from "../src/voice/realtime.js";
import {
  parseRealtimeServerEvent, parseSttServerEvent,
  REALTIME_SERVER_EVENT_TYPES, STT_SERVER_EVENT_TYPES,
} from "../src/voice/protocol.js";

describe("Voice WebSocket", () => {
  it("exports the same browser-safe protocol decoders and event names consumed by wp13", () => {});
  it("uses OAuth bearer headers for server-side STT/TTS/realtime", async () => {});
  it("uses xai-client-secret subprotocol without putting the secret in URL", async () => {});
  it("supports the OpenAI-compatible three-subprotocol form", () => {});
  it("rejects ephemeral auth for SIP call_id sessions before dialing", async () => {});
  it("waits for transcript.created before binary STT audio", async () => {});
  it("sends binary frames plus finalize and audio.done controls", async () => {});
  it("repeats keyterm query values and validates multichannel/vad ranges", async () => {});
  it("treats speech_final partial as final when transcript.done text is empty", async () => {});
  it("maps close 1006 after speech_final to completed-with-transport-close", async () => {});
  it("treats close 1006 before any terminal evidence as failure", async () => {});
  it("streams text.delta/text.done to audio.delta/audio.done and reuses TTS socket", async () => {});
  it("defaults realtime model to grok-voice-think-fast-2.0", async () => {});
  it("maps session, VAD, audio, function, MCP, DTMF and response.done events", () => {});
  it("sends force_message without an automatic response.create", async () => {});
  it("responds to ping with pong and preserves ping_timestamp", async () => {});
  it("builds resumption URL and replays created/added items without auto reconnect", async () => {});
  it("aborts, closes once and removes listeners without mid-stream retry", async () => {});
  it("closes with 1009 when the bounded receive queue is exceeded", async () => {});
});
```

1006 테스트는 server가 실제 `terminate()`를 호출해 abnormal close를 만든다. speech_final fixture text와 done fixture text는 서로 다른 값(예: `"authoritative partial"`, `""`)이어야 precedence가 검증된다.

## 13. NEW `tests/voice-sip.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSipClient } from "../src/voice/sip.js";

describe("Voice SIP", () => {
  it("sends BYO phone registration to exact /v2/phone-numbers", async () => {});
  it("keeps digest auth password request-only", async () => {});
  it("returns dispatch signing secret once without logging it", async () => {});
  it("rejects simultaneous agent_id and webhook at type/runtime boundaries", async () => {});
  it("accepts only tel:+E164 or sip:user@host refer targets", async () => {});
  it("decodes 200 empty objects for refer and hangup", async () => {});
  it("preserves 400/404/502/504 as distinct VoiceHttpError status values", async () => {});
  it("does not retry phone create, refer, or hangup POST", async () => {});
  it("normalizes /v2 without changing api.x.ai host", async () => {});
});
```

Type-level XOR은 `// @ts-expect-error` compile fixture로 검증하고 runtime test는 JS/unknown caller가 두 routing target을 함께 넣은 경우 validation이 거부하는지 검사한다.

## 14. 구현 순서

1. wp5/wp6/wp9 실제 exports를 다시 읽고 stale diff를 이 문서에 먼저 반영한다.
2. wp10 단독으로 `ws`/`@types/ws`를 설치하고 lockfile을 검토한다.
3. `/v2` base URL 회귀 테스트를 red로 만든 뒤 `base-url.ts`를 수정한다.
4. Node import가 없는 `protocol.ts`를 먼저 만들고 STT/TTS/realtime event 이름·타입·상수·decoder를 고정한다.
5. `ws-client.ts`의 bounded dial/auth/abort를 만들고 local test server handshake 테스트를 통과시킨다. production 연결은 항상 `wss://api.x.ai` 직결이다.
6. STT parser/state를 구현해 speech_final/empty done/1006 순서를 red-green한다.
7. TTS multi-utterance state를 구현한다.
8. realtime parser, reducer, session methods, ping/pong, resumption을 구현한다. event 계약은 `protocol.ts`에서만 import한다.
9. SIP REST 타입과 client를 구현한다.
10. focused tests, typecheck, 전체 test, browser build, dependency audit를 실행한다.

## 15. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --test --test-concurrency=1 --import tsx --experimental-test-module-mocks tests/voice-ws.test.ts tests/voice-sip.test.ts
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

유료 live smoke와 실제 OAuth token/ephemeral secret 사용은 wp14의 명시적 gate에서만 실행한다.

```bash
PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts
```

live evidence에는 status, content type, byte count/hash, terminal event만 남기고 transcript, audio, token, signed secret, raw error body는 남기지 않는다.

## 16. 완료 조건

- `ws`와 `@types/ws`가 manifest/lock에 정확히 한 번 존재하고 high dependency audit가 0이다.
- `ws`/`@types/ws` 추가와 lockfile 변경은 wp10 diff에만 있고 wp11 이후 단계에는 `NO CHANGE — precondition`으로만 남는다.
- `src/voice/protocol.ts`가 STT/TTS/realtime event 이름·타입·상수·decoder의 SSOT이며 Node builtin, `ws`, auth, transport를 import하지 않는다. wp13 browser code는 이 파일을 직접 import한다.
- `/v2/phone-numbers`가 정확히 `https://api.x.ai/v2/phone-numbers`로 간다.
- STT는 ready 전 audio를 거부하고 binary/finalize/audio.done을 정확히 보낸다.
- speech_final partial이 최종 text의 권위자이며 empty transcript.done과 1006이 이를 지우지 않는다.
- terminal 증거 없는 1006과 protocol shape 오류는 실패다.
- TTS는 text.delta/text.done과 audio.delta/audio.done을 처리하고 한 socket에서 다음 utterance를 허용한다.
- realtime은 pinned 2.0 기본, alias opt-in, session.update, VAD, binary/json audio, tools, force_message, resumption, DTMF, ping/pong을 타입과 테스트로 가진다.
- ephemeral secret은 subprotocol에만 있고 URL/log에 없다. SIP call_id와 함께 쓸 수 없다.
- phone registration, refer, hangup의 모든 요청/응답 타입과 error status가 검증된다.
- automatic reconnect와 post-commit replay가 없다.
- 로컬 WS upgrade/relay route가 없고 모든 Voice WebSocket production URL은 `wss://api.x.ai` 직결이다.
- 공개 factory는 `createTtsClient`, `createSttClient`, `createRealtimeClient`이며 wp12/wp13 소비자용 별칭 helper를 추가하지 않는다.
- `tests/voice-ws.test.ts`는 wp10이 NEW로 만들고 wp14는 MODIFY만 한다.
- focused tests, typecheck, 전체 test, build, audit가 모두 exit 0이다.
- `auth.json`, CLI 명령, `/health`, HTTP `/v1/*` 포워딩 계약에 breaking change가 없다.
