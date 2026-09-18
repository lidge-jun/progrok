# wp12 — 기존 명령을 유지하고 3.0.0 Voice·동적 capabilities 표면을 붙인다

## 결론

wp12는 기존 12개 명령(`login/logout/status/proxy/chat/models/search/image/video/billing/capabilities/skill`)의 이름과 핵심 옵션을 유지하고 `tts`, `stt`, `live`를 추가한다. 단, `capabilities --json`의 `commands`는 `string[]`에서 객체 배열로 바뀌므로 이 단계는 호환 릴리스가 아니라 **progrok 3.0.0의 major contract change**다. top-level 등록 목록과 capabilities의 command 목록은 하나의 manifest에서 생성해 드리프트를 막는다. `capabilities`의 모델 정보는 더 이상 소스에 박힌 가격·별칭·Voice 1.0 스냅샷을 권위로 내보내지 않고, 실행 시 `/v1/models` 계열을 조회한 결과와 조회 상태를 함께 내보낸다.

`live`는 마이크/스피커 장치 제어가 아니라 stdin/stdout NDJSON Realtime event bridge다. 네이티브 오디오 장치·ffmpeg 의존성을 wp12에 추가하지 않으면서 `src/voice/realtime.ts`를 완전히 구동하고 자동화 가능한 계약을 제공한다. 브라우저/마이크 UX는 wp13이 소유한다.

## 현재 코드에서 확인한 문제

1. `src/index.ts:2-13`, `:50-63`에 import, `addCommand`, `REAL_COMMANDS`가 세 번 중복된다. 새 명령 하나를 추가할 때 세 위치 중 하나가 빠질 수 있다.
2. `src/commands/capabilities.ts:15-80`은 endpoint를 손으로 복제하고, `:209-350`은 모델·가격·별칭을 정적으로 복제한다.
3. `src/commands/capabilities.ts:351-355`의 Voice 목록은 `grok-voice-fast-1.0`, `grok-voice-think-fast-1.0`을 현재 모델처럼 노출한다. `001_endpoint_inventory.md:107-112`에 따르면 현재 alias는 `grok-voice-latest → grok-voice-think-fast-2.0`이고 프로덕션은 핀 고정이 권장된다.
4. `src/commands/models.ts:40-70`, `image.ts:70-87`, `video.ts:51-83,197-205,242-250,286-294`가 auth·URL·fetch·cast를 각자 다시 구현한다. wp11 타입드 클라이언트를 사용해야 한다.
5. `tests/cli-skill-contract.test.ts:49-56`은 이름 문자열 존재만 검사해 실제 Commander 등록과 capabilities 목록의 parity를 보장하지 않는다.

## 구조 결정

```text
command-manifest.ts  ── 이름·요약·가변성·JSON 지원의 SSOT
        │
        ├── command-registry.ts ── factory와 1:1 결합 ── index.ts
        └── capabilities.ts ── 명령 목록

surfaces/registry.ts ── capabilities endpoint 목록
surfaces/models.ts   ── capabilities live model catalog + models command
voice/{tts,stt,realtime}.ts ── tts/stt/live command
surfaces/{images,videos}.ts ── image/video command
```

Commander 객체 자체를 capabilities가 import하는 설계는 순환 의존을 만든다. 반대로 index가 수동 목록을 계속 갖는 설계는 현재 문제를 유지한다. 따라서 순수 데이터 manifest와 factory registry를 분리한다. `capabilities.ts`는 manifest만 읽고, index는 registry만 읽는다.

capabilities가 정적 fallback 모델을 계속 내보내는 안은 거절한다. 네트워크나 인증이 없으면 `models: []`와 구조화된 `modelCatalog.status`를 내보낸다. “오래됐지만 그럴듯한 모델”보다 “현재 조회 불가”가 기계 소비자에게 안전하다.

## 진입 조건 — 앞 단계 공개 계약

- wp6 소유 `src/transport/fetch.ts`가 `XaiTransport.request(path, init?, policy?): Promise<Response>`와 `createXaiTransport(options?: { signal?: AbortSignal; timeoutMs?: number }): XaiTransport`를 export해야 한다. wp12는 이 파일을 만들거나 transport 계약을 재정의하지 않고 import만 한다. 둘 중 하나라도 없으면 wp12 구현을 시작하지 않고 wp6 산출물을 먼저 완료한다.
- wp9 소유 `src/voice/tts.ts`의 `createTtsClient(options?).synthesize(request, signal?)`와 `src/voice/stt.ts`의 `createSttClient(options?).transcribe(request, signal?)`가 존재해야 한다.
- wp10 소유 `src/voice/realtime.ts`의 `createRealtimeClient(options, deps?)`와 반환 `RealtimeClient`의 semantic methods가 존재해야 한다.

위 세 모듈은 이 단계에서 `NO CHANGE — precondition`이다. wp12는 편의를 위해 `synthesizeSpeech`, `transcribeSpeech`, `connectRealtime` 같은 alias나 transport shim을 추가하지 않는다.

