# WP9 Voice REST 구현 PRD

## 0. 결론과 실행 범위

이 단계는 xAI Voice HTTP 표면을 `src/voice/`의 타입드 클라이언트로 구현한다. 프록시의 기존 opaque relay는 유지하며, CLI 명령과 웹앱 연결은 각각 wp12와 wp13이 맡는다. 구현자는 이 문서의 파일 목록과 TypeScript 골격을 그대로 옮기고, 외부 wire 응답을 `unknown`에서 검증한 뒤에만 공개 타입으로 승격한다.

이 단계가 소유하는 엔드포인트는 다음과 같다.

| Method | Path | 응답 | 2026-09-18 판정 |
|---|---|---|---|
| POST | `/v1/tts` | raw audio 또는 timestamp JSON | OAuth live 200, `audio/mpeg`; `output_format`은 객체 |
| GET | `/v1/tts/voices` | JSON voice 목록 | OAuth live 200 |
| GET | `/v1/tts/voices/{voice_id}` | JSON voice | OAuth live 200 |
| POST | `/v1/stt` | JSON transcript | OAuth live 200; multipart의 `file`은 마지막 field |
| POST | `/v1/realtime/client_secrets` | JSON ephemeral secret | OAuth live 200 |
| POST/GET | `/v1/custom-voices` | JSON voice/create/list | 문서 확인, live 미확인 |
| GET/PATCH/DELETE | `/v1/custom-voices/{voice_id}` | JSON voice/delete | 문서 확인, live 미확인 |
| GET | `/v1/custom-voices/{voice_id}/audio` | raw audio | 문서 확인, live 미확인 |

근거는 `001_endpoint_inventory.md:88-103`, base URL live 판정 `001_endpoint_inventory.md:143-166`, X 전용 TTS/STT 사실 `002_x_only_voice_research.md:107-165`, 공식 스키마 요약 `003_cookbook_grokbuild_research.md:47-90`이다. 보조 확인한 공식 원문은 <https://docs.x.ai/developers/rest-api-reference/inference/voice.md>와 <https://docs.x.ai/developers/model-capabilities/audio/custom-voices.md>이며 확인일은 2026-09-18이다.

## 1. 구조 결정과 비목표

의존 방향은 다음 하나로 고정한다.

```text
voice/{tts,stt,custom-voices,client-secrets}.ts
  -> voice/http.ts
  -> transport/fetch.ts
  -> auth/bearer-session.ts
```

선택한 구조의 이유:

- `voice/http.ts`만 HTTP status, 오류 본문 제한, JSON/byte 응답 경계를 소유한다.
- 각 endpoint 파일은 request 직렬화, response decoder, 도메인 제약만 소유한다.
- OAuth refresh와 401 replay, base URL, retry는 wp5/wp6에 남긴다. Voice 파일에서 `getValidBearer()`나 `fetch()`를 직접 호출하지 않는다.
- `POST /v1/tts`, `/v1/stt`, `/v1/realtime/client_secrets`, custom voice mutation은 idempotency key가 없으므로 wp6의 `replay: "never"`가 적용된다.
- GET voice 조회만 wp6의 idempotent retry를 쓴다.

거절한 대안:

- 모든 Voice endpoint를 `voice.ts` 한 파일에 넣지 않는다. 바이너리, multipart, JSON CRUD의 실패 경계가 다르다.
- OpenAI식 `/v1/audio/speech`, `/v1/audio/transcriptions` alias를 만들지 않는다. 실측상 xAI 표면이 아니며 `001_endpoint_inventory.md:102-103`과 충돌한다.
- custom voice 미확인 응답을 성공으로 추정하지 않는다. decoder가 문서 shape를 검증하고 그 밖의 wire는 `voice_invalid_response`로 실패한다.
- 이 단계에서 WS를 구현하지 않는다. `/v1/realtime/client_secrets`만 wp10이 재사용할 REST 선행 계약으로 만든다.

## 2. 위협 모델과 반드시 지킬 경계

자산은 OAuth bearer, ephemeral secret, custom voice reference audio, transcript 원문, custom voice 생성 권한이다. 진입점은 JSON body, multipart file/URL, xAI 오류 body, binary audio response다. 공격자 또는 고장 난 upstream은 거대 파일, 잘못된 enum/range, file/url 동시 지정, JSON이라고 표시된 비JSON, token이 든 오류 문자열을 보낼 수 있다.

통제:

