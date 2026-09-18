# wp3 검증 기록

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 234 / pass 234 / fail 0 (신규 7건: `tests/voice-meter.test.ts`)

## 실제 브라우저에서 확인한 것 (하네스, backend: mock)

Voice 탭 → Start 클릭 후 관측값:

| 항목 | 관측 | 판정 |
|---|---|---|
| 마이크 권한 | 실제로 승인됨 (디바이스 라벨 취득) | checked |
| `#voice-device-row` | shown, 실제 트랙 라벨 | checked |
| `#voice-endpoint` | `api.x.ai` (호스트만. 시크릿·토큰 미노출) | checked |
| `#voice-elapsed` | `0:00`부터 실측 | checked |
| `#voice-network-row` | shown | checked |
| `#voice-rate-row` | hidden — `onOpen`이 완료되지 않았으므로 표시하지 않음 | checked (정직) |
| `#voice-event-row` | hidden — 수신 이벤트 0건 | checked (정직) |
| 미터 바 | `data-level` 미설정 — analyser가 붙지 않았으므로 움직이지 않음 | checked (가짜 모션 없음) |
| 상태 칩 | `data-state="failed"` + "Voice WebSocket failed." | checked |
| mute 버튼 | 실패 후 스트림 정리와 함께 숨김 | checked |

하네스는 가짜 one-use 시크릿을 발급하므로 브라우저가 실제 `wss://api.x.ai`에 붙는 순간 거절된다.
CSP `connect-src`가 `wss://api.x.ai`로 고정돼 있어 음성 소켓은 모의할 수 없다(005 B6).

## UNVERIFIED

**실제 오디오 신호에 대한 미터 모션은 검증하지 못했다.**

- 시도: `node dist/index.js chat`로 실제 앱(:18646)을 띄워 라이브 세션으로 확인하려 했다.
- 차단: `Not logged in. Run `progrok login` first.` — 저장된 OAuth 토큰이 만료 상태다
  (`progrok status`: Logged in / Token: expired / Refresh: available).
- 재인증은 사용자 조작이 필요한 플로우이므로 임의로 실행하지 않았다.
- 현재 확보된 증거: 레벨 산출 수학의 단위 테스트 7건(clamp 상한 1.0, noise floor, 양자화 정수성,
  attack>release, 밴드 경계, 무음 입력이 step 0), 그리고 analyser가 없을 때 바가 움직이지 않는다는 실측.
- 남은 미검증: 실제 마이크 신호 → `getByteFrequencyData` → `data-level` → CSS `scaleY` 전체 경로.

정적 코드 검토로 이 항목을 대체하지 않는다 (FE-VISUAL-REPORT-01).

## 구현 요약

| 파일 | 변경 |
|---|---|
| `client/voice-meter.ts` (신규) | 순수 함수 6개 + rAF 1개 루프. reduced-motion이면 루프 미생성 |
| `client/pcm-playback.ts` | bus `GainNode` + `analyser`, `dispose()` |
| `client/voice.ts` | 입력 analyser 병렬 연결, meter 배선/수명주기, mute, 경과시간, 이벤트 로그, transport rows, 에러 분기, 인터럽션 표시, 트랜스크립트 자동 추종 |
| `client/contracts.ts` | `VoiceStatus`에 `responding` 추가 |
| `client/app.ts` | 보이스 엘리먼트 20개 배선 |
| `public/style.css` | `--level` 제거, `data-level` 13단계 정적 규칙, `responding` 칩 상태 |
| `tests/voice-meter.test.ts` (신규) | 레벨 산출 회귀 테스트 7건 |

