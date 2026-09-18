# wp14 CHECK — c-2 부분 증거 검증 기록

계획: `050_c2_evidence.md`. 계획 감사 6회 (FAIL ×5 / PASS).
구현은 쓰기 범위가 겹치지 않는 두 서브에이전트에 병렬 파견했다 (A·B / D·헬퍼).

## 결론부터

**`c-2` 는 여전히 `open` 이다.** 이 단위는 기준을 닫지 않는다. 검증 가능한 부분을 덮고,
남은 부분이 무엇인지 정확히 적는 것이 목적이었다.

| 부분 | 상태 |
|---|---|
| A. 연결 상태 9종이 화면에 구분되어 렌더된다 | **테스트로 증명** |
| B. 분석기 데이터가 막대를 움직인다 | **테스트로 증명** |
| D. 스트림 → 분석기 → 미터 배선이 이어진다 | **테스트로 증명** |
| C. 실제 마이크 장치 오디오가 그 배선에 흐른다 | **미관측** |

## 새 테스트

| 파일 | 줄 | 내용 |
|---|---|---|
| `tests/voice-panel.test.ts` | 168 | A: `VoiceStatus` 9종 전부의 `dataset.state`·문구·고유성·`detail` 덮어쓰기 |
| `tests/voice-meter-render.test.ts` | 219 | B: 무음/상승/단조성/어택-릴리즈/`dispose`/감소모션 6종 |
| `tests/voice-wiring.test.ts` | 432 | D: `start()` 성공·실패 경로 9건 |
| `tests/helpers/fake-voice-dom.ts` | 101 | 가짜 DOM. 패널 테스트에서 추출해 배선 테스트와 공유 |

260 → **276**.

## 검증 출력

```
npm run typecheck exit=0
node scripts/run-tests.mjs -> suites 43 / tests 276 / pass 276 / fail 0

git status --short -- src/   -> (빈 출력)
git diff -- src/             -> (빈 출력)
git diff --cached -- src/    -> (빈 출력)
```

프로덕션 코드는 한 줄도 바뀌지 않았다. 세 명령을 다 본 이유는 5차 감사가
`git diff --stat` 만으로는 staged 와 untracked 를 놓친다고 지적했기 때문이다.

## mutation 으로 RED 확인

통과하는 것만 보고 넘어가면 테스트가 아니라 장식이다. 둘 다 **신규 파일만 단독 실행**했다.
전체 스위트가 빨개지는 건 증명이 아니다 — 기존 `voice-meter.test.ts:42-48` 이 같은 변이를
이미 잡기 때문이다.

```
# voice-meter.ts 의 ATTACK/RELEASE 를 뒤바꾸고 tests/voice-meter-render.test.ts 만 실행
-> 6개 중 1개 실패
   "attacks faster than it releases from an independently warmed peak"
   expected attack 2 to exceed release 7

# attachOutput 이 예외를 던지게 하고 tests/voice-wiring.test.ts 실행
-> D-1~D-7 통과, D-8 만 실패 (failed !== listening)
```

두 번째가 특히 중요하다. 5차 감사가 "배선 단언만 보면 반쪽 실패를 못 잡는다" 고 지적해서
D-8(최종 상태 `listening`)을 넣었는데, 실제로 그것만 실패한다.

어택/릴리즈 단언은 1프레임 비교를 쓰지 않는다. 감사가 실측하니 상수를 뒤바꿔도
`rise=2 > fall=1` 로 통과했다. peak 까지 예열한 뒤 독립 표본으로 비교한다.

## 하네스가 실제로 쓴 가짜 표면

계획은 이 목록이 완전하다고 **주장하지 않았다.** 같은 표를 두고 "이 목록이 전부" 라고
세 번 썼다가 세 번 다 감사가 빠진 항목을 찾아냈기 때문이다 (`isSecureContext`,
정적 `WebSocket.OPEN`, `WebSocket.send`). 그래서 구현은 `start()` 를 돌려
`TypeError` 가 날 때마다 표면을 추가하는 식으로 했고, 최종 목록을 여기 기록한다.

- `window`: `isSecureContext`, `AudioWorkletNode`, `addEventListener`,
  `setInterval`/`clearInterval`, `setTimeout`/`clearTimeout`
- `navigator`: `onLine`, `mediaDevices.getUserMedia`
- `MediaStream`: `getAudioTracks`, `getTracks` / 트랙: `label`, `enabled`, `stop`
- `fetch`: `/v1/realtime/client_secrets` 성공·실패 응답
- `WebSocket`: 정적 `OPEN`/`CLOSING`, `readyState`, `binaryType`, `addEventListener`,
  `send`, `close`, 테스트가 `open` 직접 발생
- `AudioContext`: `destination`, `state`, `audioWorklet.addModule`,
  `createMediaStreamSource`, `createAnalyser`, `createGain`, `close`
- 노드: `connect`, `disconnect`, gain 의 `gain.value`
- analyser: `fftSize`, `smoothingTimeConstant`, `frequencyBinCount`, `disconnect`
- `AudioWorkletNode`: `port.onmessage`, `connect`, `disconnect`
- `VoiceMeter`: `attachInput`, `attachOutput`, `resetOutput`, `dispose`
- `VoicePanel.createMeter`: 테스트 동안만 가짜 미터 반환

전역 스텁은 각 테스트가 끝날 때 원래 descriptor 로 되돌린다.

## c-2 를 닫는 방법

```
progrok login
progrok chat          # :18646
# 마이크 권한 승인 후 말하면서 입력 미터가 움직이는지 확인
```

권한 승인은 사람이 눌러야 한다. 지금은 `progrok status` 가 `Not logged in` 이라
라이브 세션조차 띄울 수 없다. 사용자가 이전에 직접 확인했다고 보고했지만 그건 사용자
진술이지 내 관측이 아니다. 둘을 섞지 않는다.

## 감사가 잡은 내 오류 (기록용)

계획 감사 6회 중 5회가 FAIL 이었다. 같은 실수의 반복이 있었다.

1. "C 는 브라우저 배선이라 우리 코드가 아니다" — **정반대였다.** `getUserMedia`(91),
   `createMediaStreamSource`(221), `createAnalyser`(231-233), `connect`(234),
   `attachInput`(239) 전부 이 저장소 코드다. 그래서 D 를 신설했다.
2. A·B 만 통과시키고 c-2 를 `met` 으로 바꾸려 했다 — **기준 약화**다. 이전 단위의
   `071_wp5_plan.md:178` 이 이미 "정적 테스트는 마이크 반응을 증명하지 않으므로 met 으로
   표시하지 않는다" 고 못 박아 뒀는데 내가 그걸 뒤집으려 했다.
3. 문서 안에서 "open 으로 남긴다" 와 "met 로 바꾸면서" 가 공존했다.
4. "mint 경로에서 멈춰도 6개 전부 확인된다" — 정반대. 배선은 `onOpen` 안에 있어서
   mint 실패면 `createMediaStreamSource` 조차 안 불린다.
5. **"이 목록이 전부" 를 세 번 쓰고 세 번 틀렸다.** 산문으로 브라우저 표면을 완전히
   열거하려던 방법 자체가 틀렸다. 실행이 알려주게 하는 방식으로 바꿨다.
6. D-6 "권한 거부 시 스트림 정리" — 거부되면 정리할 스트림 자체가 없다. 증명 대상이
   없는 단언이었다. 6a/6b 로 갈랐다.
7. 줄번호 오류 6건.