1. request 값은 endpoint 경계에서 range와 상호 의존성을 검사한다.
2. STT file은 최대 500 MB이며 FormData의 마지막 field로만 append한다.
3. custom voice ID는 `^[a-z0-9]{8}$`를 만족해야 path에 들어간다. 모든 path segment는 `encodeURIComponent`한다.
4. upstream 오류 body는 최대 64 KiB까지만 읽고 raw body나 upstream message를 Error에 보존하지 않는다.
5. ephemeral token, bearer, transcript, reference audio는 로그에 기록하지 않는다.
6. 성공 JSON은 `unknown`으로 파싱하고 필수 필드와 배열 원소를 검증한다.
7. `Content-Type`이 audio면 JSON parse를 시도하지 않고 bytes로 반환한다.
8. custom voice create는 Enterprise/지역 gate의 403을 `voice_forbidden`으로 보존하며 fallback을 만들지 않는다.

## 3. 공개 계약 보존과 마이그레이션

- Voice REST 공개 API의 권위자는 factory인 `createTtsClient(options?: VoiceClientOptions): TtsClient`와 `createSttClient(options?: VoiceClientOptions): SttClient`다. 호출 계약은 각각 `createTtsClient().synthesize(request, signal?)`와 `createSttClient().transcribe(request, signal?)`이며, wp12 CLI와 wp13 웹앱은 이 이름을 그대로 사용한다. `synthesizeSpeech`/`transcribeSpeech` 같은 별도 top-level helper를 만들지 않는다.
- `TtsRequest`에는 `model` 필드가 없고, `TtsResult`는 `kind: "audio" | "json"`으로 분기하는 discriminated union이다. wp12도 factory 반환값과 이 union을 그대로 소비한다.
- `~/.progrok/auth.json`의 camelCase 스키마는 읽지도 쓰지도 않는다. wp5의 accessor만 간접 사용한다. 마이그레이션 없음.
- 기존 CLI 명령과 옵션은 변경하지 않는다. 새 Voice CLI는 wp12 소유다.
- `GET /health` payload는 변경하지 않는다.
- 모든 HTTP `/v1/*` 포워딩은 유지한다. wp8 정책대로 TTS binary와 STT multipart는 opaque relay이며 이 클라이언트 추가가 proxy whitelist를 만들지 않는다.
- localhost client가 기존처럼 `/v1/tts`, `/v1/stt`, custom voice 경로를 호출하면 status/header/body가 그대로 relay된다.
- 위 두 문장의 relay는 HTTP에만 해당한다. 로컬 WebSocket relay는 만들지 않으며 STT/TTS/realtime WebSocket client는 `wss://api.x.ai`에 직접 연결한다.
- `src/commands/capabilities.ts`와 `skills/progrok/SKILL.md`의 갱신은 wp12/wp15에 맡긴다.

## 4. 파일 변경 manifest

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| NEW | `src/voice/http.ts` | wp6 transport adapter, typed HTTP 오류, bounded JSON/bytes decode |
| NEW | `src/voice/tts.ts` | TTS request/response, voices 조회, output_format/replace 검증 |
| NEW | `src/voice/stt.ts` | STT source 합타입, multipart 순서, transcript decoder |
| NEW | `src/voice/custom-voices.ts` | custom voice CRUD와 audio download |
| NEW | `src/voice/client-secrets.ts` | ephemeral client secret 발급 |
| NEW | `tests/voice-rest.test.ts` | deterministic fake fetch 계약 테스트 |
| MODIFY | 없음 | 현재 `src/voice/`가 없으므로 기존 소스에 병렬 소유자를 만들지 않는다 |
| DELETE | 없음 | HTTP 패스스루와 기존 공개 계약을 유지한다 |

`tests/voice-rest.test.ts`의 생성 소유자는 wp9이다. `100_wp14_verification.md:266-281`은 같은 파일을 NEW로 적지 않고 **MODIFY만** 하여 보강/감사한다. 또한 그 문서의 “URL STT without creating multipart” 기대는 001의 multipart SSOT와 공식 request schema에 맞게 “URL source도 multipart이며 file part는 없음”으로 수정해야 한다.

## 5. NEW `src/voice/http.ts`

### 공개 타입과 핵심 본문

