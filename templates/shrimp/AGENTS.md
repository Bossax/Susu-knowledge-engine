# Agent rules for {{NAME}}

This repository is a shared knowledge base, not a codebase. Records here are the team's durable
memory, and they are read by people as often as by agents.

## Always

- **Keep the trail.** Supersede a record and say why it changed. Never quietly rewrite or delete one.
- **Write where it belongs.** `work/`, `knowledge/`, `proposals/`, `decisions/`, `tasks/`, `archive/`
  each hold one kind of record. Put a new file in the folder that matches what it is.
- **Say what actually happened.** Report an observation as an observation and a durable write as a
  durable write. A check that found nothing is not a change.
- **Surface, do not decide.** Owners, priorities, and the substance of the work are human calls.

## Never

- Edit anything under `.shrimp/system/`. It is replaced by the next engine release, so changes are
  lost and the release check reports the repository as modified.
- Commit secrets. The Notion token lives in GitHub Actions secrets and nowhere else.
- Push, merge, or publish without explicit approval for that specific action.

## Configuration

`.shrimp/project.json` carries this instance's repository coordinates and Notion identifiers. It is
administrator-owned and survives engine updates. Values ending in `_ID` are unset placeholders.
