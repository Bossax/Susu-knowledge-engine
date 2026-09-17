# Susu Knowledge Engine

Susu Knowledge Engine creates and updates shared knowledge repositories and supplies the Workbench connector used to access them.

## Repository roles

- This repository is the only editable source for engine and connector code.
- A Shrimp repository stores team knowledge, administrator configuration, and one approved engine release.
- A private Workbench coordinates changes and runs real acceptance checks.

## Current baseline

This baseline contains the Workbench bootstrap, shared artifact handlers, Oversoul skill, tests, candidate packaging, the administrator-controlled Shrimp update, and gate-time engine alignment. Release automation remains later work.

Opening the Oversoul gate now reads Shrimp's `.shrimp/release.json` and compares it to the locally-installed Oversoul's own `engine.json`. If Shrimp is ahead, the local skill is replaced in place from `.shrimp/system/connector/oversoul` before the gate opens. A locally newer installation is never downgraded, and a Shrimp with no `.shrimp/release.json` (not yet adopted the update above) is left exactly as before — this is a no-op, not a block.

## Commands

```text
npm test
npm run check
npm run pack
npm run update -- --shrimp <dir> --package dist/candidate.tar.gz [--yes]
```

`pack` builds a candidate package from the current commit: `dist/candidate.tar.gz` plus a `dist/manifest.json` recording the engine release, commit, and bundle hash. Rebuilding the same commit produces the same hash.

`update` applies a candidate package to a Shrimp repository. It verifies the bundle hash before extracting anything, writes `.shrimp/system/connector/` and `.shrimp/release.json`, and preserves `.shrimp/project.json` and every substance folder. It reports a plan and changes nothing unless `--yes` is passed, and it never commits or pushes — the administrator reviews the diff and commits. Uncommitted changes under `.shrimp/system/` block the run until they are committed or the path is named in `--force`.

Node 24.11+ and Git are required. The engine has no package dependencies.