```ts
import { readPackageVersion } from "../utils/version.js";
import { xaiFetch, type TransportDeps } from "../transport/fetch.js";

const MAX_ERROR_BODY_BYTES = 64 * 1024;

export type VoiceErrorCode =
  | "voice_auth_required"
  | "voice_forbidden"
  | "voice_not_found"
  | "voice_validation_error"
  | "voice_rate_limited"
  | "voice_upstream_error"
  | "voice_invalid_response";

export class VoiceHttpError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    readonly status: number | undefined,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "VoiceHttpError";
  }
}

export interface VoiceClientOptions {
  clientVersion?: string;
  transport?: TransportDeps;
}

export interface VoiceHttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init: RequestInit, decode: (wire: unknown) => T): Promise<T>;
  requestBytes(path: string, init?: RequestInit): Promise<{ bytes: Uint8Array; contentType: string }>;
}

function statusCode(status: number): VoiceErrorCode {
  if (status === 401) return "voice_auth_required";
  if (status === 403) return "voice_forbidden";
  if (status === 404) return "voice_not_found";
  if (status === 400 || status === 415 || status === 422) return "voice_validation_error";
  if (status === 429) return "voice_rate_limited";
  return "voice_upstream_error";
}

async function throwForStatus(response: Response): Promise<never> {
  // Body는 connection 재사용을 위해 소비하되 Error에는 넣지 않는다.
  const reader = response.body?.getReader();
  let read = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } catch { /* status가 오류 분류의 권위자다 */ }
  throw new VoiceHttpError(
    statusCode(response.status),
    response.status,
    `xAI Voice request failed with HTTP ${response.status}`,
    response.headers.get("retry-after") ?? undefined,
  );
}

export function createVoiceHttpClient(options: VoiceClientOptions = {}): VoiceHttpClient {
  const clientVersion = options.clientVersion ?? readPackageVersion();
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await xaiFetch({
      path,
      method: init.method ?? "GET",
      incomingHeaders: Object.fromEntries(new Headers(init.headers)),
      body: init.body ?? undefined,
      signal: init.signal ?? undefined,
      clientVersion,
    }, options.transport);
    if (!response.ok) await throwForStatus(response);
    return response;
  };

  return {
    request,
    async requestJson<T>(path, init, decode): Promise<T> {
      const response = await request(path, {
        ...init,
        headers: new Headers({ Accept: "application/json", ...Object.fromEntries(new Headers(init.headers)) }),
      });
      let wire: unknown;
      try { wire = await response.json(); }
      catch { throw new VoiceHttpError("voice_invalid_response", response.status, "xAI Voice returned invalid JSON"); }
      try { return decode(wire); }
      catch (cause) {
        if (cause instanceof VoiceHttpError) throw cause;
        throw new VoiceHttpError("voice_invalid_response", response.status, "xAI Voice response shape was invalid");
      }
    },
    async requestBytes(path, init = {}) {
      const response = await request(path, init);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },
  };
}

export function expectRecord(wire: unknown, label: string): Record<string, unknown> {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) {
    throw new VoiceHttpError("voice_invalid_response", undefined, `${label} must be an object`);
  }
  return wire as Record<string, unknown>;
}

export function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new VoiceHttpError("voice_invalid_response", undefined, `${key} must be a string`);
  }
  return value;
}

export function jsonBody(value: unknown): Pick<RequestInit, "headers" | "body"> {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
```

`RequestInit.signal`의 `null` 가능성은 `undefined`로 정규화한다. wp6가 구현 시 `xaiFetch` 대신 `executeXaiFetch`로 이름을 확정했다면 이 한 import/call만 최신 계약으로 바꾸고 endpoint 파일은 수정하지 않는다.

## 6. NEW `src/voice/tts.ts`

### endpoint 타입 전부

```ts
import {
  createVoiceHttpClient, expectRecord, expectString, jsonBody,
  VoiceHttpError, type VoiceClientOptions,
} from "./http.js";

export type TtsCodec = "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
export type AudioSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export type Mp3BitRate = 32000 | 64000 | 96000 | 128000 | 192000;

export interface TtsOutputFormat {
  codec: TtsCodec;
  sample_rate?: AudioSampleRate | null;
  bit_rate?: Mp3BitRate | null;
}

export interface TtsRequest {
  text: string;
  language: "auto" | (string & {});
  voice_id?: string;
  output_format?: TtsOutputFormat;
  optimize_streaming_latency?: "0" | "1";
  text_normalization?: boolean;
  with_timestamps?: boolean;
  speed?: number;
  replace?: Record<string, string>;
}

export interface TtsGraphTime { start: number; end: number }
export interface TtsAudioTimestamps {
  graph_chars: string[];
  graph_times: TtsGraphTime[];
}
export interface TtsJsonResponse {
  audio: string;
  content_type: string;
  duration: number;
  audio_timestamps?: TtsAudioTimestamps;
}
export type TtsResult =
  | { kind: "audio"; bytes: Uint8Array; contentType: string }
  | { kind: "json"; value: TtsJsonResponse };

export interface TtsVoice {
  voice_id: string;
  name: string;
  language: string | null;
}
export interface ListTtsVoicesResponse { voices: TtsVoice[] }

export interface TtsClient {
  synthesize(request: TtsRequest, signal?: AbortSignal): Promise<TtsResult>;
  listVoices(signal?: AbortSignal): Promise<ListTtsVoicesResponse>;
  getVoice(voiceId: string, signal?: AbortSignal): Promise<TtsVoice>;
}
```

`output_format`은 문자열 shortcut이 아니라 위 객체다. `bit_rate`는 MP3에만 허용한다. `replace`는 case-insensitive whole-word pronunciation map이며 최대 200개, key 100자, value 128자다. `speed`는 0.7–1.5다. `text`는 현재 공식 스키마 기준 최대 60,000자다. 저장소 기존 문서의 15,000자와 latency level 2는 wp15에서 교정한다.