## 변경 매니페스트

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| NEW | `src/commands/command-manifest.ts` | 명령 이름과 agent-facing 메타데이터 SSOT |
| NEW | `src/commands/command-registry.ts` | Commander factory 등록 SSOT |
| NEW | `src/commands/tts.ts` | REST TTS CLI |
| NEW | `src/commands/stt.ts` | REST STT CLI |
| NEW | `src/commands/live.ts` | Realtime NDJSON event bridge |
| MODIFY | `src/index.ts` | 수동 import/등록/REAL_COMMANDS를 registry로 교체 |
| MODIFY | `src/commands/capabilities.ts` | endpoint registry 재사용, live catalog, 3.0.0의 schemaVersion 2 |
| MODIFY | `src/commands/models.ts` | wp11 `ModelsClient`로 전환, `--kind` 추가 |
| MODIFY | `src/commands/image.ts` | wp11 `ImagesClient`로 direct fetch 제거 |
| MODIFY | `src/commands/video.ts` | wp11 `VideosClient`로 submit/poll 제거 |
| MODIFY | `tests/cli-skill-contract.test.ts` | manifest/registry/capabilities parity 검증 |
| NEW | `tests/voice-cli.test.ts` | tts/stt/live 옵션·검증·I/O 테스트 |
| NEW | `tests/capabilities.test.ts` | live/offline/partial catalog·구식 Voice 제거 검증 |

DELETE는 없다. `login/logout/status/proxy/chat/search/billing/skill` 구현 파일은 변경하지 않는다. wp15가 `README.md`, `docs/`, `skills/progrok/SKILL.md`의 사용자 문서를 동기화한다.

## NEW — 명령 SSOT

### `src/commands/command-manifest.ts`

```ts
export const COMMAND_NAMES = [
  "login",
  "logout",
  "proxy",
  "chat",
  "models",
  "status",
  "skill",
  "capabilities",
  "search",
  "video",
  "image",
  "billing",
  "tts",
  "stt",
  "live",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Pinned operational default, not a claim about the live model catalog. */
export const DEFAULT_LIVE_MODEL = "grok-voice-think-fast-2.0";

export interface CommandManifestEntry {
  name: CommandName;
  summary: string;
  mutatesRemote: boolean;
  json: boolean;
}

export const COMMAND_MANIFEST: readonly CommandManifestEntry[] = [
  { name: "login", summary: "Authenticate with xAI OAuth.", mutatesRemote: true, json: false },
  { name: "logout", summary: "Remove local xAI credentials.", mutatesRemote: false, json: false },
  { name: "proxy", summary: "Run the local HTTP /v1 proxy.", mutatesRemote: false, json: false },
  { name: "chat", summary: "Open the local Grok web chat.", mutatesRemote: false, json: false },
  { name: "models", summary: "Read the live xAI model catalogs.", mutatesRemote: false, json: true },
  { name: "status", summary: "Inspect local authentication status.", mutatesRemote: false, json: false },
  { name: "skill", summary: "Print the packaged progrok skill.", mutatesRemote: false, json: true },
  { name: "capabilities", summary: "Print commands, endpoints, and live catalog metadata.", mutatesRemote: false, json: true },
  { name: "search", summary: "Search the web and X through Responses.", mutatesRemote: true, json: true },
  { name: "video", summary: "Generate, edit, or extend video.", mutatesRemote: true, json: true },
  { name: "image", summary: "Generate or edit images.", mutatesRemote: true, json: true },
  { name: "billing", summary: "Read subscription billing and usage.", mutatesRemote: false, json: true },
  { name: "tts", summary: "Synthesize speech to a file or stdout.", mutatesRemote: true, json: true },
  { name: "stt", summary: "Transcribe an audio file.", mutatesRemote: true, json: true },
  { name: "live", summary: "Bridge Realtime events over NDJSON stdin/stdout.", mutatesRemote: true, json: true },
] as const;
```

`mutatesRemote`는 비용 발생·원격 생성/검색을 포함한다. 로컬 파일 생성 여부와 혼동하지 않는다.

### `src/commands/command-registry.ts`

```ts
import type { Command } from "commander";
import type { CommandName } from "./command-manifest.js";
import { loginCommand } from "./login.js";
import { logoutCommand } from "./logout.js";
import { proxyCommand } from "./proxy.js";
import { chatCommand } from "./chat.js";
import { modelsCommand } from "./models.js";
import { statusCommand } from "./status.js";
import { skillCommand } from "./skill.js";
import { capabilitiesCommand } from "./capabilities.js";
import { searchCommand } from "./search.js";
import { videoCommand } from "./video.js";
import { imageCommand } from "./image.js";
import { billingCommand } from "./billing.js";
import { ttsCommand } from "./tts.js";
import { sttCommand } from "./stt.js";
import { liveCommand } from "./live.js";

export type CommandFactory = () => Command;

export const COMMAND_FACTORIES = {
  login: loginCommand,
  logout: logoutCommand,
  proxy: proxyCommand,
  chat: chatCommand,
  models: modelsCommand,
  status: statusCommand,
  skill: skillCommand,
  capabilities: capabilitiesCommand,
  search: searchCommand,
  video: videoCommand,
  image: imageCommand,
  billing: billingCommand,
  tts: ttsCommand,
  stt: sttCommand,
  live: liveCommand,
} satisfies Record<CommandName, CommandFactory>;

export const REAL_COMMANDS = new Set<CommandName>(
  Object.keys(COMMAND_FACTORIES) as CommandName[],
);

export function isCommandName(value: string): value is CommandName {
  return REAL_COMMANDS.has(value as CommandName);
}

export function createRegisteredCommands(): Command[] {
  return Object.values(COMMAND_FACTORIES).map((factory) => factory());
}
```

## NEW — Voice 명령

wp12는 wp9/wp10이 이미 소유한 factory 계약을 그대로 사용한다.

```ts
// src/voice/tts.ts
export function createTtsClient(options?: VoiceClientOptions): TtsClient;
// TtsClient.synthesize(request: TtsRequest, signal?: AbortSignal): Promise<TtsResult>
// src/voice/stt.ts
export function createSttClient(options?: VoiceClientOptions): SttClient;
// SttClient.transcribe(request: SttRequest, signal?: AbortSignal): Promise<SttResponse>
// src/voice/realtime.ts
export function createRealtimeClient(
  options: CreateRealtimeClientOptions,
  deps?: VoiceWsDeps,
): Promise<RealtimeClient>;
```

