# wp12 CHECK — CI 현대화 검증 기록

계획: `030_ci.md`. 감사: 리뷰어 4회 (FAIL / FAIL / FAIL / PASS).

## 바꾼 것

| 파일 | 변경 |
|---|---|
| `.github/workflows/ci.yml` | checkout v4→v7, setup-node v4→v7 (4곳), 매트릭스 `['20','22','24']`→`['22','24','26']`, `site` 잡 신설 (`site/package-lock.json` 캐시 + hidden-file 실패 스텝 포함) |
| `.github/workflows/pages.yml` | checkout v7, setup-node v7, node 20→22, `npm install`→`npm ci`, npm 캐시 추가(`site/package-lock.json`), 업로드 직전 hidden-file 실패 스텝 추가, upload-pages-artifact v3→v5, deploy-pages v4→v5 |
| `.github/workflows/publish.yml` | checkout v7, setup-node v7, node 20→22, `npm install`→`npm ci`, npm 캐시 추가(루트 lockfile), `permissions` 블록 신설, `npm publish --provenance --access public` |
| `package.json` | `engines.node` `>=18.0.0`→`>=22.0.0` |
| `package-lock.json` | 루트 `packages[""].engines.node` 동일 상향 (전이 의존성은 건드리지 않음) |
| `README.md:6` | node 뱃지 `%3E%3D18`→`%3E%3D22` |
| `site/src/pages/docs/quickstart.astro:25` | "Node 18 or newer"→"Node 22 or newer" |
| `CHANGELOG.md` | `[3.0.0] > Breaking` 에 런타임 기준선 항목 추가 |
| `devlog/_plan/260919_structure_modularize/030_ci.md` | 계획 정정 (감사 4회 + 구현 검증 2회 반영) |
| `devlog/_plan/260919_structure_modularize/032_wp12_check.md` | 이 문서 (신규) |

### 계획에 없다가 편입된 것 두 개

구현 검증 리뷰어가 범위 이탈로 잡았고, 되돌리는 대신 근거를 붙여 계획에 편입했다
(`030_ci.md` 의 `(4)`, `(5)` 절).

- **npm 캐시 3곳** — 계획은 "캐시 전략 변경 안 함" 이었다. 그러나 실제로는
  `pages.yml`/`publish.yml` 에 캐시가 **아예 없었다.** 전략 변경이 아니라 누락 보충이다.
  `npm install`→`npm ci` 로 바꾸면서 캐시 없이 두면 매 실행이 전체 레지스트리 왕복이 된다.
- **hidden-file 영구 실패 스텝** — 계획은 일회성 확인이었다. `upload-pages-artifact@v5` 는
  hidden file 을 **에러 없이 조용히 누락**시키므로 (`include-hidden-files` 기본 `false`),
  일회성 확인으로는 미래의 조용한 실패를 못 막는다.
  재검증에서 한 번 더 걸렸다: 처음엔 `ci.yml` 에만 넣었는데, 이 저장소엔 브랜치 보호가
  없어서 `ci.yml` 은 advisory 다. 실제 업로드는 `pages.yml` 이 하므로 CI 가 빨간불이어도
  배포는 그대로 나간다. **`pages.yml` 의 업로드 직전에도** 같은 검사를 넣어 배포 게이트를
  만들었다. `ci.yml` 쪽은 PR 조기 신호로 남긴다.

## 검증 출력

YAML 파서는 로컬에 없어서 `npx --yes js-yaml` 을 썼다 (의존성 추가 없음).
파이썬 `pyyaml` 과 `node_modules/yaml` 둘 다 이 환경에 없다.

```
npx --yes js-yaml .github/workflows/ci.yml       -> parse OK
npx --yes js-yaml .github/workflows/pages.yml    -> parse OK
npx --yes js-yaml .github/workflows/publish.yml  -> parse OK

npm ci            exit=0
npm run typecheck exit=0
npm run build     exit=0
node dist/index.js --version -> 3.0.0

node scripts/run-tests.mjs -> tests 248 / suites 40 / pass 248 / fail 0

npm --prefix site ci        exit=0
npm --prefix site run build exit=0
find site/dist -mindepth 1 -name '.*'   -> (빈 결과)
find site/dist -name index.html | wc -l -> 45
```

### 기록해 둘 경고

`npm ci` 가 취약점을 경고한다. 루트 4건, `site` 10건(critical 1, high 7 포함).
**이번 패치가 만든 회귀는 아니다** — lockfile 의 의존성은 건드리지 않았고 루트 `engines`
한 줄만 바꿨다. 다만 기록은 남긴다. 의존성 갱신은 이 단위의 범위가 아니고 별도로 다뤄야 한다.

계획이 정한 잔존 검사 네 개:

```
rg -n "\b20\b" .github/workflows
  -> ci.yml:92 주석 한 줄만 ("Node 20 went end-of-life 2026-04-30").
     실행되는 설정에는 Node 20 이 없다.

node -e '...engines...'  -> ">=22.0.0 >=22.0.0"  (package.json / lock 루트 일치)
rg -n "%3E%3D" README.md -> README.md:6 node-%3E%3D22
rg -n "Node [0-9]+ or newer" site/src -> quickstart.astro:25 "Node 22 or newer"
```

## 여기서 증명하지 못한 것

로컬에서 끝나지 않는 항목이다. 감사가 이걸 별도 gate 로 분리하라고 해서 그대로 적는다.

| 항목 | 증명 시점 |
|---|---|
| 액션 v7/v5 가 호스티드 러너에서 실제로 도는지 | push 후 첫 CI 실행 |
| Pages 가 새 액션으로 빌드/배포되는지 | `workflow_dispatch` 수동 실행 |
| `npm publish --provenance` 가 통과하는지 | 다음 `v*` 태그 릴리스 |

publish 워크플로는 태그 push 로만 도므로 이번 단위에서 실행 증거를 만들 수 없다.
"고쳤다" 가 아니라 "고쳤고 다음 릴리스에서 확인한다" 이다.

## 감사가 무너뜨린 내 측정 (기록용)

이 단위에서 리뷰어가 잡아낸 내 오류다. 같은 실수를 반복하지 않기 위해 남긴다.

1. "액션 `@v4` 는 현행" — 틀림. 3개 메이저 뒤였다.
2. "Node 표기는 quickstart.astro 한 곳뿐" — 틀림. `rg` 패턴이 URL 인코딩된
   README 뱃지를 못 잡았다. 실제로는 네 곳.
3. "`>=20` 으로 올린다" — 자기 근거와 모순. Node 20 도 2026-04-30 EOL 이다.
4. pages/publish 의 `node-version: 20` 잔존 — 내가 직접 `cat -n` 으로 읽은
   파일인데도 놓쳤다.
5. "PR 차단 게이트" — 이 저장소엔 브랜치 보호가 없다. advisory CI 다.
6. 검증 명령 두 개가 false-green / false-red 였다.
7. deploy-pages 최신을 v5.0.0 이라 했으나 v5.0.1 이다.