### 핵심 본문

```ts
function validateTtsRequest(request: TtsRequest): void {
  if (request.text.length === 0 || request.text.length > 60_000) throw new RangeError("text must contain 1..60000 characters");
  if (!request.language.trim()) throw new RangeError("language is required");
  if (request.speed !== undefined && (request.speed < 0.7 || request.speed > 1.5)) throw new RangeError("speed must be 0.7..1.5");
  if (request.output_format?.bit_rate != null && request.output_format.codec !== "mp3") {
    throw new RangeError("bit_rate is valid only for mp3");
  }
  const replacements = Object.entries(request.replace ?? {});
  if (replacements.length > 200) throw new RangeError("replace supports at most 200 entries");
  for (const [from, to] of replacements) {
    if (!/^[\p{L}\p{N}' ]+$/u.test(from) || from.length > 100 || to.length === 0 || to.length > 128) {
      throw new RangeError("replace entry is invalid");
    }
  }
}

function decodeTtsJson(wire: unknown): TtsJsonResponse {
  const record = expectRecord(wire, "TTS response");
  const duration = record.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration)) throw new TypeError("duration must be finite");
  const value: TtsJsonResponse = {
    audio: expectString(record, "audio"),
    content_type: expectString(record, "content_type"),
    duration,
  };
  if (record.audio_timestamps !== undefined) {
    const timestamps = expectRecord(record.audio_timestamps, "audio_timestamps");
    if (!Array.isArray(timestamps.graph_chars) || !Array.isArray(timestamps.graph_times)) throw new TypeError("invalid audio_timestamps");
    value.audio_timestamps = {
      graph_chars: timestamps.graph_chars.map((item) => {
        if (typeof item !== "string") throw new TypeError("graph_chars item must be string");
        return item;
      }),
      graph_times: timestamps.graph_times.map((item) => {
        const time = expectRecord(item, "graph_time");
        if (typeof time.start !== "number" || typeof time.end !== "number") throw new TypeError("invalid graph_time");
        return { start: time.start, end: time.end };
      }),
    };
  }
  return value;
}

function decodeVoice(wire: unknown): TtsVoice {
  const record = expectRecord(wire, "voice");
  if (!(record.language === null || typeof record.language === "string")) throw new TypeError("language must be string or null");
  return { voice_id: expectString(record, "voice_id"), name: expectString(record, "name"), language: record.language };
}

export function createTtsClient(options: VoiceClientOptions = {}): TtsClient {
  const http = createVoiceHttpClient(options);
  return {
    async synthesize(request, signal) {
      validateTtsRequest(request);
      const response = await http.request("/v1/tts", { method: "POST", ...jsonBody(request), signal });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("application/json")) {
        let wire: unknown;
        try { wire = await response.json(); }
        catch { throw new VoiceHttpError("voice_invalid_response", response.status, "TTS returned invalid JSON"); }
        return { kind: "json", value: decodeTtsJson(wire) };
      }
      return {
        kind: "audio",
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: contentType || "application/octet-stream",
      };
    },
    listVoices(signal) {
      return http.requestJson("/v1/tts/voices", { signal }, (wire) => {
        const record = expectRecord(wire, "voice list");
        if (!Array.isArray(record.voices)) throw new TypeError("voices must be an array");
        return { voices: record.voices.map(decodeVoice) };
      });
    },
    getVoice(voiceId, signal) {
      if (!/^[a-z0-9-]+$/.test(voiceId)) throw new RangeError("invalid voice id");
      return http.requestJson(`/v1/tts/voices/${encodeURIComponent(voiceId)}`, { signal }, decodeVoice);
    },
  };
}
```

TTS wire 문서는 JSON response를 기술하지만 라이브 응답은 `audio/mpeg` raw bytes였다. content-type 분기가 둘을 모두 보존하며 한쪽을 추정해 깨지 않는다.

## 7. NEW `src/voice/stt.ts`

### endpoint 요청/응답 타입 전부

```ts
import { createVoiceHttpClient, expectRecord, expectString, type VoiceClientOptions } from "./http.js";
import type { AudioSampleRate } from "./tts.js";

export type SttAudioFormat = "pcm" | "mulaw" | "alaw" | "wav" | "mp3" | "ogg" | "opus" | "flac" | "aac" | "mp4" | "m4a" | "mkv";
export type SttSource =
  | { file: Blob; filename: string; url?: never }
  | { url: string; file?: never; filename?: never };

export type SttRequest = SttSource & {
  audio_format?: SttAudioFormat;
  sample_rate?: AudioSampleRate;
  language?: string;
  format?: boolean;
  multichannel?: boolean;
  channels?: number;
  diarize?: boolean;
  keyterm?: string[];
  filler_words?: boolean;
  vad_threshold?: number;
};

export interface SttWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}
export interface SttChannel {
  index: number;
  language?: string;
  text: string;
  words?: SttWord[];
}
export interface SttResponse {
  text: string;
  language: string;
  duration: number;
  words?: SttWord[];
  channels?: SttChannel[];
}
export interface SttClient {
  transcribe(request: SttRequest, signal?: AbortSignal): Promise<SttResponse>;
}
```

