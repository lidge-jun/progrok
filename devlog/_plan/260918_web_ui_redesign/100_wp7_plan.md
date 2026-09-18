# wp7 실행 계획 (diff-level) — 라이브 보이스 견고성

사용자 보고: 실제 세션에서 `Voice API returned an invalid event.`로 통화가 끊긴다.

## 근본 원인

웹소켓이 불안정한 게 아니다. **프런트엔드가 스스로 세션을 죽인다.**

- `src/voice/protocol.ts:242` — 모르는 타입이면 `VoiceProtocolError`를 던진다.
- `stringField`/`numberField`/`integerField`/`record`도 필드가 어긋나면 던진다(139-152행).
- `src/web/client/voice.ts` `onMessage`의 `catch`가 `fail()`을 호출하고, `fail()`은 소켓을 닫는다.

즉 xAI가 progrok이 모르는 이벤트를 **하나만** 보내도 통화가 끝난다.

## 레퍼런스: codex 구현

`/Users/jun/Developer/codex/120_codex-cli/codex-rs/codex-api/src/endpoint/realtime_websocket/`

- `protocol_v2.rs:74-77` — `_ => { debug!("received unsupported realtime v2 event type: ..."); None }`
- `protocol.rs:262-271` — `parse_realtime_event`가 `Option<RealtimeEvent>`를 반환한다. 던지지 않는다.
- `methods.rs:522-527` — `if let Some(event) = parse(...)` ... 아니면 `debug!("ignored unsupported text frame")`. **루프는 계속 돈다.**
- `methods.rs:739-762` — 재시도는 **연결 수립(sideband join)에만** 적용하고 지수 백오프를 쓴다.
- `016_realtime-voice/00_realtime-architecture.md:658` — "control socket join만 provider retry 정책에 따라 재시도한다".

핵심 원칙: **연결 수립은 재시도하되, 수립된 스트림을 파싱 실패로 죽이지 않는다.**

## 변경 (1·2번: 관용적 파싱)

| 파일 | 변경 |
|---|---|
| `src/voice/protocol.ts` | `parseRealtimeServerEvent`/`parseSttServerEvent` 옆에 `tryParseRealtimeServerEvent`/`tryParseSttServerEvent`를 추가한다. 내부에서 기존 파서를 호출하고 `VoiceProtocolError`만 잡아 `null`을 반환한다. **기존 엄격 파서는 그대로 둔다** — CLI와 테스트가 계약 검증에 쓴다 |
| `src/web/client/voice.ts` | `onMessage`가 try 파서를 쓴다. `null`이면 이벤트 로그에 `unsupported:<type>`만 남기고 세션을 유지한다. `catch`로 `fail()`하지 않는다 |

서버가 보낸 `type: "error"` 이벤트는 **지금처럼 실패로 처리한다.** 이게 codex가 그은 선이다.
JSON 자체가 깨진 경우도 무시 대상이다(프레임 하나 손상이 통화를 끝낼 이유가 없다).

타입 식별을 위해 `null` 반환 시에도 원본에서 `type` 문자열만 best-effort로 뽑아 로그에 남긴다.

## 하지 않는 것 (3번은 별도)

스트림 중간 재연결과 `reconnecting` UI는 이번 범위가 아니다.
연결 수립 재시도를 넣으면 `reconnecting` 상태가 실재하게 되므로(005 B4에서 N/A로 처리했던 근거가 바뀐다)
UI까지 함께 설계해야 한다. 다음 단위로 남긴다.

## 부수 정정: 실제 카탈로그

로그인 후 `progrok models --json`으로 받은 실제 카탈로그는 12개다.

`grok-4.20-0309-non-reasoning / grok-4.20-0309-reasoning / grok-4.20-multi-agent-0309 /
grok-4.3 / grok-4.5 / grok-4.6 / grok-build-0.1 / grok-imagine-image / grok-imagine-image-2.0 /
grok-imagine-image-quality / grok-imagine-video / grok-imagine-video-1.5`

- `grok-code-fast-1`이 **없다.** wp6에서 opencodex 카탈로그를 근거로 README/SKILL 표에 추가했는데
  이 계정에서는 보이지 않는다. **제거하거나 근거를 명시한 주석으로 바꾼다.**
