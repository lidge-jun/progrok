# xAI 엔드포인트 인벤토리 (2026-09-18)

두 소스의 합집합이다. 공식 문서(docs.x.ai REST 마크다운 + `openapi.json` + WS 스키마 3종)와
grok build 소스 분석(macbookpro-2:~/developer/codex/042_grok-build-analysis 및 180_grok-build).
어느 한쪽에만 있는 항목은 그렇게 표시한다. 라이브 검증 여부도 표시한다.

## 호스트

| 용도 | 호스트 | 근거 |
|---|---|---|
| 공개 추론 | `https://api.x.ai/v1` | 공식 문서 + 라이브 확인 |
| OAuth/세션 추론 | `https://cli-chat-proxy.grok.com/v1` | grok build 소스 전용 |
| Management | `https://management-api.x.ai` | 공식 문서, 별도 키 |
| mTLS 엔터프라이즈 | `https://mtls.api.x.ai/v1` | 공식 문서 |
| US 리전 | `https://us.api.x.ai/v1` | grok-4.6만, 미디어/Voice 제외 |
| 에셋 | `https://assets.grok.com` | grok build 소스 |
| SIP 트렁크 | `sip:{number}@sip.voice.x.ai;transport=tls` | 공식 문서 |

## 인증

- Bearer: API 키 또는 OAuth access token.
- OAuth/세션 요청은 `X-XAI-Token-Auth: xai-grok-cli`를 동반한다 (소스 전용).
- 브라우저 WS는 커스텀 헤더를 실을 수 없으므로 `Sec-WebSocket-Protocol: xai-client-secret.<token>`을 쓴다.
- ephemeral token: `POST /v1/realtime/client_secrets`, 기본 600초, 최대 3600초. 라이브 확인됨(200).
- OIDC discovery: `https://auth.x.ai/.well-known/openid-configuration`. client_id `b1a00492-073a-47ea-816f-4c329264a828`.
- 현재 grok build 소스의 스코프는 10개다: `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write`.
  progrok과 opencodex가 쓰는 6개 집합은 그 부분집합이다.

## 추적 헤더 (소스 전용)

`x-grok-client-identifier`, `x-grok-client-version`, `x-grok-conv-id`, `x-grok-req-id`,
`x-grok-model-override`, `x-grok-session-id`, `x-grok-agent-id`, `x-grok-turn-idx`,
`x-grok-transient-retry`, `x-grok-deployment-id`, `x-grok-user-id`, `x-grok-conv-group-id`.

## 텍스트 추론 REST

| Method | Path | 비고 |
|---|---|---|
| POST | `/v1/responses` | 주 표면. `input`, `tools`, `tool_choice`, `reasoning`, `search_parameters`, `include`, `service_tier`, `prompt_cache_key`, `text.format`, `max_turns`, `previous_response_id`, `store` |
| GET/DELETE | `/v1/responses/{id}` | 저장된 응답은 30일 후 삭제 |
| POST | `/v1/responses/compact` | |
| GET | `/v1/responses/{id}/input_items` | OpenAPI 전용 |
| POST | `/v1/chat/completions` | `deferred` 지원 |
| GET | `/v1/chat/deferred-completion/{request_id}` | 처리 중 202 |
| POST | `/v1/completions`, `/v1/messages`, `/v1/complete` | 레거시. `/v1/messages`는 Anthropic 형태 |
| POST | `/v1/embeddings` | OpenAPI 전용 |
| GET | `/v1/embedding-models[/{id}]` | OpenAPI 전용 |

### Responses 응답 확장 (소스 전용)

`response.usage.context_details.input_tokens`, `.output_tokens`, `response.usage.cost_in_usd_ticks`.
tick 단위는 1 USD = 1e10.

## WebSocket