### multipart 조립과 decoder

```ts
const RAW_FORMATS = new Set<SttAudioFormat>(["pcm", "mulaw", "alaw"]);

function validateSttRequest(request: SttRequest): void {
  const raw = request as Partial<{ file: Blob; filename: string; url: string }>;
  const hasFile = raw.file instanceof Blob;
  const hasUrl = typeof raw.url === "string";
  if (hasFile === hasUrl) throw new RangeError("exactly one of file or url is required");
  if (hasFile && raw.file!.size > 500 * 1024 * 1024) throw new RangeError("STT file exceeds 500 MB");
  if (hasFile && (!raw.filename || raw.filename.trim().length === 0)) throw new RangeError("filename is required for file input");
  if (hasUrl) {
    const url = new URL(raw.url!);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new RangeError("STT url must use http or https");
  }
  if (request.audio_format && RAW_FORMATS.has(request.audio_format) && request.sample_rate === undefined) {
    throw new RangeError("sample_rate is required for raw audio");
  }
  if (request.format && !request.language) throw new RangeError("language is required when format=true");
  if (request.multichannel && request.channels !== undefined && (request.channels < 2 || request.channels > 8)) {
    throw new RangeError("channels must be 2..8");
  }
  if (request.keyterm && (request.keyterm.length > 100 || request.keyterm.some((term) => term.length === 0 || term.length > 50))) {
    throw new RangeError("keyterm supports at most 100 non-empty values of 50 characters");
  }
  if (request.vad_threshold !== undefined && (request.vad_threshold < 0 || request.vad_threshold > 1)) {
    throw new RangeError("vad_threshold must be 0..1");
  }
}

export function buildSttForm(request: SttRequest): FormData {
  validateSttRequest(request);
  const form = new FormData();
  const append = (name: string, value: string | number | boolean | undefined) => {
    if (value !== undefined) form.append(name, String(value));
  };
  if ("url" in request) form.append("url", request.url);
  append("audio_format", request.audio_format);
  append("sample_rate", request.sample_rate);
  append("language", request.language);
  append("format", request.format);
  append("multichannel", request.multichannel);
  append("channels", request.channels);
  append("diarize", request.diarize);
  for (const term of request.keyterm ?? []) form.append("keyterm", term);
  append("filler_words", request.filler_words);
  append("vad_threshold", request.vad_threshold);
  // xAI parser의 실측 제약: file은 모든 metadata 뒤 마지막 field다.
  if ("file" in request) form.append("file", request.file, request.filename);
  return form;
}

function decodeWord(wire: unknown): SttWord {
  const value = expectRecord(wire, "STT word");
  if (typeof value.start !== "number" || typeof value.end !== "number") throw new TypeError("invalid STT word timestamps");
  const word: SttWord = { text: expectString(value, "text"), start: value.start, end: value.end };
  if (typeof value.confidence === "number") word.confidence = value.confidence;
  if (typeof value.speaker === "number" && Number.isInteger(value.speaker)) word.speaker = value.speaker;
  return word;
}

function decodeSttResponse(wire: unknown): SttResponse {
  const value = expectRecord(wire, "STT response");
  if (typeof value.duration !== "number" || !Number.isFinite(value.duration)) throw new TypeError("invalid duration");
  const result: SttResponse = {
    text: expectString(value, "text"),
    language: expectString(value, "language"),
    duration: value.duration,
  };
  if (value.words !== undefined) {
    if (!Array.isArray(value.words)) throw new TypeError("words must be array");
    result.words = value.words.map(decodeWord);
  }
  if (value.channels !== undefined) {
    if (!Array.isArray(value.channels)) throw new TypeError("channels must be array");
    result.channels = value.channels.map((wireChannel) => {
      const channel = expectRecord(wireChannel, "STT channel");
      if (!Number.isInteger(channel.index)) throw new TypeError("channel index must be integer");
      const decoded: SttChannel = { index: channel.index as number, text: expectString(channel, "text") };
      if (typeof channel.language === "string") decoded.language = channel.language;
      if (Array.isArray(channel.words)) decoded.words = channel.words.map(decodeWord);
      return decoded;
    });
  }
  return result;
}

export function createSttClient(options: VoiceClientOptions = {}): SttClient {
  const http = createVoiceHttpClient(options);
  return {
    transcribe(request, signal) {
      return http.requestJson("/v1/stt", { method: "POST", body: buildSttForm(request), signal }, decodeSttResponse);
    },
  };
}
```

