# Research Report: xAI Cookbook, Voice/Realtime API, and Developer Surfaces

**Date:** September 18, 2026  
**Sources:**
- xAI GitHub Organization: https://github.com/xai-org
- xAI Cookbook Repository: https://github.com/xai-org/xai-cookbook
- Grok Build Repository: https://github.com/xai-org/grok-build
- Grok Build Claude Code Plugin: https://github.com/xai-org/grok-build-plugin-cc
- xAI Python SDK: https://github.com/xai-org/xai-sdk-python
- xAI Protobuf Definitions: https://github.com/xai-org/xai-proto
- Grok CLI / Build Landing: https://x.ai/cli (https://x.ai/build)
- Grok CLI Install Script: https://x.ai/cli/install.sh
- xAI Speech-to-Speech API Docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
- xAI Ephemeral Tokens Guide: https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
- xAI Voice REST/WebSocket API Reference: https://docs.x.ai/developers/rest-api-reference/inference/voice
- xAI SIP Phone Calls Guide: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip

---

## 1. xAI GitHub Organization (`xai-org`) Repositories Overview

Querying the GitHub API (`https://api.github.com/orgs/xai-org/repos`) identifies the following 9 public repositories under `xai-org`:

1. **`xai-cookbook`** (https://github.com/xai-org/xai-cookbook)  
   *Description:* A collection of pragmatic, real-world examples guiding developers from basic to advanced use of xAI's Grok APIs. Contains complete production examples for Realtime Voice across Web (WebSocket and WebRTC), Telephony (Twilio SIP / Media Streams), iOS (`VoiceTesterApp`), and Android (`VoiceApiAndroidExample`).
2. **`grok-build`** (https://github.com/xai-org/grok-build)  
   *Description:* SpaceXAI's coding agent harness and full-screen TUI (built in Rust). Powers the official `grok` CLI. Features interactive plan mode, subagents, skills, hooks, MCP server integration, sandboxed terminal execution, and Agent Client Protocol (ACP) support.
3. **`grok-build-plugin-cc`** (https://github.com/xai-org/grok-build-plugin-cc)  
   *Description:* Claude Code marketplace plugin that bridges Claude Code to the `grok` CLI for review, critique, task delegation, and session transfer.
4. **`xai-sdk-python`** (https://github.com/xai-org/xai-sdk-python)  
   *Description:* Official Python SDK for the xAI API (published on PyPI as `xai-sdk`). Built on gRPC and Protocol Buffers for chat completions, embeddings, vision, tokenize, collections/documents, batches, and files. *(Note: Does not contain realtime voice; realtime voice uses standard WebSockets or the OpenAI SDK).*
5. **`xai-proto`** (https://github.com/xai-org/xai-proto)  
   *Description:* Public protobuf definitions for xAI's gRPC APIs (`proto/xai/...`), covering models, billing, chat, image, video, documents, embed, tokenize, sample, usage, and files.
6. **`grok-1`** (https://github.com/xai-org/grok-1)  
   *Description:* Open release of the base Grok-1 314B parameter mixture-of-experts model checkpoint and architecture code.
7. **`grok-prompts`** (https://github.com/xai-org/grok-prompts)  
   *Description:* System prompts and behavioral guidelines for the Grok chat assistant and the `@grok` bot on X.
8. **`x-algorithm`** (https://github.com/xai-org/x-algorithm)  
   *Description:* Recommendation algorithm powering the "For You" feed on X (formerly Twitter).
9. **`plugin-marketplace`** (https://github.com/xai-org/plugin-marketplace)  
   *Description:* Official xAI plugin marketplace definitions and registry for Grok extensions.

---

## 2. WebSocket Connection Specifications

### 2.1 Endpoints and URLs
- **Speech-to-Speech (Realtime Voice Agent):**  
  `wss://api.x.ai/v1/realtime`
- **Streaming Text-to-Speech (TTS):**  
  `wss://api.x.ai/v1/tts`
- **Streaming Speech-to-Text (STT):**  
  `wss://api.x.ai/v1/stt`
- **Ephemeral Token Minting (REST):**  
  `POST https://api.x.ai/v1/realtime/client_secrets`

### 2.2 Query Parameters

#### Speech-to-Speech (`wss://api.x.ai/v1/realtime`)
- `model`: (optional, recommended) Voice model alias or versioned identifier.  
  - Default / alias: `grok-voice-latest` (points to `grok-voice-think-fast-2.0`).  
  - Pinned: `grok-voice-think-fast-2.0`.
- `conversation_id`: (optional) Conversation ID for session resumption. When reconnecting with a saved ID and sending `resumption.enabled: true`, the server replays past turns prior to new input.
- `call_id`: (optional) UUID representing an incoming SIP telephony call (retrieved from `realtime.call.incoming` webhook).

#### Streaming TTS (`wss://api.x.ai/v1/tts`)
- `voice`: Built-in voice (`eve`, `ara`, `leo`, `rex`, `sal`) or an 8-character custom voice ID (default: `eve`).
- `language`: Required BCP-47 language tag (e.g. `en`, `ja`, `es-MX`) or `auto`.
- `codec`: Output codec: `mp3` (default), `wav`, `pcm`, `mulaw`, `alaw`.
- `sample_rate`: Sample rate in Hz: `8000`, `16000`, `22050`, `24000` (default), `44100`, `48000`.
- `bit_rate`: Bitrate in bps for MP3: `32000` to `192000` (default `128000`).
- `optimize_streaming_latency`: `0` (default, standard quality) or `1` (smaller initial chunk for fast time-to-first-audio).
- `speed`: Playback rate multiplier: `0.7` to `1.5` (default: `1.0`).
- `text_normalization`: `true` | `false` (default: `false`). Converts written figures/dates into spoken words.
- `with_timestamps`: `true` | `false` (default: `false`). Returns character-level alignment timings.

#### Streaming STT (`wss://api.x.ai/v1/stt`)
- `encoding`: Input audio encoding: `pcm` (default, 16-bit little-endian), `mulaw` (G.711 μ-law), `alaw` (G.711 A-law), `opus` (raw Opus packets, 1 per WebSocket frame).
- `sample_rate`: `8000`, `16000` (default), `22050`, `24000`, `44100`, `48000`.
- `interim_results`: `true` | `false` (default `false`). Emits partial transcripts every ~500ms.
- `endpointing`: Silence duration before `speech_final=true` in ms (0–5000, default `400`).
- `language`: Language code for inverse text normalization.
- `multichannel`: `true` | `false` (default `false`). Requires `channels` ≥ 2.
- `channels`: Channel count: 2 to 8.
- `diarize`: `true` | `false` (default `false`). Identifies speakers per word.
- `keyterm`: Repeatable query param (e.g. `keyterm=Grok&keyterm=xAI`) for vocabulary biasing (max 100 terms).
- `filler_words`: `true` | `false` (default `false`).
- `smart_turn`: Confidence threshold `0.0` to `1.0` for semantic turn detection.
- `smart_turn_timeout`: Maximum silence before forcing `speech_final` (1–5000 ms).
- `vad_threshold`: Voice activity detection threshold `0.0` to `1.0` (default `0.08`).

### 2.3 Authentication and Subprotocol Headers

#### Server-side Authentication (Direct HTTP Header)
```http
Authorization: Bearer <XAI_API_KEY_OR_EPHEMERAL_TOKEN>
```
*Note:* Python `websockets`, Node.js `ws`, and Android `OkHttp` pass this directly in the initial HTTP Upgrade request headers.

#### Client-side / Browser Authentication (`Sec-WebSocket-Protocol`)
Standard browser `WebSocket` APIs and iOS `URLSessionWebSocketTask` cannot set arbitrary custom headers during the HTTP upgrade. xAI supports authentication via the WebSocket subprotocol header:

1. **Native xAI Subprotocol Header:**
   ```javascript
   const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [
     `xai-client-secret.${ephemeralToken}`
   ]);
   ```
   In Swift (`URLSessionWebSocketTask`):
   ```swift
   let task = session.webSocketTask(
       with: url,
       protocols: ["xai-client-secret.\(apiKey)"]
   )
   ```

2. **OpenAI Realtime Compatibility Subprotocol:**
   ```javascript
   const ws = new WebSocket("wss://api.x.ai/v1/realtime", [
     "realtime",
     `openai-insecure-api-key.${ephemeralToken}`,
     "openai-beta.realtime-v1"
   ]);
   ```

### 2.4 Ephemeral Token Request Flow
Clients request an ephemeral secret from their own backend server, which calls:
```bash
curl -X POST "https://api.x.ai/v1/realtime/client_secrets" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expires_after": {"seconds": 300}}'
```
Response:
```json
{
  "value": "xai-realtime-client-secret-...",
  "expires_at": 1774274445
}
```

---

## 3. Client and Server Event Names

### 3.1 Client → Server Events
- `session.update`: Configures system prompt, voice, audio format, turn detection, and tools.
- `input_audio_buffer.append`: Streams chunks of base64-encoded audio (when transport is JSON).
- `input_audio_buffer.commit`: Manually commits the audio buffer as a user turn (when `turn_detection` is `null`).
- `input_audio_buffer.clear`: Discards uncommitted audio in the input buffer.
- `conversation.item.create`: Appends an item to conversation context:
  - `item.type: "message"` (role: `user` or `assistant`, content type `input_text` or `input_audio`)
  - `item.type: "function_call_output"` (contains `call_id` and JSON `output`)
  - `item.type: "force_message"` (xAI extension: TTS speaks a verbatim script without LLM generation)
- `conversation.item.delete`: Deletes a prior item by `item_id`.
- `conversation.item.truncate`: Truncates an assistant audio item to a specified duration in milliseconds.
- `response.create`: Requests generation of an assistant response (can include single-turn override `instructions`).
- `response.cancel`: Cancels an active in-flight response generation.
- **Raw Binary Frames:** If `audio.input.transport` is set to `"binary"`, audio is sent as raw binary WebSocket frames (PCM16 or Opus) without JSON envelopes.
- **Streaming TTS Events:** `text.delta`, `text.done`.
- **Streaming STT Events:** Binary audio frames, `finalize`, `audio.done`.

### 3.2 Server → Client Events
- **Session Lifecycle:**
  - `session.created`: Server echoes initial session parameters upon connection.
  - `session.updated`: Confirms application of a `session.update`.
- **Conversation & Context:**
  - `conversation.created`: Provides `conversation.id` on connection.
  - `conversation.item.created` / `conversation.item.added`: Confirms an item was appended or replayed during resumption.
  - `conversation.item.deleted`: Confirms deletion.
  - `conversation.item.truncated`: Confirms truncation.
- **Audio Input & Speech Detection:**
  - `input_audio_buffer.speech_started`: Fired when server VAD detects user speech.
  - `input_audio_buffer.speech_stopped`: Fired when server VAD detects end of user speech.
  - `input_audio_buffer.committed`: Confirms buffer commitment.
  - `input_audio_buffer.cleared`: Confirms buffer clearing.
  - `input_audio_buffer.timeout_triggered`: Fired when `turn_detection.idle_timeout_ms` expires, causing proactive model check-in.
  - `input_audio_buffer.dtmf_event_received`: Fired on SIP phone calls when caller presses a numeric DTMF digit.
  - `conversation.item.input_audio_transcription.updated`: Live cumulative ASR transcript deltas/corrections (when model is `grok-transcribe`).
  - `conversation.item.input_audio_transcription.completed`: Final user speech transcript.
- **Response Lifecycle & Audio Generation:**
  - `response.created`: Signals beginning of a response turn (`response_id`).
  - `response.output_item.added`: Signals start of a response item.
  - `response.content_part.added` / `response.content_part.done`: Lifecycle of parts within an output item.
  - `response.output_audio.delta`: Streaming base64 audio chunk (or raw binary frame if `output.transport: "binary"`).
  - `response.output_audio.done`: Server finished outputting audio for the turn.
  - `response.output_audio_transcript.delta`: Streaming assistant speech transcript text.
  - `response.output_audio_transcript.done`: Transcript finished generating.
  - `response.text.delta` / `response.output_text.delta`: Text-only output deltas.
  - `response.output_item.done`: Output item complete.
  - `response.done`: Turn finished completely.
  - `response.cancelled`: Response was interrupted or cancelled.
- **Tool Calling:**
  - `response.function_call_arguments.delta`: Streaming JSON arguments for client-side tool.
  - `response.function_call_arguments.done`: Tool call ready with `call_id`, `name`, and full `arguments`.
  - `mcp_list_tools.in_progress` / `.completed` / `.failed`: Discovery status for remote MCP servers.
  - `response.mcp_call_arguments.delta` / `.done`: MCP call payload generation.
  - `response.mcp_call.in_progress` / `.completed` / `.failed`: Remote MCP server execution.
- **System & Keepalive:**
  - `ping`: Server sends `{"type": "ping", "timestamp": <ts>}`; client responds with `{"type": "pong", "ping_timestamp": <ts>}`.
  - `error`: Error payload containing `code`, `message`, and `type`.

---

## 4. `session.update` Payload Schema

Below is the complete payload structure accepted by `session.update`:

```json
{
  "type": "session.update",
  "session": {
    "instructions": "You are Grok, a helpful AI voice assistant...",
    "voice": "eve",
    "reasoning": {
      "effort": "high"
    },
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.85,
      "silence_duration_ms": 500,
      "prefix_padding_ms": 333,
      "idle_timeout_ms": 10000
    },
    "audio": {
      "input": {
        "format": {
          "type": "audio/pcm",
          "rate": 24000
        },
        "transport": "json",
        "transcription": {
          "model": "grok-transcribe",
          "language_hint": "en",
          "keyterms": ["xAI", "Grok", "Colossus"]
        }
      },
      "output": {
        "format": {
          "type": "audio/pcm",
          "rate": 24000
        },
        "transport": "json",
        "speed": 1.0
      }
    },
    "replace": {
      "Acme Mobile": "Acme Mobull",
      "xAI": "X A I"
    },
    "resumption": {
      "enabled": true
    },
    "tools": [
      {
        "type": "file_search",
        "vector_store_ids": ["collection_xyz"],
        "max_num_results": 10
      },
      {
        "type": "web_search",
        "allowed_domains": ["x.ai", "docs.x.ai"],
        "location": {
          "country": "US",
          "city": "San Francisco"
        }
      },
      {
        "type": "x_search",
        "allowed_x_handles": ["xai", "grok"],
        "from_date": "2026-01-01",
        "to_date": "2026-09-18"
      },
      {
        "type": "mcp",
        "server_url": "https://mcp.example.com/mcp",
        "server_label": "internal_tools",
        "server_description": "Inventory and billing tools",
        "allowed_tools": ["check_inventory"],
        "authorization": "Bearer mcp_token_here",
        "headers": {
          "X-Custom-Tenant": "tenant_123"
        }
      },
      {
        "type": "function",
        "name": "generate_random_number",
        "description": "Generate a random integer between min and max",
        "parameters": {
          "type": "object",
          "properties": {
            "min": { "type": "number", "description": "Minimum value" },
            "max": { "type": "number", "description": "Maximum value" }
          },
          "required": ["min", "max"]
        }
      }
    ]
  }
}
```

### Supported Codecs and Sample Rates
- `audio/pcm`: Linear16 Little-Endian at 8000, 16000, 22050, 24000 (default), 32000, 44100, 48000 Hz.
- `audio/pcmu`: G.711 μ-law at 8000 Hz (standard for Twilio / North American PSTN).
- `audio/pcma`: G.711 A-law at 8000 Hz (standard for international PSTN).
- `audio/opus`: Opus packets at 24000 Hz.

---

## 5. SDK Package Names and Ecosystem

### Official xAI Packages
1. **`xai-sdk`** (Python SDK on PyPI)  
   - Source: `https://github.com/xai-org/xai-sdk-python`
   - Install: `pip install xai-sdk`
   - Scope: gRPC/Protobuf client for Chat Completions, Text Embeddings, Vision/Image, Video, Tokenizer, Collections/Documents, Batches, and Files. *(Realtime audio is handled via raw WebSockets or OpenAI SDK)*.
2. **`xai-proto`** (Protobuf definitions)  
   - Source: `https://github.com/xai-org/xai-proto`
3. **`grok-build-plugin-cc`** (Claude Code Marketplace Plugin)  
   - Source: `https://github.com/xai-org/grok-build-plugin-cc`
   - Name: `grok-build@xai-grok-build`

### Client Libraries Used in Voice Examples
1. **OpenAI SDK Realtime Mode:**  
   `openai>=1.50.0`  
   xAI provides 100% drop-in compatibility with the OpenAI Realtime API:
   ```python
   from openai import AsyncOpenAI

   client = AsyncOpenAI(
       api_key=os.environ["XAI_API_KEY"],
       base_url="https://api.x.ai/v1"
   )
   async with client.realtime.connect(model="grok-voice-latest") as conn:
       ...
   ```
2. **Node.js / TypeScript:**  
   - `ws` (`^8.18.0`) - Core WebSocket client
   - `express-ws` (`^5.0.2`) - WebSocket server endpoints
   - `werift` (`^0.21.1`) - Pure TypeScript WebRTC stack for WebRTC-to-WebSocket relay
   - `twilio` (`^5.10.7`) - Telephony integration
3. **iOS:**  
   - Standard Swift Foundation `URLSessionWebSocketTask` and `AVFoundation` (no third-party SDK required).
4. **Android:**  
   - `com.squareup.okhttp3:okhttp:4.12.0` - WebSocket client
   - `org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3` - Event serialization

---

## 6. Grok Build CLI (`grok-build`) Endpoints, Configuration, and API Details

### 6.1 Distribution and Installation
- **Landing Page:** `https://x.ai/cli` (redirects to `https://x.ai/build`)
- **Install Script:**  
  - macOS / Linux: `curl -fsSL https://x.ai/cli/install.sh | bash`  
  - Windows: `irm https://x.ai/cli/install.ps1 | iex`
- **Binary Targets:** `grok` and `agent` (symlinked). macOS (`macos-aarch64`, `macos-x86_64`), Linux (`linux-aarch64`, `linux-x86_64`), Windows (`windows-x86_64.exe`).
- **Binary Download Hosts:**  
  - Primary: `https://x.ai/cli`
  - Fallback: `https://storage.googleapis.com/grok-build-public-artifacts/cli`
  - Channel check: `${BASE_URL}/${CHANNEL}` (`stable`, `alpha`, `enterprise`)
  - Package artifacts: `${BASE_URL}/grok-${version}-${platform}.zst` or `.gz`

### 6.2 Authentication Architecture
Credentials resolve in strict precedence:
1. **Per-model `api_key` / `env_key`** in `~/.grok/config.toml`
2. **Active session token** in `~/.grok/auth.json`
3. **`XAI_API_KEY`** environment variable
4. **`GROK_DEPLOYMENT_KEY`** environment variable

Login Mechanisms:
- **Interactive Browser Login:** `grok login --oauth`  
  Initiates OAuth flow at `auth.x.ai`. Scopes:  
  - OIDC Scope: `https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828`  
  - Legacy Scope: `https://accounts.x.ai/sign-in`  
  Stored in `~/.grok/auth.json` with `0600` file permissions.
- **Headless Device-Auth Flow:** `grok login --device-auth` (alias `--device-code`).
- **Customer SSO / OIDC:** Authorization code with PKCE redirecting to loopback `http://127.0.0.1/callback`.
- **External Auth Provider Command:** Delegated script/binary via `auth_provider_command` in `config.toml` or `GROK_AUTH_PROVIDER_COMMAND`.

### 6.3 Network Endpoints and Environment Variables
- **Chat / Session Proxy URL:**  
  `GROK_PROXY_URL` or `GROK_CLI_CHAT_PROXY_BASE_URL` or `endpoints.cli_chat_proxy_base_url`  
  *Default:* `https://cli-chat-proxy.grok.com/v1`
- **Enterprise Deployment Config URL:**  
  `${PROXY_URL}/deployment/config` (authenticates via `Authorization: Bearer <GROK_DEPLOYMENT_KEY>`). Downloads:
  - `~/.grok/managed_config.toml`
  - `~/.grok/requirements.toml`
- **Public xAI API Base:**  
  `GROK_XAI_API_BASE_URL` or `endpoints.xai_api_base_url` (default: `https://api.x.ai/v1`)
- **Models Endpoints:**  
  `GROK_MODELS_BASE_URL` (`endpoints.models_base_url`)  
  `GROK_MODELS_LIST_URL` (`endpoints.models_list_url` / `models_endpoint`)
- **Feedback Submissions:**  
  `GROK_FEEDBACK_BASE_URL` or `endpoints.feedback_base_url`
- **Telemetry & Traces:**  
  `GROK_TRACE_UPLOAD_URL` (`endpoints.trace_upload_url`) or direct cloud storage via `GROK_TRACE_UPLOAD_BUCKET` (`s3://` or `gs://`).
- **Web Fetch Egress Proxy:**  
  `[toolset.web_fetch] proxy_endpoint = "https://..."`
- **Wire Protocols Supported for Inference:**  
  `chat_completions`, `responses`, `messages`.

---

## 7. Direct SIP Telephony Details

xAI provides a native SIP trunk interface for carrier integration:
- **Registration Endpoint:** `POST https://api.x.ai/v2/phone-numbers`
- **SIP Routing URI:** `sip:{phone_number}@sip.voice.x.ai;transport=tls`
- **Inbound Event Webhook:** `realtime.call.incoming` containing `call_id` and SIP headers.
- **WebSocket Bridge:** Client joins live call via `wss://api.x.ai/v1/realtime?call_id={call_id}`.
- **Synchronous Call Transfer:** `POST https://api.x.ai/v1/realtime/calls/{call_id}/refer` with `{"target_uri": "tel:+1..."}` or `sip:...`.
- **Call Termination:** `POST https://api.x.ai/v1/realtime/calls/{call_id}/hangup`.
- **DTMF Tone Capture:** Emitted in real-time as `input_audio_buffer.dtmf_event_received` events.
