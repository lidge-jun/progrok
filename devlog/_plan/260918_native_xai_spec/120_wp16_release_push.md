# WP16 — 릴리스 준비와 origin push

## 현재 상태와 범위

2026-09-18 기준 저장소 사실:

- `package.json`과 `package-lock.json`의 package version은 `2.0.4`다.
- `HEAD`, `origin/main`, tag `v2.0.4`는 현재 `8dc1afb`로 일치한다.
- 저장소에 `CHANGELOG.md`는 없다.
- `scripts/release.sh`와 `scripts/release-preview.sh`는 npm publish, commit, tag,
  push, GitHub Release를 한 흐름으로 수행한다.
- 이번 단계는 source release 준비와 origin push까지만 한다. **npm publish,
  npm dist-tag 변경, Git tag 생성/푸시, GitHub Release 생성은 범위 밖이다.** 따라서
  두 release script를 실행하지 않는다.

## 버전 정책

기본 다음 버전은 **2.1.0**이다.

근거:

- 네이티브 auth/transport/wire 구현과 Voice/Responses WS, 웹앱은 큰 기능 추가다.
- localhost HTTP `/v1/*`, CLI command 이름, `~/.progrok/auth.json` 경로/스키마를
  호환 유지하므로 계획상 public breaking change가 아니다.
- patch `2.0.5`는 기능 폭을 표현하지 못하고, major `3.0.0`은 현재 계획의
  호환성 약속과 맞지 않는다.

단, 최종 diff가 다음 중 하나를 포함하면 version bump를 실행하지 말고 `3.0.0`으로
재판정한다: 기존 CLI 제거/rename, 기존 HTTP request/response의 비호환 변경,
`~/.progrok/auth.json` 무마이그레이션 schema 변경, Node engine 상향, 기존 proxy
placeholder-auth 계약 제거.

## 변경 명세

### MODIFY — `package.json`

Before:

```json
"version": "2.0.4"
```

After:

```json
"version": "2.1.0"
```

직접 한 파일만 고치지 말고 검증이 모두 녹색인 frozen head에서 다음 명령으로 lockfile과
동시에 갱신한다.

```bash
npm version 2.1.0 --no-git-tag-version
```

### MODIFY — `package-lock.json`

Before:

```json
{
  "name": "progrok",
  "version": "2.0.4",
  "packages": {
    "": {
      "name": "progrok",
      "version": "2.0.4"
```

After:

```json
{
  "name": "progrok",
  "version": "2.1.0",
  "packages": {
    "": {
      "name": "progrok",
      "version": "2.1.0"
```

transitive dependency의 우연한 `2.0.4` 문자열은 바꾸지 않는다.

### NEW — `CHANGELOG.md`

현재 changelog 파일이 없으므로 Keep a Changelog 형식의 첫 파일을 만든다. 과거 release를
소급 창작하지 않고 현재 tag와 이번 release만 기록한다.

```md
# Changelog

All notable changes to progrok are documented here.

## [2.1.0] - 2026-09-18

### Added

- Native typed auth, transport, SSE, Chat, and Responses protocol cores.
- Responses, realtime voice, streaming STT, and streaming TTS WebSocket surfaces.
- Native Voice REST clients, remaining xAI REST surfaces, and the local web app.
- Offline contract suites and opt-in OAuth live smoke verification.

### Changed

- Replaced conditional byte passthrough with canonical request and typed-event handling where parsing adds correctness.
- Kept validated passthrough for binary, multipart, and unknown future endpoints.
- Updated public documentation and the packaged skill to the 2026-09-18 xAI surface.

### Compatibility

- Preserved the path and schema of `~/.progrok/auth.json`; ima2-gen v3.16.1 shares only this credential file.
- Preserved the existing localhost HTTP and CLI entry points.

## [2.0.4] - 2026-09-18

- Previous published release. See Git history and tag `v2.0.4` for details.

[2.1.0]: https://github.com/lidge-jun/progrok/compare/v2.0.4...main
[2.0.4]: https://github.com/lidge-jun/progrok/releases/tag/v2.0.4
```

`2.1.0`이 tag/publish되기 전에는 compare link 끝을 `main`으로 둔다. npm/GitHub release
후 별도 작업에서 `v2.1.0`으로 바꾼다.

### NO CHANGE — `scripts/release.sh`, `scripts/release-preview.sh`

두 스크립트는 `npm publish`를 내장하므로 이번 단계에서 실행하거나 부분 재사용하지 않는다.
이번 source push를 위해 `--no-publish` 분기를 급히 추가하지 않는다. publish workflow
분리는 별도 릴리스 엔지니어링 작업으로 다룬다.

## 단계별 원자 커밋 전략

구현자는 wp 단위로 테스트가 녹색인 시점에 다음 커밋을 만든다. 이미 하나의 논리 단위로
완료된 wp를 인위적으로 더 쪼개지 않고, 서로 다른 단계의 변경을 한 커밋에 섞지 않는다.