URL source도 공식 request schema의 field이므로 multipart FormData로 보낸다. `file`과 `url`은 TypeScript 합타입과 runtime의 `in` 검사로 동시에 들어갈 수 없게 한다. `Content-Type`은 직접 설정하지 않아야 runtime이 boundary를 붙인다.

## 8. NEW `src/voice/custom-voices.ts`

### endpoint 타입 전부

```ts
import {
  createVoiceHttpClient, expectRecord, expectString, jsonBody, type VoiceClientOptions,
} from "./http.js";

export type VoiceGender = "male" | "female" | "neutral";
export type VoiceAge = "young" | "middle-aged" | "old";
export type VoiceUseCase = "conversational" | "narration" | "characters" | "educational" | "advertisement" | "social_media" | "entertainment";
export type VoiceTone = "warm" | "casual" | "professional" | "friendly" | "authoritative" | "expressive" | "calm";

export interface CustomVoiceMetadataInput {
  name?: string;
  description?: string;
  gender?: VoiceGender;
  accent?: string;
  age?: VoiceAge;
  language?: string;
  use_case?: VoiceUseCase;
  tone?: VoiceTone;
}
export interface CreateCustomVoiceRequest extends CustomVoiceMetadataInput {
  file: Blob;
  filename: string;
}
export interface UpdateCustomVoiceRequest {
  name?: string | null;
  description?: string | null;
  gender?: VoiceGender | null;
  accent?: string | null;
  age?: VoiceAge | null;
  language?: string | null;
  use_case?: VoiceUseCase | null;
  tone?: VoiceTone | null;
}
export interface CustomVoice {
  voice_id: string;
  name: string | null;
  description: string | null;
  gender: VoiceGender | null;
  accent: string | null;
  age: VoiceAge | null;
  language: string | null;
  use_case: VoiceUseCase | null;
  tone: VoiceTone | null;
  created_at: string;
}
export interface ListCustomVoicesRequest { limit?: number; pagination_token?: string }
export interface ListCustomVoicesResponse { voices: CustomVoice[]; pagination_token: string | null }
export interface DeleteCustomVoiceResponse { deleted: true }
export interface CustomVoiceAudioResponse { bytes: Uint8Array; contentType: string }

export interface CustomVoicesClient {
  create(request: CreateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>;
  list(request?: ListCustomVoicesRequest, signal?: AbortSignal): Promise<ListCustomVoicesResponse>;
  get(voiceId: string, signal?: AbortSignal): Promise<CustomVoice>;
  update(voiceId: string, request: UpdateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>;
  delete(voiceId: string, signal?: AbortSignal): Promise<DeleteCustomVoiceResponse>;
  getAudio(voiceId: string, signal?: AbortSignal): Promise<CustomVoiceAudioResponse>;
}
```

### 핵심 본문