- `grok-composer-2.5-fast`도 `/v1/models`에 없다. README가 이미 그렇게 적고 있어 그대로 둔다.
- `grok-4.6`, `grok-build-0.1`, `grok-imagine-image-2.0`, `grok-imagine-video-1.5`는 확인됨.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- 신규 테스트: 모르는 타입, 필드 타입 불일치, 깨진 JSON이 각각 `null`을 반환하고
  `type: "error"`는 여전히 error 이벤트로 파싱되는지
- **실제 세션 재현**: 로그인된 상태에서 `127.0.0.1:18646` 보이스 통화를 열어
  이전에 끊기던 지점을 통과하는지 확인하고, 이벤트 로그에 `unsupported:*`가 실제로 찍히는지 본다
- 이 과정에서 c-2(마이크 입력 반응 미터)도 함께 측정한다


---

# wp7 감사 반영 (A-phase fold)

## K1. 이벤트 타입 문자열 살균 (리뷰어 지적)

서버가 보낸 `type`을 그대로 이벤트 로그에 찍으면 임의 장문·민감 문자열이 UI에 노출된다.

```ts
function safeEventLabel(value: unknown): string {
  if (typeof value !== "string") return "unsupported";
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "");
  return cleaned.length === 0 ? "unsupported" : `unsupported:${cleaned.slice(0, 48)}`;
}
```

허용 문자는 `[a-zA-Z0-9._-]`, 최대 48자. 그 외에는 고정값 `unsupported`만 기록한다.
페이로드 본문은 어떤 경우에도 기록하지 않는다(050 §7 유지).

## K2. malformed error 경계 (리뷰어 지적)

정상 `type: "error"`는 파싱 후 실패로 처리된다(STT `voice.ts:416-418`, realtime `454-456`).
그러나 **형식이 깨진 error 이벤트는 일반 파싱 실패로 묶여 무시된다.**
이 경계를 테스트에 명시한다. 의도적 선택이다 — 깨진 프레임 하나가 통화를 끝내는 것보다
무시하고 세션을 유지하는 편이 낫고, 진짜 치명적 오류라면 서버가 소켓을 닫는다.

## K3. 레퍼런스 정정 — codex는 미디어에 WebRTC를 쓴다

사용자 지적으로 확인했다. 앞 절의 "codex처럼 하면 안 끊긴다"는 서술은 **부정확했다.**

- codex 미디어 평면: 브라우저/웹뷰가 `RTCPeerConnection`, 마이크 트랙, `oai-events` 데이터 채널을 소유한다
  (아키텍처 문서 50-76행, `realtime_conversation.rs:571-620`).
- codex 제어 평면만 sideband WebSocket이다.
- **GStreamer는 쓰지 않는다.** 저장소 전체에서 `codex-rs` 관련 히트가 없다
  (bazel wine 테스트, bubblewrap 데모, antigravity 심볼 덤프만 잡힌다).
- 네이티브 `codex-realtime-webrtc` 크레이트(macOS `libwebrtc 0.3.26`)는
  2026-07-16 `b93dcf341`에서 **제거**됐다. 미디어를 클라이언트로 완전히 넘긴 구조다.

progrok은 단일 WS에 PCM과 제어를 같이 싣는다. 구조가 다르다.

**따라서 이식 범위를 좁힌다.** 가져오는 것은 `protocol_v2.rs:74-77`과 `methods.rs:522-527`의
**관용적 파싱 패턴 하나뿐**이며, 이는 미디어 평면과 무관하므로 유효하다.
WebRTC 전환이나 재연결 설계는 이번 범위가 아니다.

## K4. 진단 분리 (다음 단위 판단 기준)

이번 수정 후에도 통화가 끊긴다면 원인이 다르다는 뜻이다. 구분 방법:

- 이벤트 로그에 `unsupported:*`만 찍히고 통화가 유지되면 → 이번 버그가 원인이었다.
- 소켓 close 코드가 찍히며 끊기면 → 전송 계층 문제다. 그때 xAI Realtime의 WebRTC 지원 여부와
  `resumption` 실제 동작을 조사해 구조를 정한다. `sessionUpdate()`는 이미
  `resumption: { enabled: true }`를 보내고 있다.

구조를 먼저 바꾸면 어느 쪽이 원인이었는지 확인할 수 없다.

