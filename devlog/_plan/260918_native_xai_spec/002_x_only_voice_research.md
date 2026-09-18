# xAI Grok Voice & Realtime API Surface: X (Twitter) Research Findings

This document compiles concrete API facts, parameters, endpoints, models, event names, pricing, and architecture details for xAI's Grok Voice ecosystem extracted directly from posts on X (Twitter), including disclosures from @SpaceXAI (official xAI account), @elonmusk, @Vodkowski, @XFreeze, @tetsuoai, @techdevnotes, and others.

---

## 1. Executive Summary & Architecture Overview

- **Native End-to-End Speech-to-Speech**: Unlike traditional voice pipelines that cascade separate STT → LLM → TTS hops, Grok Voice (starting with Think Fast 1.0 and Think Fast 2.0) is a single, native speech-to-speech model with audio reasoning, an in-house trained Voice Activity Detection (VAD) system, and custom tokenizers.
  - Source: https://x.com/SpaceXAI/status/2001385967156924639
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/grok/status/2091997422314532919
- **Standalone Audio Endpoints**: In addition to the Speech-to-Speech WebSocket, xAI provides standalone Text-to-Speech (`POST /v1/tts`) and Speech-to-Text (REST batch and WebSocket streaming) APIs.
  - Source: https://x.com/SpaceXAI/status/2001385977932320832
  - Source: https://x.com/tetsuoai/status/2030186119724421628
  - Source: https://x.com/XFreeze/status/2045401673464435041

---

## 2. Models, Aliases & Launch Dates

| Model Name / ID | Type | Role & Description | Launch Date | Source X Post URL |
| :--- | :--- | :--- | :--- | :--- |
| `grok-voice-think-fast-2.0` | Realtime S2S | Next-generation pinned speech-to-speech production model; #1 on Artificial Analysis S2S Index; 0.70s latency | 2026-07-29 | https://x.com/SpaceXAI/status/2082529280341553209 |
| `grok-voice-latest` | Realtime Alias | Dynamic rolling alias currently pointing to `grok-voice-think-fast-2.0` | 2026-08-04 / 2026-09-16 | https://x.com/Vodkowski/status/2100130878185746639<br>https://x.com/Pythrasignal/status/2086809739661603150 |
| `grok-voice-think-fast-1.0` | Realtime S2S | First-generation low-latency agentic voice model for enterprise support | 2026-05-07 | https://x.com/SpaceXAI/status/2052529102280880234 |
| `grok-tts` | Text-to-Speech | Standalone expressive text-to-speech engine supporting inline tags and streaming | 2026-03-07 (Beta)<br>2026-03-16 (GA) | https://x.com/tetsuoai/status/2030186119724421628<br>https://x.com/SpaceXAI/status/2033617157884678507 |
| `grok-stt` | Speech-to-Text | Standalone multilingual transcription engine with diarization and ITN | 2026-04-18 | https://x.com/SpaceXAI/status/2045297699352924504<br>https://x.com/XFreeze/status/2045401673464435041 |
| Grok Voice Agent API (Initial) | Realtime S2S | Initial OpenAI-compatible realtime voice API release | 2025-12-17 | https://x.com/SpaceXAI/status/2001385958147752255 |
| Voice Agent Builder | Platform | No-code production voice agent platform with telephony and knowledge retrieval | 2026-07-01 | https://x.com/SpaceXAI/status/2072342803787702422 |
| Voice Cloning | Feature | Custom voice creation in under 2 minutes across 28 languages | 2026-05-01 | https://x.com/SpaceXAI/status/2050355373052223585 |

> **Production Warning**: xAI and community builders strongly advise pinning the explicit versioned model identifier (`grok-voice-think-fast-2.0`) in production systems. `grok-voice-latest` dynamically tracks the newest checkpoint, which can introduce unannounced behavioral or prompt shifts.
> - Source: https://x.com/Vodkowski/status/2100130878185746639

---

## 3. WebSocket Realtime API: Endpoints, Query Parameters & Protocol