### `src/commands/tts.ts`

```ts
import { Command } from "commander";
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { createTtsClient } from "../voice/tts.js";
import { log } from "../utils/logger.js";

const DEFAULT_TTS_VOICE = "eve";

export interface TtsCliOptions {
  voice?: string;
  language?: string;
  format?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  output?: string;
  stdout?: boolean;
  json?: boolean;
}

export function ttsCommand(): Command {
  return new Command("tts")
    .description("Synthesize speech with xAI TTS")
    .argument("<text>", "text to synthesize")
    .option("--voice <id>", "voice ID", DEFAULT_TTS_VOICE)
    .option("--language <code>", "BCP-47 language or auto", "auto")
    .option("--format <format>", "mp3|wav|pcm|mulaw|alaw", "mp3")
    .option("-o, --output <path>", "output audio path")
    .option("--stdout", "write raw audio bytes to stdout")
    .option("--json", "write result metadata as JSON")
    .action(async (text: string, opts: TtsCliOptions) => {
      try {
        if (opts.stdout && (opts.output || opts.json)) {
          throw new Error("--stdout cannot be combined with --output or --json");
        }
        const result = await createTtsClient().synthesize({
          voice_id: opts.voice ?? DEFAULT_TTS_VOICE,
          language: opts.language ?? "auto",
          text,
          output_format: { codec: opts.format ?? "mp3" },
        });
        const bytes = result.kind === "audio"
          ? result.bytes
          : new Uint8Array(Buffer.from(result.value.audio, "base64"));
        const contentType = result.kind === "audio"
          ? result.contentType
          : result.value.content_type;
        if (opts.stdout) {
          process.stdout.write(bytes);
          return;
        }
        const path = opts.output ?? `progrok-tts.${opts.format ?? "mp3"}`;
        writeFileSync(path, bytes);
        if (opts.json) {
          console.log(JSON.stringify({
            path,
            bytes: bytes.byteLength,
            contentType,
            kind: result.kind,
            ...(result.kind === "json" ? { duration: result.value.duration } : {}),
          }, null, 2));
        } else {
          log.success(`Audio saved: ${path}`);
        }
      } catch (error) {
        log.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
```

`TtsRequest`에는 `model`이 없으므로 CLI에도 `--model`을 만들지 않는다. `output_format`은 문자열이 아니라 객체라는 라이브 근거(`001_endpoint_inventory.md:92`)를 유지한다. `TtsResult.kind === "audio"`이면 `bytes/contentType`, `kind === "json"`이면 base64 `value.audio`와 `value.content_type`을 사용한다. binary stdout에서는 로그를 stdout에 섞지 않는다.

### `src/commands/stt.ts`

```ts
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createSttClient } from "../voice/stt.js";
import { collectRefs } from "../utils/collect-refs.js";
import { log } from "../utils/logger.js";

export interface SttCliOptions {
  language?: string;
  diarize?: boolean;
  multichannel?: boolean;
  keyterm?: string[];
  json?: boolean;
}

export function sttCommand(): Command {
  return new Command("stt")
    .description("Transcribe an audio file with xAI STT")
    .argument("<file>", "audio file path")
    .option("--language <code>", "BCP-47 language hint")
    .option("--diarize", "enable speaker diarization")
    .option("--multichannel", "transcribe channels separately")
    .option("--keyterm <term>", "key term hint (repeatable)", collectRefs, [])
    .option("--json", "output the full structured transcript")
    .action(async (file: string, opts: SttCliOptions) => {
      try {
        const result = await createSttClient().transcribe({
          file: new Blob([new Uint8Array(readFileSync(file))]),
          filename: basename(file),
          language: opts.language,
          diarize: opts.diarize,
          multichannel: opts.multichannel,
          keyterm: opts.keyterm ?? [],
        });
        if (opts.json) console.log(JSON.stringify(result, null, 2));
        else console.log(result.text);
      } catch (error) {
        log.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
```

wp9 `SttRequest`에도 `model` 필드가 없으므로 STT CLI에 `--model`을 만들지 않는다. wp9 client가 multipart를 만들 때 `file` part를 마지막에 append한다. CLI는 multipart 세부사항을 알지 않는다.

### `src/commands/live.ts`