| 순서 | 포함 범위 | 커밋 제목 |
|---|---|---|
| 1 | wp5 auth core + auth tests | `feat(auth): make OAuth refresh generation-safe` |
| 2 | wp6 transport core + transport tests | `feat(transport): add native xAI request execution` |
| 3 | wp7 wire parsers + parser tests | `feat(wire): parse xAI streaming protocols` |
| 4 | wp8 proxy rewrite + proxy regression | `feat(proxy): route HTTP and streaming through native core` |
| 5 | wp9 Voice REST + tests | `feat(voice): add native TTS and STT clients` |
| 6 | wp10 WS/realtime + tests | `feat(voice): add realtime and streaming websocket clients` |
| 7 | wp11 remaining REST surfaces + tests | `feat(api): cover remaining xAI REST surfaces` |
| 8 | wp12 CLI surface + command tests | `feat(cli): expose native xAI surfaces` |
| 9 | wp13 web app + UI/server tests | `feat(web): ship the local xAI web app` |
| 10 | wp14 test harness와 live smoke script | `test: verify native xAI contracts and OAuth smoke` |
| 11 | wp15 public docs/site/skill | `docs: document native xAI surfaces` |
| 12 | version, lockfile, changelog만 | `chore: prepare v2.1.0 source release` |

각 커밋 전 `git diff --cached --name-only`로 범위를 확인한다. 다른 작업자의 변경이나
미완성 다음 wp 파일을 stage하지 않는다. rebase, reset, force push로 범위를 정리하지 않는다.

## 푸시 전 freeze와 점검

마지막 구현 커밋 후 head를 고정한다.

```bash
FREEZE_SHA=$(git rev-parse HEAD)
git status --short
```

`git status --short`가 비어 있지 않으면 push하지 않는다. 그 다음 아래 명령을 같은
`FREEZE_SHA`에서 순서대로 실행한다.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm --prefix site ci
npm --prefix site run build
PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts
npm pack --dry-run
git diff --check
test "$(git rev-parse HEAD)" = "$FREEZE_SHA"
```

판정 규칙:

- 모든 명령이 exit 0이어야 한다. red gate를 보고서에서 사후 면제하지 않는다.
- `npm pack --dry-run` 목록에 `dist`, `skills/progrok/SKILL.md`, `README.md`,
  `LICENSE`, `THIRD_PARTY_NOTICES.md`가 있고 `.tmp`, auth 파일, smoke 로그가 없어야 한다.
- live smoke 결과는 status, duration, content type, byte length, hash, terminal event만
  포함한다. credential과 transcript 원문이 있으면 실패다.
- 점검 중 source가 바뀌면 새 SHA로 freeze하고 관련 gate를 다시 실행한다.

credential 비노출 추가 점검:

```bash
git grep -n -I -E '(xai-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,}|refreshToken"[[:space:]]*:[[:space:]]*"[^<])' -- . ':!package-lock.json'
```

fixture의 명시적 가짜 값 외 hit는 push blocker다. 실제 auth 파일 내용을 grep pattern이나
shell 변수로 출력하지 않는다.

## origin push 절차

이 단계의 실행 요청이 source push를 명시적으로 승인한 경우에만 진행한다. 승인 범위가
문서 작성뿐이면 여기서 멈춘다.

1. remote와 branch를 읽기 전용으로 확인한다.

   ```bash
   git remote get-url origin
   git rev-parse --abbrev-ref HEAD
   git ls-remote origin refs/heads/main
   ```

2. remote `main`이 freeze를 시작할 때 기준으로 삼은 remote SHA에서 움직이지 않았는지
   확인한다. 움직였으면 push하지 않고 fetch 후 충돌/새 commit을 감사한다.
3. push dry-run으로 권한과 refspec을 확인한다.

   ```bash
   git push --dry-run origin HEAD:main
   ```

4. 사용자의 명시적 승인이 유지되는 같은 세션에서 source commit만 push한다.

   ```bash
   git push origin HEAD:main
   ```

5. remote가 exact head를 가리키는지 확인한다.

   ```bash
   LOCAL_SHA=$(git rev-parse HEAD)
   REMOTE_SHA=$(git ls-remote origin refs/heads/main | awk '{print $1}')
   test "$LOCAL_SHA" = "$REMOTE_SHA"
   ```

non-fast-forward, branch protection, auth 실패가 나면 force push하지 않는다. 관찰한 오류와
local/remote SHA만 보고하고 멈춘다.

## 이번 범위 밖 후속 릴리스

다음은 별도 승인과 별도 실행 증거가 필요한 후속 작업이다.

- `npm publish` 또는 `npm publish --provenance`
- npm trusted publishing/OIDC 설정
- `v2.1.0` tag 생성과 push
- GitHub Release 생성 및 changelog link 확정
- 전역 설치 후 `progrok --version`, 로그인, proxy/webapp 실행 smoke

따라서 이번 완료 보고에서 “npm에 2.1.0이 배포됐다” 또는 “v2.1.0 release가 발행됐다”고
말하지 않는다. 말할 수 있는 범위는 “2.1.0 source metadata가 준비되어 검증된 exact
commit이 origin/main에 push됐다”까지다.

## 완료 조건

- 호환성이 계획대로 유지되어 version이 `2.1.0`으로 결정됐다. breaking change가 있으면
  bump 전에 멈추고 major 재판정 기록이 있다.
- `package.json`과 root package의 `package-lock.json` version이 모두 `2.1.0`이다.
- 새 `CHANGELOG.md`가 실제 구현과 wp14 검증 결과만 말한다.
- wp5–wp15가 단계별 원자 커밋으로 분리되고 unrelated file이 없다.
- frozen SHA에서 typecheck, test, build, site build, OAuth smoke, package dry-run,
  `git diff --check`가 모두 성공한다.
- 승인된 경우에만 origin/main push를 수행하고 local SHA와 remote SHA가 일치한다.
- npm publish, tag, GitHub Release는 수행하지 않았다.
