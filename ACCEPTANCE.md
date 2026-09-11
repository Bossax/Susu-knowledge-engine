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

---

# Package acceptance — 2026-09-11, jumping straight to v2.0.0

Human requester: Bossa. Recorder: Claude.

Accepted package version: `2.0.0`. Note for whoever reads this next: this file was never updated
through the whole 1.11.x line, including a real gate-closing bug fix and a wording fix to
`SKILL.md` that both shipped and were verified in that window (see
`ψ/memory/logs/info/` and `ψ/memory/learnings/` for that record instead). This entry only covers
what changed in this session, starting from 0.2.0 above.

## Verified

- `SKILL.md`'s description of the gate rule ("dirty" means a real content change, not whatever
  `git status` happened to print; "diverged" means both ahead and behind, not just ahead) replaced
  a stale one that still matched the pre-fix code. An agent reading the old wording had no way to
  know the rule had already changed underneath it — confirmed happening for real in a Copilot
  session that read `ready: true` from a live check and still reported the gate as closed, because
  it trusted the old wording over the field that actually answered the question.
- Package version now tracks the requirements document version directly (both move to `2.0.0`
  together), per the convention `ψ/active/requirements.md` states.
- oversoul itself (`linked-repo.mjs`, `install.mjs`) is unchanged in this session. What changed
  around it: `connector/` now installs the skill by calling `installSkill` directly instead of
  spawning `install.mjs` as a subprocess, and the connector's own manifest-driven mechanism
  (`status`/`apply`) replaced the old uneven `link`/`update` coverage — see
  `connector/ACCEPTANCE.md`'s 2026-09-11 entry for that work.
- All 14 oversoul tests still pass unchanged:
  `node --test workbench-adapters/oversoul/test/*.test.mjs`.

## Remaining acceptance

- The 1.11.x gap above is real and not backfilled here — if something from that window turns out
  to matter, the actual record is in `ψ/memory/`, not this file.
- Everything else listed as remaining in the 0.2.0 section above is still remaining.
