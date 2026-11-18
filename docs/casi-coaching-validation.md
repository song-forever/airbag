# CASI-inspired coaching validation

Date: 2026-11-17. Branch: `codex/casi-training-coach`. Baseline: `5b4f3b42ff825e57ba6475abe03af658a3db662c` (production 0.15.0). The earlier action-recognition experiment is not included in this branch. No deployment was performed.

## Automated checks

- `npm test`: 372 passing, zero failing.
- `npm run build`: passed; existing verified detector assets reused, no new model weights/dependencies.
- `npm run validate`: passed; project-relative modules, direct provider client, manifest and detection asset hashes verified.
- `git diff --check`: passed.

New checks exercise session persistence and identity, start-time camera/import snapshots, explicit old-clip assignment, action-type-independent focus, exact-check history/progress, repeated difficulty, optional student feeling, current/duplicate/future/foreign records, provider context normalization and new schema7 output, old report compatibility, and settled analysis controls.

## Browser verification

Chrome headless with a 430 × 932 CSS viewport and touch/mobile layout, matching iPhone 15 Pro Max dimensions; this is not physical iPhone Safari validation. A locally authorized video fixture was decoded and imported. All three browser provider calls were intercepted by the local QA fixture, with explicit simulation labels.

Verified:

- Goal, detail and stage survive reload; no credentials are copied into report exports.
- An imported clip retains its session while the observed action differs from the user's goal.
- Positive observation, one task, collapsed four-phase detail and 1x playback render correctly.
- Reanalysis of the first clip cannot change the established check, generate a self-followUp or add an attempt.
- Optional difficulty feedback persists and changes the next method to simplify, independently of visual outcome counts.
- A different recognized category still receives the previous session focus and exact check.
- A new group leaves historical snapshots unchanged.
- Dismissing old-clip reassignment preserves analysis; confirming it preserves original createdAt, updates joinedAt and clears the old analysis/context.
- No page JavaScript errors or horizontal overflow (document width 430, viewport width 430).

Screenshots and the executable browser probe are kept outside the repository/public build in the workspace QA output folder. No user video or screenshots are committed.

## Standards review

Independent review of `5b4f3b42...6481b8b` found no additional documented-standard breach or blocking code smell. It checked storage isolation, bounded input, temporal/history identity, output sanitization, cache versions and build contents. Zero unresolved Standards findings.

## Spec review

Independent review found one P2: first-jump reanalysis could replace the established group check because its frozen previousFocus was null. Fixed by a bounded program-derived `coachingPlan.focus` task anchor. It retains the check without treating the clip as its own previous attempt.

The original actual-client regression went red with `new-check` in place of `original-check`; after the fix it preserves `original-check`, returns followUp null and keeps reviewed=0. The reviewer independently reran the original reproduction and confirmed resolution. Zero unresolved Spec findings.

Browser QA also found disabled feeling buttons after analysis. Fixed by rendering settled report controls after analysisBusy becomes false. Three call-site regressions reproduced the issue then passed for successful analysis, failed reanalysis and cancellation.

## Live provider format check

Using the previously authorized test credential and `qwen3.5-plus`, two real requests were made: the first analysis and reanalysis of the same IMG_9505 clip. Input was the already prepared cached v5 JPEG sequence, not a new verification of production sampling. Both returned valid schema7 coaching feedback; observed type was grab in both replies. The established check remained byte-for-byte identical after reanalysis, followUp stayed null and the clip was not counted as another physical attempt.

First request: 21.55s, 15,529 input / 680 output tokens. Reanalysis: 24.98s, 15,585 input / 842 output tokens. Default model remains unchanged. These two calls verify live schema/task compatibility, not dataset accuracy, feedback correctness or improvement across two real jumps. Credentials were supplied in an echo-disabled terminal, never written into the source or saved results.

## Interpretation

These checks validate product behavior, persistence and transport/schema compatibility. They do not establish reliable action recognition, biomechanical correctness, improved learning outcomes or CASI endorsement. The original practice methods are teaching-organization scaffolds; sport-technique demonstrations and detailed prescriptions still need content rights and technical review. Landing critique remains excluded.

## UI revision 0.16.1

At the user's request, removed the learning-materials foldout and the special-attention feature, including UI wiring, saved preference and model prompt/input. Legacy attention in local settings is cleaned without losing valid credentials or flags; historical video/report data is retained and no old attention value is resent.

Validation: 371/371 unit tests, static build/validate and diff whitespace check passed. The same 430×932 browser scenario passed with additional checks for absent sections and legacy-preference cleanup, no page errors or horizontal overflow. Three provider requests were locally simulated; no additional real API calls were made. A targeted independent review found no unresolved issues, including cache-version updates and old-setting migration.
