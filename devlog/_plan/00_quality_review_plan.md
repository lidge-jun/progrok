# 00 — progrok 전체 품질 점검 및 수정 플랜

Date: 2026-06-08
Phase: P (Planning)
Scope: 전체 소스 코드 (25 src + 7 test files, 3560줄)

## Part 1: 요약 (CEO 설명)

progrok의 전체 TypeScript 소스를 dev 가이드라인 기준으로 리뷰하고, uncommitted 검색 기능
개선사항을 atomic 커밋으로 정리한 뒤, ci/expand-matrix 브랜치를 main에 머지하는 작업.
코드 자체는 이미 높은 수준이나, 반복 패턴 추출, magic string 정리, 에러 핸들링 강화,
타입 가드 일부 보강이 필요.

## Part 2: Diff-Level 변경 계획

### Step 1: Uncommitted 변경사항 atomic 커밋

현재 6개 파일이 수정된 채 uncommitted:
- `src/auth/constants.ts` — SEARCH_DEFAULT_MODEL, SEARCH_DEFAULT_REASONING 추가
- `src/commands/search.ts` — buildSearchRequestBody 리팩터, citation instructions, markdown links
- `src/commands/capabilities.ts` — multi-agent default reasoning 수정
- `tests/search.test.ts` — buildSearchRequestBody 테스트 추가
- `docs/api.md` — search citation docs
- `skills/progrok/SKILL.md` — skill 업데이트

커밋 분리 계획:
1. `feat(search): add search citation instructions and buildSearchRequestBody`
   - constants.ts, search.ts, tests/search.test.ts
2. `feat(search): add markdown links output for citations`
   - search.ts (output formatting)
3. `docs: update search citation contract and capabilities`
   - capabilities.ts, docs/api.md, skills/progrok/SKILL.md

### Step 2: DRY 위반 수정

| Pattern | 위치 | Fix |
|---------|------|-----|
| `collectRefs()` 함수 중복 | video.ts:352, image.ts:122 | `src/utils/collect-refs.ts`로 추출 |
| `getVersion()` / `readPackageVersion()` 중복 | index.ts:20, capabilities.ts:15 | `src/utils/version.ts`로 추출 |
| `parseInt(opts.timeout ?? "600", 10) * 1000` 반복 | video.ts:195,265,308 | 상수 + 헬퍼 |
| `fileToDataUri` / `imageToDataUri` 유사 | video.ts:49, image.ts:20 | video의 것이 superset → 공통으로 추출 |
| `ensureConfigDir()` 중복 | config.ts:15, token-store.ts:34 | config.ts에서만 export, token-store에서 import |

#### NEW: `/Users/jun/Developer/new/700_projects/progrok/src/utils/collect-refs.ts`
```typescript
/** Commander repeatable-option collector for --ref flags. */
export function collectRefs(value: string, prev: string[]): string[] {
  return [...prev, value];
}
```

#### NEW: `/Users/jun/Developer/new/700_projects/progrok/src/utils/version.ts`
```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version || "?";
  } catch {
    return "?";
  }
}
```

#### NEW: `/Users/jun/Developer/new/700_projects/progrok/src/utils/media.ts`
```typescript
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

export interface MediaRef {
  url?: string;
  file_id?: string;
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const VIDEO_MIME: Record<string, string> = {
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export function fileToDataUri(filePath: string, mediaKind: "image" | "video"): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = extname(abs).toLowerCase();
  const mime =
    mediaKind === "image"
      ? IMAGE_MIME[ext] ?? "image/jpeg"
      : VIDEO_MIME[ext] ?? "video/mp4";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export function mediaRef(input: string, mediaKind: "image" | "video"): MediaRef {
  if (input.startsWith("file_id:")) return { file_id: input.slice("file_id:".length) };
  if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("data:")) {
    return { url: input };
  }
  if (existsSync(resolve(input))) return { url: fileToDataUri(input, mediaKind) };
  if (/^file[-_]/.test(input)) return { file_id: input };
  throw new Error(
    `${mediaKind} input must be a local file, URL, data URI, or file_id:<id>. Got: ${input}`,
  );
}
```

### Step 3: Magic String → Constants

