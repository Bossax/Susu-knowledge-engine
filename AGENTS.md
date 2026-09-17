# Susu Knowledge Engine

## Goal

Maintain the distributable engine that creates and updates shared knowledge repositories and connects user Workbenches to them.

## Rules

- Keep this repository as the only editable source for engine and connector code.
- Preserve Git history and mark replaced behavior as superseded.
- Keep one product version in `engine.json`.
- Use Node standard-library features before dependencies.
- Run `npm run check` before reporting a change complete.
- Keep each prose paragraph on one source line.
- Never commit secrets or organization-specific configuration.
- Never publish a release or merge a pull request without human approval.
