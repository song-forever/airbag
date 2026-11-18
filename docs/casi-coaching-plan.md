# CASI-inspired coaching iteration

Baseline: main `5b4f3b42ff825e57ba6475abe03af658a3db662c`. This branch is separate from the unvalidated recognition experiment. No production deployment is part of this iteration.

UI revision 0.16.1: remove the “练习思路与学习资料” foldout and the “这一跳特别关注” feature at the user's request. Training goals/details and teaching behavior remain. No attention preference, record migration or provider prompt remains active; legacy saved settings drop the retired field without deleting credentials/history. Official sources stay in the documentation, superseding item 8's visible source-area requirement.

## Accepted product behavior

1. On the capture page, let a user set one persistent training goal (straight air, grab, rotation, rotation + grab), optional detail (80 chars), and a stage (initiation, acquisition, consolidation, refinement, variation). Free practice remains available without setup. Editing the goal/stage begins a new group; starting a new group keeps historical clips. Settings persist locally, without copying credentials into clips or reports.
2. Both camera recordings and local imports snapshot the active training session. Historical records retain their original session when the active goal changes. Offer an explicit way to assign the current group to an old/unassigned imported clip before analysis; never silently rewrite analyzed history.
3. Training intention is distinct from observed action. A changed or uncertain recognition result must not reset a session's previous focus. Never assume a target rotation/grab was completed because the user selected it.
4. Retain four phases (approach, ramp, takeoff, airborne), one next-jump focus and check, fixed-camera/no-reshoot behavior, no landing critique, and 1x default playback. Lead the new compact coaching view with a specific observed effective action when supported, then the current focus and one next attempt. Keep phase detail available in a collapsed section for the new schema.
5. Training sessions preserve the focus/check while allowing a new, simpler explanation or method when repeated partial/not_yet or explicit user difficulty warrants it. Unknown evidence is not failure and must not count toward struggle/success streaks. Legacy free-practice behavior remains compatible.
6. Maintain multi-jump progress for the same session and exact check standard; show done/partial/not_yet/uncertain counts and streaks, not a score or automatic mastery/level-up. One done means only this attempt met this check. User chooses stage changes. Reanalysis of one clip must never count as multiple attempts or use later records to judge an earlier clip.
7. Optional after-jump self-report: easier / same / harder. This is student feedback, not a visual fact, and can affect the next practice method. Do not require input every jump.
8. A small original practice-method library provides repeat / review / simplify / consolidate prompts, matched to stage and recent results. These are teaching methods for the current familiar action, not a claim of professionally approved sport-technique prescriptions. Include concise teaching-source links and whole-skill themes; do not copy official videos or claim CASI endorsement. Explicitly defer actual demo media until rights and technical review exist.
9. The model remains one existing provider call per analysis. Add bounded validated coaching context and PTT-style observation; do not send past videos, credentials, or entire histories. Preserve transport cancellation/size limits and existing cost/token accounting.

## Shared module contract

`training-session.js` owns session validation, goal/stage catalog and local persistence:

- `TRAINING_GOALS`: `{id,label}` (`straight`, `grab`, `rotation`, `rotation-grab`).
- `LEARNING_STAGES`: `{id,label,description}` (`initiation`, `acquisition`, `consolidation`, `refinement`, `variation`).
- `normalizeTrainingSession(value)` -> clean `{id,goal,detail,stage,startedAt}` or null; strict bounded strings/timestamps/enums.
- `createTrainingSession(input, {id,now})` -> normalized session or throws; id/date are injected by UI.
- `createTrainingSessionStore({getStorage,appPath})` -> `{snapshot(): {session,persisted}, save(session|null): {session,persisted}}`; independent localStorage key, no API keys.
- `describeTrainingSession(session)` -> compact human-readable goal/stage summary.
- `trainingAttemptTime(record)` -> valid nonnegative `trainingJoinedAt` for session attempts, otherwise `createdAt`. Explicitly assigning an older clip records a new joined-at time without changing the original video timestamp.

`coaching-plan.js` owns the method library and pure progress calculation:

- `buildCoachingPlan(record,records=[],previousFocus=null)` -> null for no session, otherwise `{session,method,progress,previousFeeling}`.
- `method`: `{id,title,description,skillTheme}`; IDs `review`, `repeat`, `simplify`, `consolidate`; reviewed method/provenance info is not implied.
- `progress`: `{reviewed,done,partial,notYet,uncertain,consecutiveDone,consecutiveNeedsWork}` computed from distinct earlier records, valid reports with same session id + same check; current clip excluded. No future records, no old report whose trainingGoalKey differs from its record context.
- `previousFeeling`: null or `easier|same|harder`, from most recent eligible prior clip. A difficulty report is a separate signal and never increments visual-failure counts.
- `focus`: null or `{instruction,check}`, a bounded established task anchor. Prefer the actual previous focus; on reanalysis of a first report use its current valid same-session task without treating the clip as its own previous attempt.
- `normalizeCoachingPlan(value)` validates the above for provider boundary (bounded values; catalog method content generated internally rather than trusting caller prose).
- `getTrainingProgress(record,records=[])` same summary including the current successfully analyzed attempt for UI, still same exact check.

Records gain `trainingSession` snapshot, `trainingJoinedAt` and optional `practiceFeeling`. `getTrainingContext` gains `coachingPlan`, and session-specific goal keys/focus search. Payload gains optional `coachingPlan`; legacy calls unchanged. New reports use `schemaVersion:7`, with `coaching:{positive:null|{observation,time},method,session}` composed from sanitized program context; model only supplies `coaching.positive`. Existing `stages`, `nextJump`, `followUp`, observed action remain compatible. In session mode `nextJump.check` is kept from the prior focus until a deliberate new group; new wording/method may vary but stays on that one check.

## Validation

- Session persistence/reload/malformed storage and historical snapshots.
- Same session continues across wrong/uncertain action recognition; changed goal stops it.
- Same check progress ignores other groups/checks, future records, failed analysis, duplicates/reanalysis, uncertain outcomes as success/failure.
- Repeated difficulty selects a new method; single done never auto advances stage.
- Provider body distinguishes user intent vs observed action, validates bounded context, preserves PTT and one check; old contracts/tests still work.
- Real browser at iPhone 15 Pro Max portrait size: configure/refresh, import a local fixture, inspect mocked provider body/results, self-report, next clip, change group, old clip reassignment confirmation, report export, original playback/capture controls.
- Full unit suite, static build + validate, browser errors; no claim of real model accuracy improvement without a separate labeled API test.