```ts
const VOICE_ID = /^[a-z0-9]{8}$/;
const MUTABLE_FIELDS = ["name", "description", "gender", "accent", "age", "language", "use_case", "tone"] as const;

function voicePath(voiceId: string, suffix = ""): string {
  if (!VOICE_ID.test(voiceId)) throw new RangeError("custom voice id must be 8 lowercase alphanumeric characters");
  return `/v1/custom-voices/${encodeURIComponent(voiceId)}${suffix}`;
}

function decodeNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || typeof value === "string") return value;
  throw new TypeError(`${key} must be string or null`);
}

function decodeNullableEnum<const T extends string>(
  record: Record<string, unknown>, key: string, allowed: readonly T[],
): T | null {
  const value = decodeNullableString(record, key);
  if (value === null) return null;
  if (!allowed.includes(value as T)) throw new TypeError(`${key} has an unsupported value`);
  return value as T;
}

function decodeCustomVoice(wire: unknown): CustomVoice {
  const value = expectRecord(wire, "custom voice");
  const voiceId = expectString(value, "voice_id");
  if (!VOICE_ID.test(voiceId)) throw new TypeError("invalid custom voice id");
  return {
    voice_id: voiceId,
    name: decodeNullableString(value, "name"),
    description: decodeNullableString(value, "description"),
    gender: decodeNullableEnum(value, "gender", ["male", "female", "neutral"]),
    accent: decodeNullableString(value, "accent"),
    age: decodeNullableEnum(value, "age", ["young", "middle-aged", "old"]),
    language: decodeNullableString(value, "language"),
    use_case: decodeNullableEnum(value, "use_case", ["conversational", "narration", "characters", "educational", "advertisement", "social_media", "entertainment"]),
    tone: decodeNullableEnum(value, "tone", ["warm", "casual", "professional", "friendly", "authoritative", "expressive", "calm"]),
    created_at: expectString(value, "created_at"),
  };
}

function createForm(request: CreateCustomVoiceRequest): FormData {
  const form = new FormData();
  for (const field of MUTABLE_FIELDS) {
    const value = request[field];
    if (value !== undefined) {
      if (value.length === 0) throw new RangeError(`${field} must not be empty`);
      form.append(field, value);
    }
  }
  // reference audio도 metadata 뒤에 둬 wire ordering을 결정적으로 유지한다.
  form.append("file", request.file, request.filename);
  return form;
}

export function createCustomVoicesClient(options: VoiceClientOptions = {}): CustomVoicesClient {
  const http = createVoiceHttpClient(options);
  return {
    create(request, signal) {
      return http.requestJson("/v1/custom-voices", { method: "POST", body: createForm(request), signal }, decodeCustomVoice);
    },
    list(request = {}, signal) {
      if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000)) {
        throw new RangeError("limit must be 1..1000");
      }
      const query = new URLSearchParams();
      if (request.limit !== undefined) query.set("limit", String(request.limit));
      if (request.pagination_token) query.set("pagination_token", request.pagination_token);
      const path = `/v1/custom-voices${query.size ? `?${query}` : ""}`;
      return http.requestJson(path, { signal }, (wire) => {
        const value = expectRecord(wire, "custom voice list");
        if (!Array.isArray(value.voices)) throw new TypeError("voices must be array");
        if (!(value.pagination_token === null || typeof value.pagination_token === "string" || value.pagination_token === undefined)) {
          throw new TypeError("pagination_token must be string or null");
        }
        return { voices: value.voices.map(decodeCustomVoice), pagination_token: value.pagination_token ?? null };
      });
    },
    get(voiceId, signal) { return http.requestJson(voicePath(voiceId), { signal }, decodeCustomVoice); },
    update(voiceId, request, signal) {
      const entries = Object.entries(request);
      if (entries.length === 0) throw new RangeError("custom voice update must contain at least one field");
      if (entries.some(([, value]) => value === "")) throw new RangeError("empty strings are rejected; use null to clear");
      return http.requestJson(voicePath(voiceId), { method: "PATCH", ...jsonBody(request), signal }, decodeCustomVoice);
    },
    delete(voiceId, signal) {
      return http.requestJson(voicePath(voiceId), { method: "DELETE", signal }, (wire) => {
        const value = expectRecord(wire, "delete response");
        if (value.deleted !== true) throw new TypeError("deleted must be true");
        return { deleted: true };
      });
    },
    getAudio(voiceId, signal) { return http.requestBytes(voicePath(voiceId, "/audio"), { signal }); },
  };
}
```

Create 성공은 201, read/update/delete는 200이다. reference는 최대 120초, team 기본 한도 30, create API는 Enterprise/미국(일리노이 제외) gate다. 클라이언트는 지역/plan을 추측하지 않고 upstream 403을 보존한다.

## 9. NEW `src/voice/client-secrets.ts`

### endpoint 요청/응답 타입 전부와 본문

```ts
import {
  createVoiceHttpClient, expectRecord, expectString, jsonBody, type VoiceClientOptions,
} from "./http.js";

export type RealtimeVoiceModel = "grok-voice-latest" | "grok-voice-think-fast-2.0";
export type RealtimeReasoningEffort = "high" | "none";

export interface CreateClientSecretRequest {
  expires_after?: { seconds: number };
  session?: {
    model?: RealtimeVoiceModel;
    reasoning?: { effort?: RealtimeReasoningEffort };
  } | null;
}
export interface ClientSecretResponse {
  value: string;
  expires_at: number;
}
export interface ClientSecretsClient {
  create(request?: CreateClientSecretRequest, signal?: AbortSignal): Promise<ClientSecretResponse>;
}

function decodeClientSecret(wire: unknown): ClientSecretResponse {
  const value = expectRecord(wire, "client secret");
  if (!Number.isInteger(value.expires_at)) throw new TypeError("expires_at must be integer epoch seconds");
  return { value: expectString(value, "value"), expires_at: value.expires_at as number };
}

export function createClientSecretsClient(options: VoiceClientOptions = {}): ClientSecretsClient {
  const http = createVoiceHttpClient(options);
  return {
    create(request = {}, signal) {
      const seconds = request.expires_after?.seconds;
      if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)) {
        throw new RangeError("client secret lifetime must be 1..3600 seconds");
      }
      return http.requestJson(
        "/v1/realtime/client_secrets",
        { method: "POST", ...jsonBody(request), signal },
        decodeClientSecret,
      );
    },
  };
}
```

기본 TTL은 upstream의 600초이며 최대 3600초다. 응답 `value`는 caller에게만 반환하고 객체 inspect/logging helper를 추가하지 않는다. `grok-voice-latest`는 현재 `grok-voice-think-fast-2.0` 별칭이지만, 프로덕션 pin 선택은 wp10 realtime client의 기본값에서 처리한다.

