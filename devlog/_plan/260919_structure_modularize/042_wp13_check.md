# wp13 CHECK — 모듈화 잔여 검증 기록

계획: `040_modularize_rest.md`. 계획 감사 4회 (FAIL / FAIL / FAIL / PASS).
구현은 쓰기 범위가 겹치지 않는 두 서브에이전트에 병렬 파견했다 (wire / web-client).

## 줄 수

| 파일 | 전 | 후 |
|---|---|---|
| `src/web/client/voice.ts` | 549 | **388** |
| `src/web/client/voice-panel.ts` | — | 248 (신규) |
| `src/wire/tool-calls.ts` | 458 | **201** |
| `src/wire/pending-call-registry.ts` | — | 220 (신규) |
| `src/wire/tool-call-wire.ts` | — | 79 (신규) |
| `tests/voice-panel.test.ts` | — | 232 (신규) |

c-13 이 말한 400줄 초과 모듈 세 개가 모두 400 아래로 내려왔다. 다만 **줄 수는 결과이지
목표가 아니었다** — 계획은 3차 감사 후 줄 수 목표를 명시적으로 철회했고, 합격 기준은
아래 기계적 검사였다.

## 기계적 합격 기준 (직접 실행)

```
rg -c "this\\.el\\." src/web/client/voice.ts                      -> 0
rg -c "WebSocket|MediaStream|AudioContext" src/web/client/voice-panel.ts -> 0
rg -n 'from "./voice.js"' src/web/client/voice-panel.ts          -> none
rg -n 'from "./tool-calls.js"' src/wire/tool-call-wire.ts src/wire/pending-call-registry.ts -> none
```

`this.el.` 0건이 이 분할이 진짜라는 증거다. `VoiceController` 는 이제 `VoiceElements` 를
한 번도 직접 만지지 않는다. DOM 은 `VoicePanel` 이 전부 소유하고, 컨트롤러는 소켓·오디오
그래프·세션 생명주기만 본다.

## 공개 계약 보존

```
git diff --stat -- src/wire/chat-stream.ts src/wire/responses-stream.ts \
                   tests/tool-calls.test.ts src/web/client/app.ts
-> (출력 없음)
```

네 파일 모두 **변경 0줄**이다. `ToolCallWireError` 는 `tool-call-wire.js` 로 내려갔지만
`tool-calls.js` 가 재수출하므로 기존 import 가 전부 살아 있다. `VoiceElements` 도
`voice-panel.ts` 로 옮겼지만 `voice.ts` 가 재수출한다.

## 검증 출력

```
npm run typecheck exit=0
npm run build     exit=0
node dist/index.js --version -> 3.0.0
node scripts/run-tests.mjs   -> tests 260 / suites 41 / pass 260 / fail 0
```

248 → 260. 패널 동작 회귀 7건 + 경계 5건이 늘었다.

## 새 경계 테스트

`tests/module-boundaries.test.ts` 의 레이어 방향 검사는 **같은 레이어 안의 import 를
건너뛴다.** 이번 신규 파일들은 전부 같은 레이어라 그 검사에 안 걸린다. 그래서 별도
assertion 5개를 넣었다 — 3차 감사가 짚은 대로다.

- `voice-panel.ts` 가 `./voice.js` 를 되짚지 않는다
- `voice-panel.ts` 에 `WebSocket`/`MediaStream`/`AudioContext` 가 없다
- `voice.ts` 에 `this.el.` 이 없다
- `tool-call-wire.ts`/`pending-call-registry.ts` 가 `./tool-calls.js` 를 되짚지 않는다
- `tool-calls.js` 가 `ToolCallAssembler`, `ToolCallWireError`,
  `DEFAULT_MAX_TOOL_CALL_BYTES` 를 계속 내보낸다

경계를 문서가 아니라 **테스트로** 고정했으므로, 나중에 누가 역참조를 넣으면 CI 가 잡는다.

### 그 테스트가 처음엔 가짜였다

구현 검증 리뷰어가 마지막 검사를 **mutation 으로 깨뜨려 보고** false-green 임을 증명했다.
원래 `assert.match(source, /ToolCallWireError/)` 로 **소스 문자열**을 봤는데, 그 이름은
import 줄(`tool-calls.ts:10`)과 `throw` 문에도 나오므로 재수출(`:13`)만 지워도 테스트가
그대로 통과했다. 정작 `npm run typecheck` 는 `TS2459` 로 실패하는 상태였다.

소스 정규식 대신 **모듈을 실제로 import 해서** export 를 확인하도록 고쳤다.
직접 재현한 결과:

```
# 체크아웃 사본에서 tool-calls.ts:13 의 재수출 한 줄만 제거
node --import tsx --test tests/module-boundaries.test.ts
  -> ERR_ASSERTION  actual: 'undefined'  expected: 'function'
```

이제 RED 가 된다. 교훈: **경계 테스트도 한 번은 깨뜨려 보고 빨간불을 확인해야 한다.**
통과하는 것만 보고 넘어가면 테스트가 아니라 장식이다.

## 테스트하지 않은 것

`VoicePanel.createMeter()` 는 회귀 테스트에서 뺐다. `AnalyserNode` 없는 가짜 DOM 에서는
의미 있는 단언을 만들 수 없다. 생성 → `attachInput` → `attachOutput` 호출 순서는
코드 리뷰로만 확인했고, 실제 동작은 마이크 권한이 필요해 브라우저에서만 볼 수 있다.

## 계획 감사가 무너뜨린 내 설계 (기록용)

리뷰어가 4회에 걸쳐 잡은 것이다. 절반이 "측정을 안 하고 썼다" 였다.

1. `voice.ts` 를 400줄 미만으로 만든다 — 산술적으로 불가능했다. 목표를 철회했다.
2. 패널로 옮길 멤버는 `this.el` 만 만진다 — `renderNetwork` 도 `#stream` 을 읽었다.
3. 패널 추출이 렌더링 책임 경계다 — 아니었다. 컨트롤러가 7곳에서 같은 DOM 을 계속 썼다.
   범위를 "DOM 의 유일한 소유자" 로 넓히고 나서야 경계가 됐다.
4. DOM **읽기**(mode/model/voice/meter/available)를 아예 세지 않았다.
5. `#muted` 를 패널로 옮긴다면서 동시에 인자로 넘긴다고 해 소유권이 모순이었다.
6. `voice.ts:110-118` 을 컨트롤 바인딩이라 했는데 `:118` 은 이미 `window.online` 이었다.
7. 컨트롤러의 `#status` 읽기를 한 곳이라 했는데 네 곳이었다.
8. `tool-calls.ts` 를 검증 헬퍼 이동으로 자르려 했다 — 얕은 이동이었다. 진짜 경계는
   별칭 레지스트리였고, 그마저 `resolveDelta` 를 빠뜨려 자족적이지 않았다.
9. 줄번호 오류 8건.

교훈은 하나다. **줄번호와 의존 관계는 쓰기 전에 실행해서 확인한다.**
