# Changelog

## Unreleased

- Extracted the Workbench connector, shared artifact handlers, Oversoul skill, and tests from Susu Project Conductor with their Git history.
- Replaced copied-layout compatibility paths with one canonical engine layout.
- Replaced component version fields with the engine release from `engine.json`.
- Added `npm run pack`, building a deterministic candidate package identified by commit and sha256 bundle hash. The package carries `engine.json` so it names its own release.
- Added `npm run update`, the administrator-controlled Shrimp update. It verifies the bundle before extracting, writes `.shrimp/system/connector/` and `.shrimp/release.json`, preserves `.shrimp/project.json` and all substance, plans by default, and leaves committing to the administrator.
- Moved the atomic tree replacement and its rollback from the skill installer into `shared/fs.mjs` as `replaceTree`, now shared by the skill installer and the Shrimp updater.
- Added the gate-time engine alignment handshake to `linked-repo.mjs`: opening the gate now reads Shrimp's `.shrimp/release.json`, compares it against the locally-installed Oversoul's `engine.json`, and replaces the local skill in place from `.shrimp/system/connector/oversoul` when Shrimp is ahead. Never downgrades a locally newer installation; a Shrimp without `.shrimp/release.json` is unaffected. This file ships standalone inside the installed skill, so the comparison and swap are self-contained rather than importing `shared/`.
