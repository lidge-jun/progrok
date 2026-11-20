# 040 — wp4 release

1. Push branch, open PR to main (gh pr create --body-file), link with goat_pull_request_link.
2. CI (ci.yml): typecheck, build & smoke, site build, test matrix 3 OS × Node 22/24/26 must be green.
3. Final review: fresh Terra task (role review) on the PR head, brief includes 000/001 and this unit; blockers → fix, re-review.
4. Merge (squash), record the merge commit.
5. Tag `v3.1.0` on the merge commit and push the tag → publish.yml runs `npm publish --provenance`.
   Precondition: `gh secret list` shows NPM_TOKEN or the previous publish run used it; if the run fails on auth → NEEDS_HUMAN.
6. `gh release create v3.1.0 --notes-file <changelog section>` (v2.0.4 has a Release; publish.yml does not create one).
7. Pages: pages.yml triggers on main pushes touching site/**; confirm the run succeeded (or dispatch it).
8. Verify: `npm view progrok dist-tags` → latest 3.1.0; `npx -y progrok@3.1.0 --version` → 3.1.0;
   `gh release view v3.1.0`; Pages run conclusion success.
9. Rollback: if publish produced a broken package, `npm deprecate progrok@3.1.0` and dist-tag latest back to 2.0.4,
   then report. A failed workflow with nothing published needs only a fix and a re-tag.


## P amendment before wp4 (2026-11-21)

Release facts checked read-only:

- publish.yml has never succeeded: runs for v0.2.1, v2.0.3 and v2.0.4 all failed. The repository has no Actions
  secrets (`gh secret list` is empty), so `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` is empty. npm shows 2.0.3 and 2.0.4
  published a few seconds before each tag push, i.e. from a local `npm publish`.
- The local npm token in ~/.npmrc is rejected (`npm whoami` → 401). No working npm credential exists on this host.
- main has no branch protection; Pages deploys from pages.yml on pushes to main that touch site/**.
- v2.0.4 has a GitHub Release; publish.yml does not create one.

Order for this release:

1. Push the branch, open the PR (body via --body-file; it must describe the test-isolation fix and the credential
   loss it caused), link it with goat_pull_request_link, wait for CI (all jobs, including the Windows matrix).
2. Fresh Terra final review of the PR head (new reviewer, no continueFrom). Blockers → fix, re-run CI, re-review.
3. Squash-merge; record the merge commit. Confirm pages.yml ran on that push and succeeded.
4. npm publish needs a credential the user provides (asked asynchronously):
   - NPM_TOKEN repo secret → tag v3.1.0 on the merge commit and push the tag; publish.yml publishes with provenance.
   - local `npm login` → `npm publish --access public` from a clean checkout of the merge commit, then push the tag
     (publish.yml will then fail on "version already published"; that run is expected and reported as such).
   - no credential → tag and Release are still created; npm publish is reported NEEDS_HUMAN and the goal stays open.
5. `gh release create v3.1.0 --notes-file <3.1.0 CHANGELOG section>` on the tag.
6. Verify: npm view progrok dist-tags (latest 3.1.0), npx -y progrok@3.1.0 --version, gh release view v3.1.0,
   Pages run success. Live billing smoke after the user re-logs in; otherwise NOT RUN.


## Release-plan audit dispositions (VERDICT FAIL, 4 blockers)

Additional fact: lidge-jun is a user account (no organization secrets); the only environment, github-pages, has no
secrets. The earlier "published locally" statement is an inference from timing and is labelled as such.

Revised order (replaces steps 3–6 above):

3. Squash-merge. Record the merge SHA M and confirm main's HEAD is M (no one else pushed).
4. Wait for ci.yml on the push to main at exactly M: typecheck, build & smoke, site, and all nine test cells
   (ubuntu/macos/windows × Node 22/24/26) green. Confirm pages.yml for M succeeded.
5. Package gate on M: in a clean checkout of M run `npm ci && npm run build` (packing has no build hook;
   `prepublishOnly` only runs on publish), then `npm pack`; list the tarball (dist/, skills/, README, LICENSE,
   THIRD_PARTY_NOTICES only, no tests/devlog/site/.codexclaw); install the tarball into a temp dir with a throwaway
   HOME and run `progrok --version` (3.1.0), `progrok skill | head`, `progrok capabilities --json --offline`.
6. Publish, by the credential the user chooses:
   - NPM_TOKEN secret (preferred): push tag v3.1.0 at M; publish.yml publishes with --provenance; verify the registry
     attestation (`npm view progrok@3.1.0 dist.attestations`). If the workflow fails before publishing, delete the
     remote tag (this work created it), fix, re-tag M. Never move a tag after npm has the version.
   - local npm login (only if the user picks it): explicit decision that 3.1.0 ships WITHOUT a provenance
     attestation, reported as such; `npm publish --access public` from the clean checkout of M, then tag.
   - no credential: nothing is tagged or released; npm publish is NEEDS_HUMAN and the goal stays open.
7. Only after npm shows 3.1.0: `gh release create v3.1.0 --verify-tag --notes-file <3.1.0 section>`.
8. Verify: npm view progrok dist-tags (latest 3.1.0), npx -y progrok@3.1.0 --version, gh release view v3.1.0, Pages.

