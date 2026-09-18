# wp11 검증 기록 — 모듈화

## 분할 결과

| 파일 | 이전 | 이후 |
|---|---:|---:|
| `src/voice/ws-client.ts` | 438 | **9** (facade) |
| `src/voice/ws-socket.ts` (신설) | — | 248 |
| `src/voice/stt-session.ts` (신설) | — | 140 |
| `src/voice/tts-session.ts` (신설) | — | 78 |
| `src/web/client/voice.ts` | 595 | **549** |
| `src/web/client/voice-session.ts` (신설) | — | 55 |
| `src/wire/tool-calls.ts` | 458 | 458 (분할 안 함) |

## 구조

```
ws-client.ts (facade, 9줄)
  └─ re-export ─> ws-socket.ts (transport leaf)
                  stt-session.ts ──> ws-socket.ts
                  tts-session.ts ──> ws-socket.ts
```

순환 없음. 세션은 전송을 참조하고 전송은 아무도 참조하지 않는다.
`StreamingSampleRate`는 두 세션이 공유하므로 전송 leaf 로 올렸다.

기존 소비자(`src/voice/realtime.ts:6`, `tests/voice-ws.test.ts:15`)는 경로를 바꾸지 않았다.

## tool-calls.ts 를 분할하지 않은 이유

358줄이 `ToolCallAssembler` 단일 클래스이고 헬퍼 7개가 전부 그 클래스를 위한 것이다.
클래스를 쪼개려면 조립 상태(`PendingCall` 맵)를 여러 객체로 나눠야 하는데 그건
순수 이동이 아니라 동작 위험을 지는 재설계다. 파일 크기는 SCAF §9의 split *smell*이지
게이트가 아니며(cxc-dev §0.2: 파일 크기 임계는 DEFAULT), 단일 책임이 458줄이면 그대로 두는 것이 맞다.

## voice.ts 를 549줄에서 더 줄이지 않은 이유

진단 렌더(`renderMute`, `renderElapsed`, `recordEvent`)와 이벤트 분기는
`#muted`, `#stream`, `#startedAt`, `#playback`, `setStatus` 등 private 상태에 결합돼 있다.
밖으로 빼면 주입 보일러플레이트가 제거한 줄보다 길어진다. 줄 수를 맞추려고
인위적 계층을 만드는 것은 SCAF §9의 의도가 아니다.

## 신설: tests/module-boundaries.test.ts

4개 검사.

1. facade 가 `openVoiceSocket`, `createSttSession`, `createTtsSession`,
   `ephemeralProtocols`, `reduceSttEvent` 를 계속 export 하는지 (런타임 import)
2. 브라우저 voice 클라이언트의 `VoiceController`와 `buildVoiceSocketSpec` export 유지
3. 세션 모듈이 facade 를 역참조하지 않는지 (순환 방지)
4. **레이어 방향**: `src/` 전체를 읽어 간선을 추출하고 허용 목록과 대조.
   `auth ↔ utils`는 명시적 예외로 두고 해소 시 제거한다. 새 역방향 간선은 실패.

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 248 / pass 248 / fail 0 (신규 4건)
- `npm run build` 성공, `dist/public/assets/app.js` 생성 확인
- CLI 스모크 `node dist/index.js --version` 동작