### 3.1 Connection URLs & Parameters
- **Base WebSocket URL**: `wss://api.x.ai/v1/realtime`
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/techdevnotes/status/2064694591480008906
- **Query Parameters**:
  - `model`: Model identifier, e.g. `?model=grok-voice-think-fast-2.0` or `?model=grok-voice-latest`.
    - Source: https://x.com/Vodkowski/status/2100130878185746639
    - Source: https://x.com/techdevnotes/status/2064694591480008906
  - `conversation_id`: Session resumption identifier passed on reconnect, e.g. `?model=...&conversation_id=<saved_id>`.
    - Source: https://x.com/techdevnotes/status/2064694591480008906

### 3.2 Authentication & Browser Ephemeral Tokens
- **Browser Authentication Constraint**: Standard browser WebSocket clients (`new WebSocket(...)`) cannot set custom HTTP request headers such as `Authorization: Bearer <API_KEY>`.
- **Ephemeral Token Protocol Path**: xAI implements an ephemeral token protocol exchange for client-side and browser applications to avoid exposing secret API keys in client environments.
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/techdevnotes/status/2064694591480008906

### 3.3 Session Resumption Protocol & Lifecycle
By default, `/v1/realtime` connections discard context on disconnect. Session resumption caches conversational state server-side and replays context upon reconnection.
1. **Opt-in during Handshake**: Client sends a `session.update` event specifying resumption:
   ```json
   {
     "type": "session.update",
     "session": {
       "resumption": {
         "enabled": true
       }
     }
   }
   ```
2. **Server ID Capture**: Server emits `conversation.created` containing `conversation.id`:
   ```json
   {
     "type": "conversation.created",
     "conversation": {
       "id": "conv_abc123"
     }
   }
   ```
3. **Reconnecting**: Client reconnects with `wss://api.x.ai/v1/realtime?model={MODEL}&conversation_id={saved_id}` and resends `resumption: { enabled: true }`.
4. **Context Replay**: Cached turns replay before new interactions, echoed as `conversation.item.created` events.
5. **Persisted State**: Replayed state includes user transcripts, assistant transcripts, assistant tool calls, and `function_call_output` tool returns.
- Source: https://x.com/techdevnotes/status/2064694591480008906
- Source: https://x.com/Vodkowski/status/2100130878185746639

### 3.4 xAI Realtime Protocol Extensions vs OpenAI Spec
While xAI's Realtime WebSocket maintains wire compatibility with OpenAI Realtime clients (allowing migration by swapping endpoint, API key, and model), xAI introduces proprietary extensions:
- `force_message`: For mid-turn caller steering and forcing model responses mid-dialogue.
  - Source: https://x.com/Vodkowski/status/2100130878185746639
- `resumption`: Built-in multi-turn caching and reconnection replay.
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/techdevnotes/status/2064694591480008906
- `pronunciation replace`: Configurable phonetic replacement rules/pronunciation dictionaries for specialized domains (medical, financial, legal).
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/SpaceXAI/status/2001385975516402039
- **Server VAD & Mid-call Tool Wiring**: Server-side VAD manages interruptions/barge-in seamlessly. Built-in tools callable mid-stream include:
  - `x_search` (real-time X post/trend search)
  - `web_search` (real-time internet search)
  - `file_search` (document/knowledge retrieval)
  - Model Context Protocol (MCP) servers
  - Custom functions
  - Source: https://x.com/Vodkowski/status/2100130878185746639
  - Source: https://x.com/SpaceXAI/status/2001385972379107673
  - Source: https://x.com/SpaceXAI/status/1925244461875175616

---

## 4. Standalone Text-to-Speech (TTS) API

- **Endpoint**: `POST https://api.x.ai/v1/tts`
  - Source: https://x.com/tetsuoai/status/2030186119724421628
- **Model ID**: `grok-tts`
  - Source: https://x.com/datapointai/status/2094829412625654141
  - Source: https://x.com/livekit/status/2092640102845743407
- **Pricing**:
  - Flat rate: **$4.20 per 1,000,000 input characters** (includes streaming and expressive tag processing).
  - Benchmark comparison on X: Compared against OpenAI TTS-1 ($15/M characters) and ElevenLabs entry tier (~$166/M characters).
  - Source: https://x.com/grok/status/2030321019869659138
  - Source: https://x.com/grok/status/2046200678545051852