```ts
import { Command } from "commander";
import { createInterface } from "node:readline";
import {
  createRealtimeClient,
  type RealtimeClient,
  type RealtimeClientEvent,
  type RealtimeReasoningEffort,
  type RealtimeVoiceModel,
} from "../voice/realtime.js";
import { log } from "../utils/logger.js";
import { DEFAULT_LIVE_MODEL } from "./command-manifest.js";

export interface LiveCliOptions {
  model?: RealtimeVoiceModel;
  conversationId?: string;
  reasoning?: RealtimeReasoningEffort;
  event?: string[];
  stdin?: boolean;
  once?: boolean;
}

function collectEvent(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

type LiveClientEvent = Exclude<RealtimeClientEvent, { type: "pong" }>;

function parseRealtimeModel(value: string): RealtimeVoiceModel {
  if (value !== "grok-voice-think-fast-2.0" && value !== "grok-voice-latest") {
    throw new Error("--model must be grok-voice-think-fast-2.0 or grok-voice-latest");
  }
  return value;
}

function parseReasoningEffort(value: string): RealtimeReasoningEffort {
  if (value !== "high" && value !== "none") throw new Error("--reasoning must be high or none");
  return value;
}

function parseClientEvent(line: string): LiveClientEvent {
  const wire: unknown = JSON.parse(line);
  if (wire === null || typeof wire !== "object" || Array.isArray(wire)) throw new Error("live event must be a JSON object");
  const type = (wire as { type?: unknown }).type;
  if (typeof type !== "string" || type.length === 0) throw new Error("live event.type is required");
  if (type === "pong") throw new Error("pong is managed automatically by the realtime client");
  return wire as LiveClientEvent;
}

function sendClientEvent(client: RealtimeClient, event: LiveClientEvent): void {
  switch (event.type) {
    case "session.update": client.updateSession(event.session); return;
    case "input_audio_buffer.append": client.appendAudioBase64(event.audio); return;
    case "input_audio_buffer.commit": client.commitAudio(); return;
    case "input_audio_buffer.clear": client.clearAudio(); return;
    case "conversation.item.create": client.createItem(event.item, event.previous_item_id); return;
    case "conversation.item.delete": client.deleteItem(event.item_id); return;
    case "conversation.item.truncate": client.truncateItem(event.item_id, event.content_index, event.audio_end_ms); return;
    case "response.create": client.createResponse(event.response); return;
    case "response.cancel": client.cancelResponse(event.response_id); return;
  }
}

export function liveCommand(): Command {
  return new Command("live")
    .description("Bridge xAI Realtime events over NDJSON stdin/stdout (no microphone capture)")
    .option("--model <id>", "pinned Voice model or latest alias", parseRealtimeModel, DEFAULT_LIVE_MODEL)
    .option("--conversation-id <id>", "resume an existing conversation")
    .option("--reasoning <effort>", "high|none", parseReasoningEffort)
    .option("--event <json>", "send one client event (repeatable)", collectEvent, [])
    .option("--no-stdin", "do not read additional NDJSON events from stdin")
    .option("--once", "exit after the first response.done or error")
    .action(async (opts: LiveCliOptions) => {
      const stop = new AbortController();
      process.once("SIGINT", () => stop.abort());
      let session: RealtimeClient | undefined;

      try {
        session = await createRealtimeClient({
          auth: { kind: "oauth" },
          model: opts.model ?? DEFAULT_LIVE_MODEL,
          conversationId: opts.conversationId,
          reasoningEffort: opts.reasoning,
          signal: stop.signal,
        });
        for (const encoded of opts.event ?? []) sendClientEvent(session, parseClientEvent(encoded));
        if (opts.stdin !== false) {
          const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
          void (async () => {
            for await (const line of lines) {
              if (line.trim()) sendClientEvent(session!, parseClientEvent(line));
            }
          })().catch((error) => stop.abort(error));
        }
        for await (const event of session.events()) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          if (opts.once && (event.type === "response.done" || event.type === "error")) break;
        }
      } catch (error) {
        log.error((error as Error).message); // logger must use stderr in this command
        process.exitCode = 1;
      } finally {
        session?.close();
      }
    });
}
```

`RealtimeClient`에는 generic `send()`, signal을 받는 `events(options)`, async `close()`가 없다. NDJSON 입력은 위 dispatcher가 wp10의 semantic method로 변환하고, abort signal은 `createRealtimeClient` options에 한 번 전달하며, `events()`와 `close()`는 각각 인자 없이 호출한다. `pong`은 wp10 client가 수신 `ping`에 자동 응답하므로 CLI 입력으로 받지 않는다.

`grok-voice-think-fast-2.0`은 catalog snapshot이 아니라 의도적으로 핀한 CLI 기본값이다. `grok-voice-latest`를 기본으로 쓰지 않는다. capabilities에서는 이 값을 `recommendations.liveDefaultModel`로 표시하되 “사용 가능한 모델 목록”에 합성하지 않는다.

## MODIFY — `src/index.ts`

### import, 등록, star prompt 대상

before (`src/index.ts:1-15`, `:50-66`):

```ts
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
// ... 10개 command import ...
import { billingCommand } from "./commands/billing.js";

program.addCommand(loginCommand());
program.addCommand(logoutCommand());
// ... 10개 addCommand ...
program.addCommand(billingCommand());

const REAL_COMMANDS = new Set(["login", "logout", "proxy", "chat", "models", "status", "skill", "capabilities", "search", "video", "image", "billing"]);
const subcommand = process.argv[2];
if (subcommand && REAL_COMMANDS.has(subcommand)) {
  await showStarPrompt();
}
```

after:

```ts
import { Command } from "commander";
import { createRegisteredCommands, isCommandName } from "./commands/command-registry.js";
import { showStarPrompt } from "./utils/star-prompt.js";
import { readPackageVersion } from "./utils/version.js";

for (const command of createRegisteredCommands()) {
  program.addCommand(command);
}

const subcommand = process.argv[2];
if (subcommand && isCommandName(subcommand)) {
  await showStarPrompt();
}
```

### help 본문

before (`src/index.ts:25-46`)는 “All xAI endpoints forwarded”와 REST 예시만 있다. after에는 기존 문장을 유지하면서 Voice CLI를 추가한다.

