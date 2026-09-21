# Analysis engine versioning

Status: accepted

Hevy Coach treats calculated training signals as versioned derived data. The raw
Hevy records remain the source of truth, while dashboards, findings, progression
states, and reviews may change as the analysis rules improve.

`ANALYSIS_ENGINE_VERSION` identifies the calculation contract used to produce a
derived result. Increment it whenever a change can alter a stored metric or
finding from the same raw input. Copy the version into future persisted derived
records so stale results can be identified and rebuilt safely.

Every analysis run also records its generation time and source coverage: workout,
set, and template counts plus the oldest and newest workout timestamps. Coverage
is evidence about the calculation, not a replacement for the underlying ledger.

Tests use a fixed clock and deterministic synthetic athletes so changes in
metrics are intentional and reviewable. The fixtures model novice, intermediate,
and advanced training histories over 26 weeks and will grow alongside the V2
engine.