- **Voice IDs**:
  - 5 primary launch voices: `eve`, `ara`, `rex`, `sal`, `leo`.
  - Additional catalog voice: `ani`.
  - Total library expanded to 80+ voices across 28 languages via Voice Cloning.
  - Source: https://x.com/tetsuoai/status/2030186119724421628
  - Source: https://x.com/SpaceXAI/status/2001385975516402039
  - Source: https://x.com/SpaceXAI/status/2050355373052223585
- **Inline Expressive Tags**:
  - Plaintext brackets: `[pause]`, `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, breathing adjustments, pitch, speed, and volume tags.
  - XML tags: `<whisper>text</whisper>`.
  - Source: https://x.com/tetsuoai/status/2030186119724421628
- **Supported Audio Formats**: High-fidelity WAV, MP3, and telephony-optimized µ-law (`mulaw`).
  - Source: https://x.com/tetsuoai/status/2030186119724421628

---

## 5. Standalone Speech-to-Text (STT) API

- **Endpoints & Access**:
  - REST API: Batch processing of long-form audio.
  - WebSocket API: Low-latency live streaming transcription.
  - Source: https://x.com/XFreeze/status/2045401673464435041
- **Model ID**: `grok-stt`
  - Source: https://x.com/grok/status/2100576814846390336
  - Source: https://x.com/OpenRouter/status/2080743252215619645
- **Pricing**:
  - Batch transcription: **$0.10 per audio hour**
  - Streaming transcription: **$0.20 per audio hour**
  - Source: https://x.com/XFreeze/status/2045401673464435041
  - Source: https://x.com/grok/status/2100618873330409919
  - Source: https://x.com/VaibhavSisinty/status/2045615255544545729
- **Accuracy Benchmarks (Word Error Rate - WER)**:
  - Overall WER: **6.9%**
  - Phone Call Entities: **5.0%** (vs ElevenLabs 12.0%, Deepgram 13.5%, AssemblyAI 21.3%)
  - Video / Podcasts: **2.4%**
  - Telephone: **9.3%**
  - Meetings: **10.9%**
  - Source: https://x.com/XFreeze/status/2045401673464435041
  - Source: https://x.com/grok/status/2100576814846390336
- **Key Capabilities**:
  - Intelligent Inverse Text Normalization (ITN): Automatically formats currencies, dates, phone numbers, and addresses.
  - Word-level speaker diarization and multi-channel audio handling.
  - Multilingual support across 25+ languages with seamless mid-stream language switching.
  - Word-level timestamps.
  - Source: https://x.com/XFreeze/status/2045401673464435041
  - Source: https://x.com/SpaceXAI/status/2045297699352924504

---

## 6. Voice Agent Builder & Enterprise Deployments

- **Launch & Pricing**: Announced July 1, 2026, priced at **$0.05 / min** (upgraded to $0.08 / min when running Think Fast 2.0).
  - Source: https://x.com/SpaceXAI/status/2072342803787702422
  - Source: https://x.com/SpaceXAI/status/2082529282866450696
- **Key Features**:
  - No-code voice agent creation inside the xAI developer console (`https://console.x.ai`).
  - Free inbound phone number included with every developer account.
  - BYO telephony: Bring existing SIP/phone numbers, custom APIs, and MCP servers.
  - Native integration with guardrails, knowledge retrieval, and observability.
  - Source: https://x.com/SpaceXAI/status/2072342805482222057
  - Source: https://x.com/SpaceXAI/status/2072342809034789088
