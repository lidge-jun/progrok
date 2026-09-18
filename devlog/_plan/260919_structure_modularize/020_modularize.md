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