## 10. NEW `tests/voice-rest.test.ts`

Node 내장 `node:test`와 wp6 `TransportDeps.fetch` 주입을 사용한다. 실제 network와 실제 auth 파일을 읽지 않는다. 테스트는 최소 다음 독립 행을 가진다.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTtsClient } from "../src/voice/tts.js";
import { buildSttForm, createSttClient } from "../src/voice/stt.js";
import { createCustomVoicesClient } from "../src/voice/custom-voices.js";
import { createClientSecretsClient } from "../src/voice/client-secrets.js";
import { VoiceHttpError } from "../src/voice/http.js";

describe("Voice REST", () => {
  it("serializes output_format as an object with codec/sample_rate/bit_rate", async () => {});
  it("validates speed 0.7..1.5 and pronunciation replace limits", async () => {});
  it("returns raw audio bytes and preserves audio/mpeg", async () => {});
  it("decodes timestamp JSON when content-type is application/json", async () => {});
  it("decodes list/get voice responses from unknown", async () => {});
  it("puts multipart STT file after every metadata and repeated keyterm field", () => {});
  it("sends URL STT as multipart without a file part", async () => {});
  it("requires sample_rate for pcm/mulaw/alaw and validates diarize/multichannel/vad", async () => {});
  it("decodes words, speakers and multichannel transcripts", async () => {});
  it("covers custom voice create/list/get/update/delete/audio", async () => {});
  it("rejects invalid voice ids and empty-string PATCH fields", async () => {});
  it("decodes client secret without logging its value", async () => {});
  it("maps 401, 403, 404, 422 and 429 to distinct VoiceHttpError codes", async () => {});
  it("does not retry POST mutations after a pre-header failure", async () => {});
});
```

구체적 오라클:

- fake fetch는 TTS JSON body를 파싱해 `typeof output_format === "object"`와 숫자 필드를 직접 비교한다.
- `Array.from(buildSttForm(input).keys()).at(-1) === "file"`을 검사하고 keyterm 두 개의 순서를 확인한다.
- URL source form에는 `url`이 있고 `file`이 없음을 검사한다.
- POST fake fetch 호출 횟수는 1, GET 502 뒤 성공은 wp6 정책에 따라 2임을 검사한다.
- error assertion은 raw body 문구나 token을 보지 않고 `instanceof VoiceHttpError`, `code`, `status`만 본다.
- response decoder 테스트 기대값은 hard-coded fixture이며 decoder 구현으로 기대값을 만들지 않는다.

## 11. 구현 순서

1. wp5/wp6 산출물의 실제 export가 이 문서의 `xaiFetch` 계약과 일치하는지 stale-check한다.
2. `voice/http.ts`와 typed 오류를 만들고 401/403/422/429 테스트를 먼저 red로 만든다.
3. TTS 타입, validation, raw/JSON response 분기를 구현한다.
4. STT 합타입과 multipart 조립을 구현하고 file-last 테스트를 red-green한다.
5. custom voice CRUD와 audio bytes를 구현한다.
6. client secret 발급을 구현한다.
7. focused test, typecheck, 전체 test, build를 순서대로 실행한다.

## 12. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --test --test-concurrency=1 --import tsx --experimental-test-module-mocks tests/voice-rest.test.ts
npm run typecheck
npm test
npm run build
```

유료/외부 상태를 쓰는 라이브 smoke는 이 단계의 일반 test에 넣지 않는다. wp14가 `PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts`로 TTS, batch STT, streaming STT, client secret을 한 번에 검증한다. wp9 구현자는 live credential이 없다는 이유로 deterministic 완료 조건을 낮추지 않는다.

## 13. 완료 조건

- 위 manifest의 NEW 6개 파일이 존재하고 지정하지 않은 파일은 바뀌지 않는다.
- `POST /v1/tts`가 객체형 `output_format`, speed, `replace`, raw audio와 timestamp JSON을 모두 처리한다.
- voices list/get response가 `unknown` 검증을 통과한 경우만 `TtsVoice`가 된다.
- STT가 file/url을 동시에 받지 않고, file multipart part가 항상 마지막이다.
- STT의 diarize/keyterm/multichannel/vad_threshold와 response words/channels가 타입 및 테스트에 있다.
- custom voice의 create/list/get/update/delete/audio 모든 요청·응답 타입과 함수가 있다.
- client secret TTL/model/reasoning 타입과 `value`/`expires_at` decoder가 있다.
- POST mutation은 자동 retry되지 않고 GET만 wp6 idempotent retry를 사용한다.
- focused test, typecheck, 전체 test, build가 모두 exit 0이다.
- `auth.json`, CLI 명령, `/health`, `/v1/*` relay 계약에 breaking change가 없다.
