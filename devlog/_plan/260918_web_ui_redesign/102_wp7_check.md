# wp7 검증 기록 — 라이브 보이스 견고성

## 근본 원인 (코드로 확정)

| 단계 | 위치 |
|---|---|
| 모르는 이벤트 타입 → throw | `src/voice/protocol.ts:242` |
| 필드 타입 불일치 → throw | `protocol.ts:139-159` (`record`/`stringField`/`numberField`/`integerField`) |
| STT도 동일 | `protocol.ts:177-186` |
| catch → fail() | `voice.ts onMessage` |
| fail() → 소켓 종료 | `closeSocket()` + `stopMedia()` |

웹소켓이 불안정한 게 아니라 **클라이언트가 스스로 통화를 끝내고 있었다.**

## 레퍼런스 (macbookpro-2에서 최신화 후 확인)

`120_codex-cli` 서브모듈이 openai/codex origin/main보다 **495커밋 뒤처져** 있어 FF 머지했다
(`095da4b7e` → `7498521d2`).

- 관용적 파싱: `protocol_v2.rs:74-77` `_ => { debug!(...); None }`,
  `methods.rs:522-527` 모르는 프레임은 로그만 남기고 루프 유지.
- 재시도는 연결 수립(sideband join)에만: `methods.rs:739-762` 지수 백오프.
- **정정**: 최신 main에는 `third_party/voice`가 있고 GStreamer + Opus 기반 네이티브 오디오 런타임
  소스를 번들링한다(`ce7fbb373` "Bundle native voice runtimes in Windows releases").
  단 README가 "컴파일·링크·음성 활성화는 별도 단계"라고 명시하므로 현재 main은 소스 고정 단계까지다.
  앞선 문서(2026-07-24 스냅샷) 기준으로 "GStreamer 없음"이라고 한 서술을 철회한다.

## 변경

| 파일 | 내용 |
|---|---|
| `src/voice/protocol.ts` | `tryParseRealtimeServerEvent`, `tryParseSttServerEvent`, `safeEventLabel` 추가. **엄격 파서는 보존** |
| `src/web/client/voice.ts` | `onMessage`가 관용 파서를 쓰고 `null`이면 로그만 남긴다. `catch → fail()` 제거 |
| `tests/voice-tolerant-parse.test.ts` | 신설 10건 |
| `README.md`, `skills/progrok/SKILL.md`, harness | `grok-code-fast-1` 제거 |

## 테스트로 고정한 경계

| 입력 | 결과 |
|---|---|
| 모르는 타입 | `null` (엄격 파서는 여전히 throw) |
| 알려진 타입 + 필드 불일치 | `null` |
| JSON 아님 | `null` |
| 정상 `type:"error"` | 파싱됨 → 실패 처리 유지 |
| **malformed error** | `null` — 의도적 선택. 깨진 프레임이 통화를 끝내는 것보다 낫고, 치명적이면 서버가 소켓을 닫는다 |
| 로그 라벨 | 허용 문자 `[a-zA-Z0-9._-]`, 48자 절단, 그 외 고정값 `unsupported` |

`safeEventLabel(JSON.stringify({type:"evil<script>alert(1)</script>"}))` →
`unsupported:evilscriptalert1script`.

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 244 / pass 244 / fail 0 (신규 10건)

## 카탈로그 정정

로그인 후 받은 실제 카탈로그 12개에 `grok-code-fast-1`이 없다.
wp6에서 opencodex 목록을 근거로 추가했으나 이 계정 `/v1/models`에는 내려오지 않아 제거했다.
`grok-composer-2.5-fast`도 목록에 없으나 README가 이미 그 사실을 적고 있어 유지했다.

## UNVERIFIED

**실제 통화에서의 수정 검증.** 검증 직전 `~/.progrok/auth.json`이 사라져 세션이 끊겼다.

- progrok 코드가 지운 것이 아니다: `deleteTokens()` 호출처는 `src/commands/logout.ts` 하나뿐이고
  실행하지 않았다. `writeTokensAtomic`은 임시 파일 → `renameSync` 원자적 교체이며
  실패 시 `rmSync(tmp)`로 임시 파일만 지운다. 웹앱 SIGINT 핸들러는 서버만 닫는다.
- 원인은 progrok 바깥이며 현재 증거로는 특정할 수 없다.

로그인 후 확인할 것: (1) 이벤트 로그에 `unsupported:*`가 찍히며 통화가 유지되는가,
(2) c-2 마이크 미터 반응, (3) 그래도 끊긴다면 소켓 close 코드.
(3)의 결과가 있어야 전송 계층 구조 변경(WebRTC/코덱) 논의에 근거가 생긴다.