| URL | 용도 | 인증 |
|---|---|---|
| `wss://api.x.ai/v1/responses` | Responses WS. 직렬 처리, 연결당 최대 25분 | Bearer |
| `wss://api.x.ai/v1/realtime` | speech-to-speech. query: `model`, `call_id`, `conversation_id`, `reasoning.effort` | Bearer 또는 ephemeral 서브프로토콜 |
| `wss://api.x.ai/v1/stt` | 스트리밍 STT. **라이브 확인됨** | Bearer |
| `wss://api.x.ai/v1/tts` | 스트리밍 TTS | Bearer |
| `wss://code.grok.com/ws/code-agent` | grok build 릴레이. JSON-RPC/ACP | 소스 전용 |
| `wss://grok.com/ws/gw/` | 게이트웨이. 공개 빌드에서 hard-off | 소스 전용 |

### STT 스트리밍 계약 (라이브 확인)

query: `sample_rate`(기본 16000), `encoding`(pcm|mulaw|alaw|opus), `interim_results`, `endpointing`(기본 400ms),
`language`, `diarize`, `filler_words`, `multichannel`, `channels`, `keyterm`(반복), `smart_turn`, `smart_turn_timeout`, `vad_threshold`.

클라이언트: 바이너리 오디오 프레임, `{"type":"finalize"}`, `{"type":"audio.done"}`.
서버: `transcript.created` → `transcript.partial`(`is_final`/`speech_final`) → `transcript.done`, `error`.

실측 주의: 최종 문장은 `speech_final=true`인 partial에 담겼고 `transcript.done`의 `text`는 빈 문자열이었다.
연결은 1006으로 끊긴다. 클라이언트는 `speech_final`을 최종값으로 취급해야 한다.

### realtime 이벤트

클라이언트: `session.update`, `input_audio_buffer.append|commit|clear`,
`conversation.item.create|delete|truncate`, `response.create|cancel`.
item 종류에 xAI 확장 `force_message`가 있다.

서버: session/conversation 생성·갱신, speech start/stop/commit/timeout, item add/delete/truncate/transcription,
`input_audio_buffer.dtmf_event_received`, response lifecycle, audio/text/transcript delta·done,
function-call delta·done, MCP lifecycle, `response.done`, `error`.

세션 설정에 VAD, resumption, pronunciation replacements, audio transport/format/transcription, tools가 들어간다.

## Voice REST

| Method | Path | 라이브 |
|---|---|---|
| POST | `/v1/tts` | 확인됨 (200, audio/mpeg). `output_format`은 **객체**다 |
| GET | `/v1/tts/voices[/{voice_id}]` | 확인됨 |
| POST | `/v1/stt` | 확인됨. multipart, `file`은 마지막 필드 |
| POST | `/v1/realtime/client_secrets` | 확인됨 |
| POST/GET | `/v1/custom-voices` | 미확인 |
| GET/PATCH/DELETE | `/v1/custom-voices/{id}` | 미확인 |
| GET | `/v1/custom-voices/{id}/audio` | 미확인 |
| POST | `/v2/phone-numbers` | SIP 번호 프로비저닝 |
| POST | `/v1/realtime/calls/{call_id}/refer|hangup` | SIP |

주의: OpenAI 스타일 경로(`/v1/audio/transcriptions`, `/v1/audio/speech`)는 xAI에 없다.
전자는 404, 후자는 팀 권한 403을 반환한다. 혼동 금지.

## 모델

텍스트: `grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`,
`grok-4.20-0309-non-reasoning`, `grok-4.20-multi-agent-0309`, `grok-build-0.1`.

음성: `grok-voice-latest`는 `grok-voice-think-fast-2.0`의 별칭이다.
progrok 2.0.4의 `grok-voice-fast-1.0` / `grok-voice-think-fast-1.0` 목록은 구식이다.
X 근거상 프로덕션에서는 별칭 대신 핀 고정을 권한다.

미디어: `grok-imagine-image`, `grok-imagine-video`. 소스에는 `grok-imagine-image-quality`,
`grok-imagine-video-1.5`가 나타난다.

## 도구 표면

`function`, `web_search`, `x_search`, `image_generation`, `file_search`,
`code_interpreter`, `mcp`, `shell`, `tool_search`.