```ts
`Activate your xAI OAuth session as a local Grok API proxy and CLI tool surface.

  SuperGrok OAuth → native xAI clients + local OpenAI-compatible proxy.

  Quick start:
    $ progrok login
    $ progrok proxy
    $ progrok tts "Hello" --output hello.mp3
    $ progrok stt meeting.wav --json
    $ progrok live --event '{"type":"session.update","session":{}}' --once

  The proxy keeps forwarding every HTTP /v1/* path. WebSocket commands connect
  directly to api.x.ai and never expose your OAuth token through the local proxy.`
```

`proxy`의 `/v1/*` 계약을 “typed client만 지원”으로 축소하는 문구는 금지한다.

## MODIFY — `src/commands/capabilities.ts`

### endpoint와 command 목록의 owner 교체

before (`src/commands/capabilities.ts:12-15`):

```ts
// Endpoint surface mirrors the xAI REST API (https://docs.x.ai). Every HTTP
// /v1/* path is forwarded by the proxy verbatim. WebSocket (wss) endpoints and
// the management-api.x.ai host are NOT proxied — see `limitations`.
const ENDPOINTS = [
```

after:

```ts
import {
  AUTH_FILE,
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
  PROXY_DEFAULT_PORT,
  XAI_API_BASE_URL,
} from "../auth/constants.js";
import { COMMAND_MANIFEST, DEFAULT_LIVE_MODEL } from "./command-manifest.js";
import { SURFACE_REGISTRY } from "../surfaces/registry.js";
import { ModelsClient, type ModelFamily, type XaiModel } from "../surfaces/models.js";
import { createXaiTransport } from "../transport/fetch.js";
```

`ENDPOINTS`와 `WEBSOCKET_ENDPOINTS` 수동 배열(`:15-80`)은 삭제하고 `SURFACE_REGISTRY`에서 projection한다. `VIDEO_SURFACES`의 live-smoke 기록은 endpoint registry가 아니므로 그대로 둘 수 있지만 `models`나 endpoint 목록을 중복하지 않게 별도 `videoNotes` 키로 이름을 바꾼다.

### 정적 모델 스냅샷 제거

before (`src/commands/capabilities.ts:209-355`)는 다음 형태의 하드코딩을 11개 모델과 3개 Voice 모델에 반복한다.

```ts
models: [
  {
    id: "grok-4.3",
    type: "reasoning",
    use: "Flagship — chat, agentic tool calling, search, vision",
    // 가격·별칭·도구 정적 스냅샷
  },
  // ...
],
voiceModels: [
  { id: "grok-voice-latest", use: "Voice Agent / realtime — recommended" },
  { id: "grok-voice-fast-1.0", use: "Lower-latency voice agent" },
  { id: "grok-voice-think-fast-1.0", use: "Reasoning-capable voice agent" },
],
```

after의 모델 loader:

```ts
const MODEL_FAMILIES = [
  "models",
  "language-models",
  "image-generation-models",
  "video-generation-models",
  "embedding-models",
] as const satisfies readonly ModelFamily[];

export interface CatalogSnapshot {
  status: "live" | "partial" | "offline" | "unavailable";
  fetchedAt: string | null;
  families: Partial<Record<ModelFamily, XaiModel[]>>;
  errors: Partial<Record<ModelFamily, string>>;
}

export async function loadCatalogSnapshot(options: {
  offline?: boolean;
  client?: ModelsClient;
} = {}): Promise<CatalogSnapshot> {
  if (options.offline) return { status: "offline", fetchedAt: null, families: {}, errors: {} };
  try {
    const client = options.client ?? new ModelsClient(createXaiTransport({ timeoutMs: 5_000 }));
    const settled = await Promise.allSettled(MODEL_FAMILIES.map((family) => client.list(family)));
    const families: CatalogSnapshot["families"] = {};
    const errors: CatalogSnapshot["errors"] = {};
    settled.forEach((result, index) => {
      const family = MODEL_FAMILIES[index];
      if (result.status === "fulfilled") families[family] = result.value;
      else errors[family] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    });
    const successes = Object.keys(families).length;
    return {
      status: successes === MODEL_FAMILIES.length ? "live" : successes > 0 ? "partial" : "unavailable",
      fetchedAt: new Date().toISOString(),
      families,
      errors,
    };
  } catch (error) {
    return {
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      families: {},
      errors: { models: error instanceof Error ? error.message : String(error) },
    };
  }
}
```

### `buildCapabilities`와 command action

before (`src/commands/capabilities.ts:172-208`, `:443-454`):

```ts
export function buildCapabilities() {
  return {
    ok: true,
    // ...
    commands: ["login", "logout", /* 수동 목록 */],
    endpoints: ENDPOINTS,
    websocketEndpoints: WEBSOCKET_ENDPOINTS,
```

```ts
.action((opts: { json?: boolean }) => {
  const cap = buildCapabilities();
  if (opts.json) console.log(JSON.stringify(cap, null, 2));
  else printText(cap);
});
```

after:

```ts
export async function buildCapabilities(options: { offline?: boolean; client?: ModelsClient } = {}) {
  const modelCatalog = await loadCatalogSnapshot(options);
  const models = modelCatalog.families.models ?? [];
  const voiceModels = models.filter((model) => /(^|-)voice(-|$)|(^|-)tts(-|$)|(^|-)stt(-|$)/.test(model.id));
  const websockets = SURFACE_REGISTRY
    .filter((surface) => surface.transport === "websocket")
    .map((surface) => {
      const url = new URL(surface.path);
      return {
        path: url.pathname,
        url: surface.path,
        family: surface.family,
        evidence: surface.evidence,
        proxied: false as const,
      };
    });
  return {
    schemaVersion: 2,
    ok: true,
    name: "progrok",
    version: readPackageVersion(),
    source: "local",
    upstream: XAI_API_BASE_URL,
    commands: COMMAND_MANIFEST,
    auth: {
      kind: "oauth" as const,
      file: AUTH_FILE,
      inboundAuthorization: "ignored-and-replaced-with-stored-oauth" as const,
    },
    proxy: {
      host: PROXY_DEFAULT_HOST,
      port: PROXY_DEFAULT_PORT,
      baseUrl: `http://${PROXY_DEFAULT_HOST}:${PROXY_DEFAULT_PORT}/v1`,
      forwarding: "all HTTP /v1/* paths — no whitelist",
    },
    webApp: {
      host: PROXY_DEFAULT_HOST,
      port: CHAT_DEFAULT_PORT,
      url: `http://${PROXY_DEFAULT_HOST}:${CHAT_DEFAULT_PORT}`,
    },
    endpoints: SURFACE_REGISTRY,
    websockets,
    modelCatalog,
    models,
    voiceModels,
    recommendations: {
      liveDefaultModel: DEFAULT_LIVE_MODEL,
      note: "Pinned operational default; not synthesized into the live catalog.",
    },
    limitations: [
      "The local proxy handles HTTP only; live and Responses WebSocket clients connect directly to api.x.ai.",
      "Collection management requires management-api.x.ai and a Management API key; progrok exposes only collection search.",
    ],
  };
}

