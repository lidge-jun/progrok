# Changelog

## [3.0.0] - 2026-09-18

progrok stops being a proxy that swaps an Authorization header and becomes a
native client for the xAI API, with a web app on top.

### Breaking

- **`capabilities --json` is schema 2.** `commands` is an array of objects with
  `name`, `summary` and argument metadata instead of an array of strings, and the
  endpoint list is generated from the surface registry rather than a hand-kept
  copy. There is no legacy shim: a consumer reading `commands[i]` as a string
  must read `commands[i].name`. This is the whole reason the version is a major.
- **`progrok chat` serves the new workspace**, not the old single-page demo.

### Added

- **Voice REST** — `POST /v1/tts`, `POST /v1/stt`, the built-in voice listing,
  custom-voice CRUD, and ephemeral client secrets, as typed clients.
- **Voice WebSockets** — streaming speech-to-text, streaming text-to-speech and
  realtime speech-to-speech against `wss://api.x.ai`, including xAI's
  `force_message` extension, session resumption and DTMF events.
- **Responses WebSocket** — one turn in flight per connection, with
  `previous_response_id` continuation and the `generate:false` warmup.
- **Surface clients** — batches, files, collections, embeddings, skills, models,
  tokenize, images and videos behind one boundary, plus a registry that records
  where the evidence for each endpoint came from.
- **CLI** — `tts`, `stt` and `live`.
- **Web app** — chat with reasoning and tool activity, browser voice against xAI
  directly, and image/video generation with poll-to-terminal handling.

### Changed

- **Requests are parsed, not forwarded.** Chat and Responses become typed events
  and are re-rendered, so a malformed tool call or a stream that ends without a
  terminal is an error instead of corrupt bytes. Everything else remains a
  verified relay, which is the right answer for binary and multipart.
- **Token refresh is a transaction** — single-flighted per account and
  credential generation, with a stale result fenced off and a 401 replayed
  exactly once.
- **Routing is explicit.** The OAuth lane is `api.x.ai`. `cli-chat-proxy.grok.com`
  is reachable only through an opt-in client: it gates on a Grok CLI version
  header, exposes two models, serves `grok-4.6-build` and has no voice
  endpoints.

### Fixed

- Error responses no longer echo credential-shaped values from an underlying
  error message.
- A paused relay no longer strands its promise when the client disconnects
  before the socket drains.

### Notes

- The credential file keeps its path, schema and unknown fields. ima2-gen
  v3.16.1 removed its bundled progrok and reads the same
  `~/.progrok/auth.json` directly, so breaking that format would break it.
- An ephemeral client secret opens exactly one WebSocket. Mint one per
  connection and pass it only through the `xai-client-secret.<token>`
  subprotocol; as a bearer it is rejected.
