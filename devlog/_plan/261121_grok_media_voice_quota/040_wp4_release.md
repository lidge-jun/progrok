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