export function capabilitiesCommand(): Command {
  return new Command("capabilities")
    .description("Print agent-friendly capability metadata.")
    .option("--json", "Output as JSON")
    .option("--offline", "Skip live model catalog requests")
    .action(async (opts: { json?: boolean; offline?: boolean }) => {
      const cap = await buildCapabilities({ offline: opts.offline });
      if (opts.json) console.log(JSON.stringify(cap, null, 2));
      else printText(cap);
    });
}
```

`printText`는 `cap.commands`가 문자열이 아니라 manifest entry이므로 `entry.name`을 출력하고, catalog 상태와 family별 개수를 출력한다. 오류 메시지는 token이나 응답 본문 전체를 포함하지 않는다.

`auth`, `websockets`, `webApp`은 wp14가 읽는 실제 schema field다. `websockets`는 별도 수동 endpoint 배열이 아니라 `SURFACE_REGISTRY`의 `transport === "websocket"` projection이며 path는 URL의 pathname이다. `webApp`은 기존 chat server의 이름만 metadata에서 명확히 한 것으로 port를 바꾸지 않는다. `buildCapabilities`는 async이므로 wp14 consumer는 `await buildCapabilities({ offline: true })`로 이 필드들을 읽는다.

## MODIFY — `src/commands/models.ts`

before (`src/commands/models.ts:40-70`):

```ts
const bearer = await getValidBearer();
if (opts.detail) {
  const res = await fetch(`${XAI_API_BASE_URL}/language-models`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  // 직접 cast
}
const res = await fetch(`${XAI_API_BASE_URL}/models`, {
  headers: { Authorization: `Bearer ${bearer}` },
});
```

after:

```ts
import { ModelsClient, type ModelFamily } from "../surfaces/models.js";
import { createXaiTransport } from "../transport/fetch.js";

const MODEL_KIND = {
  all: "models",
  language: "language-models",
  image: "image-generation-models",
  video: "video-generation-models",
  embedding: "embedding-models",
} as const satisfies Record<string, ModelFamily>;

// command options
.option("--detail", "Show the detailed language-model catalog (preserved)")
.option("--kind <kind>", "all|language|image|video|embedding", "all")
.option("--json", "Output the live catalog as JSON")

// action core
const kind = opts.detail ? "language" : opts.kind ?? "all";
const family = MODEL_KIND[kind as keyof typeof MODEL_KIND];
if (!family) throw new Error(`invalid --kind '${kind}'`);
const models = await new ModelsClient(createXaiTransport()).list(family);
if (opts.json) console.log(JSON.stringify({ source: `GET /v1/${family}`, models }, null, 2));
else for (const model of models) console.log(`  ${model.id}`);
```

기존 `--detail`은 그대로 `language-models`를 조회한다. `MODEL_TAGS`는 display hint일 뿐 catalog SSOT가 아니므로 유지해도 되지만 unknown 모델을 누락시키지 않는다.

## MODIFY — `src/commands/image.ts`

before (`src/commands/image.ts:70-87`):

```ts
const res = await fetch(`${XAI_API_BASE_URL}/${endpoint}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
if (!res.ok) {
  const errBody = await res.text();
  throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
}
const data = (await res.json()) as { /* ... */ };
```

after:

```ts
import { ImagesClient, type ImageRequest } from "../surfaces/images.js";
import { createXaiTransport } from "../transport/fetch.js";

const request: ImageRequest = {
  model: opts.model ?? DEFAULT_IMAGE_MODEL,
  prompt,
  n,
  response_format: "b64_json",
  aspect_ratio: opts.aspect ?? "1:1",
  resolution: opts.resolution ?? "1k",
  ...(body.image !== undefined ? { image: body.image } : {}),
  ...(Array.isArray(body.images) ? { images: body.images } : {}),
};
const data = await new ImagesClient(createXaiTransport()).create(request);
```

`getValidBearer`, `XAI_API_BASE_URL`, `endpoint` 직접 조립 import/변수를 제거한다. 파일 저장, `--json`, 비용 표시, reference 변환은 현재 `image.ts:89-113`을 유지한다.

## MODIFY — `src/commands/video.ts`

before:

- `src/commands/video.ts:51-83`의 `pollUntilDone()`이 직접 GET한다.
- `:197-205`, `:242-250`, `:286-294`가 operation별 POST를 반복한다.

대표 before (`:197-205`):

```ts
const res = await fetch(`${XAI_API_BASE_URL}/videos/generations`, {
  method: "POST",
  headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const { request_id } = (await res.json()) as { request_id: string };
```

after:

```ts
import { VideosClient, type VideoOperation, type VideoPollResponse } from "../surfaces/videos.js";
import { createXaiTransport } from "../transport/fetch.js";

const client = new VideosClient(createXaiTransport());
const { requestId } = await client.start("generations", body);
const data = await pollUntilDone(client, requestId, timeout, opts.json);
```

`pollUntilDone` after:

```ts
async function pollUntilDone(
  client: VideosClient,
  requestId: string,
  timeout: number,
  json?: boolean,
): Promise<VideoPollResponse> {
  const deadline = Date.now() + timeout;
  let lastProgress = -1;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    const data = await client.poll(requestId);
    if (data.status === "done") return data;
    if (data.status === "failed") throw new Error(`Generation failed: ${JSON.stringify(data.error ?? "unknown")}`);
    if (data.status === "expired") throw new Error("Generation expired");
    if (!json && typeof data.progress === "number" && data.progress !== lastProgress) {
      lastProgress = data.progress;
      process.stdout.write(`\r  Progress: ${Math.round(lastProgress * 100)}%`);
    }
  }
  throw new Error(`Timeout after ${timeout / 1000}s — video still pending`);
}
```

edit는 `client.start("edits", body)`, extend는 `client.start("extensions", body)`를 사용한다. download URL fetch는 xAI bearer를 보내지 않는 별도 asset fetch이므로 현재 `downloadAndSave()`를 유지한다.

## MODIFY/NEW — 테스트

### `tests/cli-skill-contract.test.ts:49-56`

before:

```ts
it("top-level CLI registers both skill and capabilities", () => {
  const src = readSource("src/index.ts");
  assert.match(src, /skillCommand/);
  assert.match(src, /capabilitiesCommand/);
  assert.match(src, /"skill"/);
  assert.match(src, /"capabilities"/);
});
```

after:

```ts
import { COMMAND_MANIFEST, COMMAND_NAMES } from "../src/commands/command-manifest.js";
import { COMMAND_FACTORIES, createRegisteredCommands } from "../src/commands/command-registry.js";

it("keeps manifest, factories, and Commander registration in exact parity", () => {
  assert.deepEqual(Object.keys(COMMAND_FACTORIES), [...COMMAND_NAMES]);
  assert.deepEqual(COMMAND_MANIFEST.map((entry) => entry.name), [...COMMAND_NAMES]);
  assert.deepEqual(createRegisteredCommands().map((command) => command.name()), [...COMMAND_NAMES]);
});

it("includes the voice commands", () => {
  assert(COMMAND_NAMES.includes("tts"));
  assert(COMMAND_NAMES.includes("stt"));
  assert(COMMAND_NAMES.includes("live"));
});
```

기존 packaged skill 내용 검사는 wp15 전까지 유지한다. wp12가 아직 skill 문서를 고치지 않았다는 이유로 Voice 문자열을 요구하지 않는다.

### `tests/voice-cli.test.ts`

- `ttsCommand().name()`, 기본 voice/format, `--model` 부재, `--stdout` 충돌 검증.
- TTS mock의 `kind:"audio"`와 `kind:"json"` 각각이 파일에 정확한 bytes로 기록되고 `--json` stdout은 JSON 하나뿐인지 검증.
- `sttCommand()`의 `--model` 부재와 language/diarize/multichannel/repeatable keyterm mapping 검증.
- 존재하지 않는 STT 파일은 upstream을 부르기 전에 실패한다.
- `liveCommand()` 기본 모델이 정확히 `grok-voice-think-fast-2.0`인지 검증.
- NDJSON 각 event가 `RealtimeClient`의 대응 semantic method로 정확히 한 번 전달되고 server event가 한 줄 JSON으로 출력되는지 검증.
- `createRealtimeClient`에 `{auth:{kind:"oauth"}, signal}`이 전달되고 `events()`/`close()`를 인자 없이 호출하는지 검증.
- malformed JSON, object가 아닌 JSON, type 없는 event를 각각 거절한다.
- `--once`가 `response.done`/`error`에서 세션을 닫고 끝나는지 검증.
- bearer/token 문자열이 stdout/stderr에 나타나지 않는지 검증.

### `tests/capabilities.test.ts`

- `--offline`은 auth/fetch를 호출하지 않고 `status:"offline"`, 빈 live arrays를 반환한다.
- 전 family 성공은 `status:"live"`; 일부 실패는 `partial`; 전부 실패는 `unavailable`이다.
- JSON에는 `schemaVersion:2`, `fetchedAt`, family별 source 결과가 있다.
- `grok-voice-fast-1.0`과 `grok-voice-think-fast-1.0`이 소스 literal이나 합성 fallback으로 존재하지 않는다.
- `recommendations.liveDefaultModel`은 `grok-voice-think-fast-2.0`이지만 `models` 배열에 upstream 근거 없이 삽입되지 않는다.
- endpoint 목록은 `SURFACE_REGISTRY`, command 목록은 `COMMAND_MANIFEST`와 deep-equal이다.
- `auth.file === AUTH_FILE`, `websockets` path가 realtime/responses/stt/tts 네 개, `webApp.url === "http://127.0.0.1:18646"`이다.
- JSON mode에서 refresh/logging 텍스트가 stdout JSON 앞뒤에 섞이지 않는다.

## capabilities JSON 마이그레이션

`progrok capabilities --json`은 공개된 기계 소비 표면이다. 아래 변경은 progrok **3.0.0**에서만 내보내며, 기존 소비자가 그대로 동작한다고 주장하지 않는다. `schemaVersion: 2`는 capabilities 문서 schema의 버전이고 package major `3.0.0`과 별개다.

### v1에서 v2로

| v1 | v2 | 소비자 조치 |
|---|---|---|
| schema version 없음 | `schemaVersion: 2` | 먼저 version을 분기한다. |
| `commands: string[]` | `commands: CommandManifestEntry[]` | 이름은 `entry.name`에서 읽는다. |
| 정적 `endpoints`/`websocketEndpoints` | 근거가 있는 통합 `endpoints` | `transport`와 `evidence`를 사용한다. |
| 정적 `models` | live `/v1/models` 결과 | `modelCatalog.status`가 `live|partial`인지 먼저 확인한다. |
| 정적 `voiceModels` 1.0 목록 | live catalog에서 식별된 항목만 | 빈 배열을 “지원 안 함”으로 해석하지 않는다. |
| 없음 | `recommendations.liveDefaultModel` | catalog와 운영 기본값을 구분한다. |
| `chat` 또는 필드 없음 | `webApp` | 로컬 웹앱 URL은 `webApp.url`에서 읽는다. |
| `websocketEndpoints` | `websockets` | 각 항목의 `path`, `url`, `proxied:false`를 읽는다. |
| 필드 없음 | `auth` | credential 경로는 `auth.file`, inbound 처리 정책은 `auth.inboundAuthorization`에서 읽는다. |

3.0.0에서 `--legacy-json`, 이중 `commands` 필드, string-array shim을 제공하지 않는다. stale 모델을 다시 내보내는 호환 모드도 만들지 않는다. 대신 package major와 `schemaVersion: 2`를 명시하고 이 migration table을 wp15의 docs/skill에 복사한다. endpoint/command만 필요한 소비자는 `--offline`을 쓴다.

## 나머지 공개 계약

- `~/.progrok/auth.json`: wp12는 직접 쓰지 않는다. wp5 API만 사용하며 필드와 경로가 동일하다.
- 기존 CLI 명령: 이름과 기존 옵션의 의미를 유지한다. `models --detail`, image/video option, proxy/chat port는 그대로다.
- exit behavior: 새 명령은 action 내부에서 `process.exit()`를 호출하지 않고 `process.exitCode = 1`을 쓴다. 테스트와 finally cleanup을 보장한다. 기존 명령의 즉시 exit는 이 단계에서 전면 리팩터링하지 않는다.
- `/health`: 변경 없음.
- `/v1/*`: proxy는 계속 무제한 HTTP relay다. capabilities registry가 proxy whitelist가 아니다.
- WebSocket: `live`는 xAI에 직접 연결한다. 로컬 proxy URL로 WS upgrade를 보내지 않는다.
- binary stdout: `tts --stdout`만 raw bytes를 stdout에 쓰며 모든 상태/오류는 stderr로 보낸다.

## 구현 순서와 검증

1. manifest/registry와 parity test를 추가하고 `src/index.ts`를 전환한다.
2. tts/stt/live command와 단위 테스트를 추가한다.
3. models/image/video를 wp11 클라이언트로 전환한다.
4. capabilities를 registry + live catalog로 교체하고 migration test를 추가한다.
5. typecheck, 집중 테스트, build, 전체 테스트를 실행한다.

명령:

```bash
npm run typecheck
node --test-concurrency=1 --import tsx --experimental-test-module-mocks --test tests/cli-skill-contract.test.ts tests/voice-cli.test.ts tests/capabilities.test.ts tests/image.test.ts tests/video.test.ts
npm run build
node dist/index.js --help
node dist/index.js capabilities --offline --json
node dist/index.js models --help
node dist/index.js tts --help
node dist/index.js stt --help
node dist/index.js live --help
npm test
```

검증 시 다음 추가 assertion을 스크립트 또는 테스트로 실행한다.

```bash
node dist/index.js capabilities --offline --json | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const x=JSON.parse(s);
  if(x.schemaVersion!==2) process.exit(1);
  for(const n of ["login","logout","status","proxy","chat","models","search","image","video","billing","capabilities","skill","tts","stt","live"])
    if(!x.commands.some(c=>c.name===n)) process.exit(2);
});'
```

Voice live 호출, TTS 생성, STT 업로드는 비용·외부 상태가 있으므로 wp14 라이브 스모크에서 수행한다. wp12 완료를 주장할 때는 mock transport/voice session 증거와 CLI help/build 증거를 제시한다.

## 완료 조건

- 기존 12개 command가 모두 Commander에 등록되고 이름·기존 옵션이 유지된다.
- `tts`, `stt`, `live`가 등록되고 help가 빌드 산출물에서 보인다.
- command manifest, factory registry, capabilities command 목록이 정확히 일치한다.
- `capabilities --offline --json`은 인증 없이 유효한 schema v2 JSON 하나를 출력한다.
- 3.0.0의 capabilities는 객체형 `commands`, `auth`, `websockets`, `webApp`을 실제로 내보내며 legacy JSON shim은 없다.
- live catalog 실패가 명령 전체 실패나 stale fallback으로 바뀌지 않는다.
- `grok-voice-fast-1.0`, `grok-voice-think-fast-1.0` 정적 capability 항목이 제거됐다.
- pinned default `grok-voice-think-fast-2.0`은 recommendation/default로만 존재하며 live catalog인 척하지 않는다.
- models/image/video command가 direct xAI fetch와 bearer 조립을 더 이상 소유하지 않는다.
- `~/.progrok/auth.json`, `/health`, HTTP `/v1/*` relay 계약에 변화가 없다.
- typecheck, 집중 테스트, build, help smoke, 전체 테스트가 모두 exit 0이다.
