# Evidence

Where the decisions came from. The work units under
[devlog/_plan/](../devlog/_plan/) hold the research, the audits and the
verification records; this page is the index into them.

## 260918_web_ui_redesign — the workspace rebuild

24 Markdown documents. The ones worth opening first:

| Topic | Document |
|---|---|
| Direction lock and work-phase split | `000_roadmap.md` |
| Audit folds, including what was rebutted and why | `005_audit_fold.md` |
| DOM contract inventory, CSP limits, audio extension points | `010_dom_contract.md` |
| Frontend gates applied to a developer console | `020_frontend_gates.md` |
| Realtime voice UI reference with sources | `030_voice_ui_reference.md` |
| Browser capture of shipping products | `035_aside_capture.md` |
| Token table, computed OKLCH values, measured contrast | `040_design_system.md` |
| Per-phase verification records | `042`, `052`, `062`, `102`, `112` |
| Full capture matrix with unverified items and their blockers | `090_verification_report.md` |

### Decisions traceable to it

| Decision | Evidence |
|---|---|
| Level meters read real audio, never animate without signal | `030_voice_ui_reference.md` §2, `050_voice_surface.md` |
| Bars are driven by quantised `data-level` attributes, not inline style | `005_audit_fold.md` F1 — two reviewers flagged CSP risk and it could not be settled empirically |
| No `reconnecting` state | `005_audit_fold.md` B4 — the client has no reconnect logic, so drawing the state would be fiction |
| Mute says it still streams silence | the worklet keeps sending; `050_voice_surface.md` |
| Icon system is a Lucide subset | `../DESIGN.md` — CSP forbids a CDN, and the audience lives in that toolchain |
| Speaker is carried by label and position, not colour alone | `030_voice_ui_reference.md` §2.3 |

## 260919_structure_modularize — this unit

| Document | Holds |
|---|---|
| `000_roadmap.md` | Layer measurements, the dependency graph, and the audit folds that corrected the first pass |
| `010_structure_sot.md` | This folder's plan |
| `020_modularize.md` | Module split targets and the boundary test |
| `030_ci.md` | Workflow findings |

The first pass of `000_roadmap.md` claimed the dependency graph was acyclic. It is
not. The correction, and the measurement that produced it, are in that file's fold
sections rather than silently rewritten — the wrong claim is part of the record.

