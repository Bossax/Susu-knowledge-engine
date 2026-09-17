# Susu Knowledge Engine

Susu Knowledge Engine creates and updates shared knowledge repositories and supplies the Workbench connector used to access them.

## Repository roles

- This repository is the only editable source for engine and connector code.
- A Shrimp repository stores team knowledge, administrator configuration, and one approved engine release.
- A private Workbench coordinates changes and runs real acceptance checks.

## Current baseline

This extraction baseline contains the existing Workbench bootstrap, shared artifact handlers, Oversoul skill, and tests. Packaging, release automation, Shrimp updates, and gate-time engine alignment remain later work.

## Commands

```text
npm test
npm run check
```

Node 24.11+ and Git are required. The engine has no package dependencies.