- **Production Enterprise Implementations**:
  - **Starlink**: Handles >15,000 inbound customer support and sales calls/day; resolves hardware diagnostics, replacements, and fulfills >3,000 orders/week across voice and chat.
    - Source: https://x.com/SpaceXAI/status/2091987541272543406
    - Source: https://x.com/elonmusk/status/2091996794419060905
  - **Tesla Fleet**: Embedded in vehicle fleet (firmware 2026.26.6.5 summer update) for vehicle status queries, multi-action commands, routing, and navigation control.
    - Source: https://x.com/grok/status/2093900550622294100
    - Source: https://x.com/SpaceXAI/status/2001385970344550576
  - **Elon Musk Endorsements**:
    - "Try Grok Voice for your customer support" (https://x.com/elonmusk/status/2052530063913189879)
    - "Grok Voice is now #1 in agentic performance" (https://x.com/elonmusk/status/2082559894264430870)
    - "Grok @Bot now has a voice" (https://x.com/elonmusk/status/2100698004210475317)

---

## 7. Performance Benchmarks: Grok Voice Think Fast 2.0

- **Latency**: **~0.70 seconds** time-to-first-audio (TTFA), down from 1.25s on earlier models.
  - Source: https://x.com/grok/status/2087439456059961580
  - Source: https://x.com/XEthanai/status/2084599318128828839
- **Token Efficiency**: Relative reasoning cost reduced to **0.4x tokens** (down from 1.0x) through parallel reasoning and token pruning.
  - Source: https://x.com/XEthanai/status/2084599318128828839
- **Independent Index Rankings**:
  - Ranked **#1 on Artificial Analysis Speech-to-Speech Index** (evaluating reasoning over heard speech, task resolution, and mid-call tool execution).
    - Source: https://x.com/SpaceXAI/status/2091987538999197752
  - Ranked **#1 on Speech Agent Arena** with a **94.6% Task Success Rate**, leading competitors including Gemini 3.8 Live, GPT-Realtime-2.1 High, and GPT-Live-1 Astra.
    - Source: https://x.com/XFreeze/status/2100568284030496967

---

## 8. Divergences & Contradictions with Official docs.x.ai

Evidence on X reveals key technical and commercial details that differ from or are omitted in standard docs:

1. **Model Aliases vs Pinned IDs**:
   - `docs.x.ai` often cites `grok-voice-latest` as the standard identifier.
   - Real-world production experience shared on X highlights that `grok-voice-latest` dynamically updates behind the scenes (pointing to `grok-voice-think-fast-2.0` after July 29, 2026), making pinning `grok-voice-think-fast-2.0` essential to prevent breaking conversational cadence or prompt behavior.
   - Source: https://x.com/Vodkowski/status/2100130878185746639
2. **WebSocket Header Authorization Failure in Browsers**:
   - Standard REST documentation typically states that authentication occurs via standard `Authorization: Bearer <API_KEY>` headers.
   - On WebSockets in browser environments, custom headers cannot be set; client developers must use the dedicated ephemeral token exchange endpoint rather than standard bearer headers.
   - Source: https://x.com/Vodkowski/status/2100130878185746639
   - Source: https://x.com/techdevnotes/status/2064694591480008906
3. **Session Resumption Protocol Mechanics**:
   - The specific handshake sequence (`wss://api.x.ai/v1/realtime?model={MODEL}&conversation_id={id}`, `session.update` with `resumption.enabled: true`, and automatic replaying of previous tool calls and transcripts via `conversation.item.created`) is documented primarily in developer updates on X.
   - Source: https://x.com/techdevnotes/status/2064694591480008906
4. **Realtime Pricing Tiers**:
   - The original Grok Voice Agent API flat rate was $0.05/min, and Voice Agent Builder debuted at $0.05/min. However, Grok Voice Think Fast 2.0 introduced a higher tier pricing of **$0.08/min**.
   - Source: https://x.com/SpaceXAI/status/2001385963390665163
   - Source: https://x.com/SpaceXAI/status/2082529282866450696
5. **Billing Unit Discrepancies**:
   - STT is billed strictly per **audio hour** ($0.10/hr batch, $0.20/hr streaming), avoiding hidden token or conversion overhead.
   - TTS is billed strictly per **character** ($4.20 / 1M characters flat) rather than audio output tokens.
   - Source: https://x.com/XFreeze/status/2045401673464435041
   - Source: https://x.com/grok/status/2046200678545051852
6. **xAI Protocol Extensions (`force_message`, `pronunciation replace`)**:
   - Standard OpenAI Realtime SDK documentation does not accommodate mid-turn steering (`force_message`) or custom phonetic replacement maps, which are unique xAI protocol extensions.
   - Source: https://x.com/Vodkowski/status/2100130878185746639
