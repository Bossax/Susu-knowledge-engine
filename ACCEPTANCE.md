# Oversoul implementation acceptance — 2026-09-09

Human requester: Bossa. Recorder: Codex.

Accepted package version: `0.1.0`.

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

# Package hardening acceptance — 2026-09-09 (Stage 1 of Connector distribution)

Human requester: Bossa. Recorder: Claude.

Accepted package version: `0.2.0`.

## Verified

- `install.mjs` is version-aware: absent installs, equal version is a no-op, a newer source
  upgrades in place (via atomic stage/rename/prune-by-replace, keeping the displaced copy until
  the swap succeeds), an older source is refused unless `--allow-downgrade`, and an unparseable
  installed `SKILL.md` blocks without being overwritten. All five outcomes covered by
  `test/install.test.mjs`.
- Added a `copilot` install target sharing `.agents/skills/oversoul` with `codex`, and an
  installed `.github/prompts/oversoul.prompt.md` with its skill path rewritten from
  `workbench-adapters/oversoul/SKILL.md` to the installed location.
- Added `--scaffold-agents`: a project missing `AGENTS.md` is refused by default and scaffolded
  from `templates/agents-scaffold.md` only when the flag is passed.
- `validate-skill.mjs` no longer hard-codes a version string; it now checks that the frontmatter
  version, the `Version:` body line, and README's "Current version" agree, so it cannot rot on
  the next release.
- Fixed a latent macOS bug in `test/client.test.mjs`'s fixture: `mkdtemp(tmpdir())` was not
  realpath'd, so a child process's realpath'd `process.cwd()` (`/private/var/...`) would never
  equal the un-realpath'd fixture path (`/var/...`). `linked-repo.mjs` itself was already correct
  — the bug was only in the test fixture.
- Added coverage for a registry path nested under a subdirectory, and for a case-differing
  registry path on a case-insensitive filesystem (both pass; the latter ran for real on this
  Windows machine rather than being skipped).
- All 11 tests pass: `node --test workbench-adapters/oversoul/test/*.test.mjs`.
- Re-ran the real installer against this workbench: `install.mjs claude codex copilot` reported
  `upgraded 0.1.0 → 0.2.0` for both installed-skill paths and `installed` for the new Copilot
  prompt; a second run reported `unchanged` for all three. `linked-repo.mjs inspect --target
  Shrimp` behaves identically to before — it reports the Shrimp worktree's pre-existing dirty
  state, which this stage did not touch or attempt to resolve.

## Remaining acceptance

- Everything listed as remaining in the 0.1.0 section above is still remaining.
- The version-aware upgrade path, the `copilot` target, and `--scaffold-agents` have not yet been
  exercised on macOS.
- No commit, push, merge, or live Notion mutation was performed in this stage either.