web_search는 `allowed_domains`/`excluded_domains` 최대 5(상호 배타), x_search는 handle 필터
(가이드 20 / OpenAPI 10으로 불일치), file_search는 `vector_store_ids` 최대 10.

## 미디어·저장·기타

`/v1/images/generations`, `/v1/images/edits`,
`/v1/videos/generations|edits|extensions`, `GET /v1/videos/{request_id}`,
`/v1/models`, `/v1/language-models`, `/v1/image-generation-models`, `/v1/video-generation-models`,
`GET /v1/api-key`, `POST /v1/tokenize-text`, `GET /v1/me`(OpenAPI 전용),
batches, files, collections(`POST /v1/documents/search`), skills(OpenAPI 전용).

소스 전용: `/v1/storage/batch_upload`, `/v1/storage/batch_upload_json`,
`/v1/storage/signed-upload-url`, `/v1/feedback`, `/v1/feedback/config`,
`/v1/feedback/requests`, `/v1/feedback/requests/{id}/complete|dismiss`.

## 오류

400, 401, 403, 404, 405, 415, 422, 429. deferred chat의 202는 정상 queued다.
429는 지수 백오프. WS 전용 오류로 `previous_response_not_found`,
`websocket_connection_limit_reached`가 있다.

## 부록: base URL 쟁점 판정 (2026-09-18 라이브)

같은 OAuth access token으로 두 base를 직접 찔러 판정했다. 결론은 **progrok의 OAuth 레인은 `api.x.ai`가 맞다**.
`cli-chat-proxy.grok.com`은 Grok CLI 전용 레인이며 별도 게이트와 별도 카탈로그, 심지어 다른 서빙 모델을 갖는다.

| 프로브 | `cli-chat-proxy.grok.com/v1` | `api.x.ai/v1` |
|---|---|---|
| `GET /models` | 200, 모델 2개: `grok-4.6`, `grok-4.5` | 200, 모델 10개 (imagine 계열 포함) |
| `POST /chat/completions` | 헤더 없으면 **426** "Grok CLI version (none) is outdated… 0.1.202 or later" | 200, `model: grok-4.6` |
| `POST /chat/completions` + `x-grok-client-identifier`/`x-grok-client-version: 1.0.34` | 200, 서빙 모델이 **`grok-4.6-build`** | — |
| `POST /responses` (버전 헤더 포함) | 200, 역시 `grok-4.6-build` | 200 |
| `GET /tts/voices`, `POST /realtime/client_secrets` | **404** (nginx) | 200 |
| `GET /v1/me` | — | 200, `user_id`/`team_id`/`zdr_status`/`oauth.client_id` 반환 |
| `POST /v1/tokenize-text` | — | 200 |

판정에서 나온 규칙:

1. **Voice 표면은 `api.x.ai`에만 있다.** cli-chat-proxy에는 아예 없다(404). 따라서 voice를 cli-proxy로 라우팅하는 설계는 불가능하다.
2. **cli-chat-proxy는 클라이언트 버전 게이트를 건다.** `x-grok-client-identifier`와 `x-grok-client-version`이 없으면 426으로 거절한다.
   이 값을 위조해 우회하는 설계는 하지 않는다. 이 레인을 노출한다면 명시적 opt-in으로만 둔다.
3. **서빙 모델이 다르다.** 같은 `grok-4.6`을 요청해도 cli-proxy는 `grok-4.6-build`로 응답한다. 두 레인을 같은 모델 id로 취급하면 안 된다.
4. `X-XAI-Token-Auth: xai-grok-cli`는 `GET /models`에서는 있으나 없으나 200이었다. 인증 요소가 아니라 레인 표시자에 가깝다.
5. `GET /v1/me`는 OAuth 토큰으로 실제 동작한다. ima2-gen CHANGELOG가 "xAI documents only /v1/me as accepting OAuth tokens"라고
   적었지만, 실측상 OAuth 토큰은 models/tokenize/chat/responses/tts/stt/realtime에서도 모두 200을 받았다.
