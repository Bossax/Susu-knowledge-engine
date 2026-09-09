# Oversoul implementation acceptance — 2026-09-09

Human requester: Bossa. Recorder: Codex.

## Verified

- Protocol manifest and normalization implemented in the dedicated Shrimp worktree, preserving
  the five pre-existing documentation edits. TypeScript passes; all 28 shared-system tests pass.
- All four generic client tests pass. They cover real temporary worktrees, safe fast-forward, target working directory,
  dirty preservation, ahead/divergent state, detached HEAD, missing upstream, failed fetch,
  wrong identity, missing documents, broken links, manifest version/path rejection, Actions-only
  refusal and argument restrictions. Fetch transport is local in tests, not GitHub.
- Codex and Claude Code received project-level copies without overwrites. The mistakenly created
  user-global copies were removed when Bossa clarified that the skill scope must be project-level.
- Installed Codex and Claude clients resolved the actual junction, fetched origin, discovered manifest version 1,
  and correctly reported the dirty worktree. HEAD equals origin/main at 07d6c7542cd3294f56d1ea97f2d564025d7af92a.
- Basic skill validation passes with the bundled fallback validator. The skill-creator Python
  validator could not run because PyYAML is not installed; no dependency was installed to bypass this.

## Remaining acceptance

- Live Notion MCP capture/normalization/reconciliation: no Notion MCP tools available in this session.
- Fresh Codex/Claude skill-discovery and conversational pilots: installed files do not prove a running
  session has reloaded its skill list. Restart/open a new session and invoke Oversoul.
- Copilot package prepared, not installed or interactively tested (Copilot is not on this machine).
- macOS interactive test remains pending; Windows local client tests passed.
- Capability execution on the real Shrimp worktree waits for human handling of uncommitted changes.
  Execution is verified in temporary clean worktrees; no dirty-state bypass was added.
- Actions configuration, secret setup and live-write commissioning remain outside this delivery.

No commit, push, merge or live Notion mutation was performed. The prior fixture/handoff assumptions
remain preserved in historical records; the requirements' Oversoul amendment supersedes OQ-18/19.