| Magic String | 위치 | Fix |
|-------------|------|-----|
| `"grok-imagine-video"` | video.ts:8 | → `constants.ts` export |
| `"grok-imagine-image"` | image.ts:8 | → `constants.ts` export |
| `5000` (poll interval) | video.ts:9 | → `constants.ts` export |
| `"600"` (default timeout) | video.ts:153,168,183 | → `constants.ts` export |
| `10_000_000_000` (usd ticks divisor) | video.ts:255, image.ts:113 | → `constants.ts` export |
| `"1:1"`, `"16:9"`, `"480p"`, `"1k"` | image/video defaults | 이건 Commander defaults라 그대로 둠 |

#### MODIFY: `src/auth/constants.ts`
```diff
+// Image / Video
+export const DEFAULT_IMAGE_MODEL = "grok-imagine-image";
+export const DEFAULT_VIDEO_MODEL = "grok-imagine-video";
+export const VIDEO_POLL_INTERVAL_MS = 5_000;
+export const VIDEO_DEFAULT_TIMEOUT_S = 600;
+export const USD_TICKS_DIVISOR = 10_000_000_000;
```

### Step 4: Deep Nesting 수정

| File | Lines | 현재 깊이 | Fix |
|------|-------|----------|-----|
| models.ts:65-77 | tag assignment | 7 levels | lookup map 패턴 |

```diff
-const tag = m.id.includes("composer")
-  ? " [composer]"
-  : m.id.includes("reasoning")
-    ? ...
+const MODEL_TAGS: [string, string][] = [
+  ["composer", " [composer]"],
+  ["reasoning", " [reasoning]"],
+  ["non-reasoning", " [fast]"],
+  ["build", " [code]"],
+  ["code", " [code]"],
+  ["imagine-video", " [video]"],
+  ["imagine", " [image]"],
+];
+const tag = MODEL_TAGS.find(([k]) => m.id.includes(k))?.[1] ?? "";
```

### Step 5: Error Handling 보강

| File | Issue | Fix |
|------|-------|-----|
| proxy/server.ts:109 | `catch { /* stream interrupted */ }` — 사일런트 | 디버그 로그 추가 |
| index.ts:80 | `program.parse()` — unhandled rejection 가능 | top-level catch 추가 |

### Step 6: DRY — `ensureConfigDir` 통합

token-store.ts와 config.ts 모두 `ensureConfigDir()`을 가짐. config.ts에서 export하고 token-store에서 import.

### Step 7: Untracked devlog 커밋

`devlog/_plan/10_research_opencode_adapter.md` 및 `11_opencode_adapter_questions.md` 커밋.

### Step 8: Branch 정리 → main 머지

1. ci/expand-matrix 브랜치 모든 커밋 완료
2. main checkout → merge ci/expand-matrix
3. ci/expand-matrix 삭제 (로컬)

## File Change Map

| Action | Path | Reason |
|--------|------|--------|
| NEW | `src/utils/collect-refs.ts` | DRY: collectRefs 추출 |
| NEW | `src/utils/version.ts` | DRY: readPackageVersion 추출 |
| NEW | `src/utils/media.ts` | DRY: fileToDataUri+mediaRef 추출 |
| MODIFY | `src/auth/constants.ts` | magic strings → constants |
| MODIFY | `src/commands/video.ts` | import 공통 모듈, constants 사용 |
| MODIFY | `src/commands/image.ts` | import 공통 모듈, constants 사용 |
| MODIFY | `src/commands/models.ts` | deep nesting → lookup map |
| MODIFY | `src/commands/capabilities.ts` | import version util |
| MODIFY | `src/index.ts` | import version util, top-level catch |
| MODIFY | `src/proxy/server.ts` | silent catch → debug log |
| MODIFY | `src/utils/config.ts` | export ensureConfigDir |
| MODIFY | `src/auth/token-store.ts` | import ensureConfigDir from config |

## 비즈니스 로직 결정 사항

없음 — 순수 리팩터링, 기능 변경 없음.

## 커밋 계획 (atomic)

1. `feat(search): refactor search with citation instructions and request builder`
2. `feat(search): add markdown links output block for citations`
3. `docs: update search capabilities and citation contract`
4. `docs: add opencode adapter research devlog`
5. `refactor: extract shared utils (media, version, collectRefs)`
6. `refactor: move magic strings to constants`
7. `refactor: fix deep nesting in models command`
8. `refactor: unify ensureConfigDir, add top-level error handler`
9. `refactor: add debug log for stream interruption in proxy`
10. Main merge (no commit — fast-forward or merge commit)
