# wp11 — 코드베이스 모듈화

## 원칙

**동작을 바꾸지 않는다.** 순수 이동 + import 정리만. 테스트 244건이 그대로 통과해야 한다.
줄 수를 맞추려고 주입 계층을 만들지 않는다 (000_roadmap.md M3).

## 대상

### voice.ts (595줄)

무상태 헬퍼만 분리한다. 상태 결합 메서드는 그대로 둔다.

| 분리 | 대상 |
|---|---|
| `src/web/client/voice-session.ts` (신설) | `sessionUpdate()` 페이로드 빌더를 순수 함수로 |
| `src/web/client/voice-errors.ts` (신설) | `describeMediaError()` |

목표 약 540줄. 그 이상 줄이려면 주입 보일러플레이트가 더 길어지므로 하지 않는다.

### tool-calls.ts (458줄), ws-client.ts (438줄)

**P 단계에서 실제로 읽고 책임 경계를 도출한다.** 로드맵의 후보는 추측이었으므로 철회됐다.
읽은 뒤 분할이 가치 없다고 판단되면 하지 않고 그 이유를 기록한다.

## 신설: tests/module-boundaries.test.ts

1. **facade export 존재**: `voice.js`에서 `VoiceController`, `buildVoiceSocketSpec` import 가능
2. **레이어 방향**: `src/` 전체를 읽어 레이어 간선을 추출하고 허용 목록과 대조.
   `auth ↔ utils`는 명시적 예외(해소 시 제거). 새 역방향 간선은 실패.

## 검증

- `npm run typecheck`
- `node scripts/run-tests.mjs` → 244건 + 신규 유지
- `npm run build` → `dist/public/assets/app.js` 생성 확인
- 웹앱 실제 부팅 확인 (필수 DOM ID 로드)


---

# wp11 P 재검증 — 실제 코드를 읽고 경계를 도출

로드맵의 후보(citation 추출, 프로토콜 디스패치)는 추측이었고 철회됐다. 실제 구조는 이렇다.

## ws-client.ts (438줄) — 두 관심사가 한 파일에

| 범위 | 관심사 |
|---|---|
| 18-245 | **WebSocket 전송**: 상수, `VoiceSocket` 타입, 프레임 큐, 핸드셰이크, `openVoiceSocket()` |
| 247-438 | **STT 세션**: `StreamingSttOptions`, URL 빌더, `reduceSttEvent`, `createSttSession()` |

두 번째가 첫 번째를 쓰지만 반대는 아니다. 깨끗한 분할선이다.

**계획**: `src/voice/stt-session.ts` 신설로 247-438 이동.
`ws-client.ts`는 약 245줄로 줄고 전송만 남는다.
`src/voice/stt.ts`가 기존 경로로 계속 import 할 수 있도록 `ws-client.ts`에서 re-export 한다.

## tool-calls.ts (458줄) — 분할하지 않는다

| 범위 | 내용 |
|---|---|
| 3-94 | 상수, 에러 클래스, 옵션/상태 타입, 검증 헬퍼 7개 |
| 96-453 | `ToolCallAssembler` 클래스 하나 |
| 455-458 | 헬퍼 1개 |

**분할 대상이 없다.** 358줄이 단일 클래스이고 헬퍼는 전부 그 클래스를 위한 것이다.
클래스를 쪼개려면 조립 상태(`PendingCall` 맵)를 여러 객체로 나눠야 하는데,
그건 순수 이동이 아니라 동작 위험을 지는 재설계다. **하지 않는다.**

파일 크기는 SCAF §9의 split *smell*이지 게이트가 아니다(cxc-dev §0.2: 파일 크기 임계는 DEFAULT).
단일 책임이 458줄이면 그대로 두는 것이 맞다. 이 판단을 structure 에 기록한다.

## voice.ts (595줄) — 무상태 헬퍼만

`sessionUpdate()`는 `this.el.voice.value` 하나만 읽는다. 순수 함수로 뽑을 수 있다.
`describeMediaError()`는 이미 모듈 스코프다.

**계획**: `src/web/client/voice-session.ts`에 `buildSessionUpdate(voice: string)`와
`describeMediaError()`를 옮긴다. 약 55줄 감소.

진단 렌더와 이벤트 분기는 private 상태 결합이 커서 옮기지 않는다(000_roadmap M3).

## 요약

| 파일 | 조치 | 결과 |
|---|---|---|
| `voice/ws-client.ts` | STT 세션 분리 | 438 → ~245 |
| `web/client/voice.ts` | 무상태 헬퍼 분리 | 595 → ~540 |
| `wire/tool-calls.ts` | **분할 안 함** (단일 클래스, 근거 기록) | 458 유지 |

## 신설: tests/module-boundaries.test.ts

020_modularize.md 계획대로. facade export 존재 + 레이어 방향 허용목록(010 O5).


---

# wp11 감사 반영 (A-phase fold)

## P1. 분할선 정정 — STT는 247-373, TTS가 375-438

`247-438 전체`가 STT라는 서술은 틀렸다. 실제로는 STT와 TTS 두 세션이 들어 있다.
STT만 옮기면 `ws-client.ts`는 ~310줄이 된다.

## P2. re-export 는 순환을 만든다 — facade 구조로 바꾼다

`stt-session.ts`가 `openVoiceSocket`을 쓰는데 `ws-client.ts`가 다시
`stt-session.ts`를 re-export 하면 **순환 import** 가 된다.

**구조 변경**: 전송 구현을 leaf 로 빼고 `ws-client.ts`를 facade 로 만든다.

```
src/voice/
  ws-socket.ts     (신설, leaf)  전송: 상수, VoiceSocket, 프레임 큐, 핸드셰이크, openVoiceSocket
  stt-session.ts   (신설)        ws-socket.ts 만 참조
  tts-session.ts   (신설)        ws-socket.ts 만 참조
  ws-client.ts     (facade)      위 셋을 re-export. 아무도 이 파일을 참조하지 않음
```

의존 방향이 한쪽이다: `ws-client → {ws-socket, stt-session, tts-session} → ws-socket`.
순환 없음.

## P3. 기존 소비자 전부 보존

`tests/voice-ws.test.ts`가 `createTtsSession`도 소비한다. facade 가
전송·STT·TTS **전부**를 re-export 하므로 기존 import 경로가 그대로 동작한다.
계획했던 "STT만 re-export" 는 불충분했다.

## 수정된 요약

| 파일 | 조치 | 결과 |
|---|---|---|
| `voice/ws-socket.ts` | 신설 (전송 leaf) | ~245 |
| `voice/stt-session.ts` | 신설 | ~127 |
| `voice/tts-session.ts` | 신설 | ~64 |
| `voice/ws-client.ts` | facade 로 축소 | ~10 |
| `web/client/voice-session.ts` | 신설 (무상태 헬퍼) | ~55 |
| `web/client/voice.ts` | 헬퍼 제거 | 595 → ~540 |
| `wire/tool-calls.ts` | 분할 안 함 | 458 유지 |

## 검증 추가

- `rg 'from .*ws-client'` 소비자 전원이 계속 동작
- 순환 없음을 `tests/module-boundaries.test.ts`가 파일 단위로도 검사

