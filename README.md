# Connector package

The provisioning tool that `workbench-adapters/oversoul/` explicitly does not attempt: cloning
worktree/junction/registry setup for a new workbench. Human-invoked bootstrap only — never a
`protocol.json` capability, never run by an agent without explicit per-invocation instruction.

Run from inside a primary clone of the shared knowledge-base repository:

```text
node connect.mjs status --workbench <path>
node connect.mjs link   --workbench <path> [--yes] [--name NAME] [--dir DIR] [--branch BRANCH]
                         [--worktree PATH] [--clients claude,codex,copilot]
                         [--skip-mcp] [--skip-contract] [--update-contract] [--allow-downgrade]
node connect.mjs update --workbench <path> [--yes] [--allow-downgrade]
node connect.mjs verify --workbench <path>
```

Without `--yes`, `link` computes and prints the full plan — what it would create, leave
unchanged, or refuse — and mutates nothing. The two steps whose outcome can only be known by
actually invoking a subprocess (the skill installer, the final self-verifying `inspect`) are
reported as `planned` rather than predicted.

`link` refuses (exit 2, no mutation) rather than acting when: the intended worktree path is
occupied by something that isn't the expected worktree; the intended branch already exists
elsewhere; the intended link path exists and doesn't already resolve to the intended worktree; or
a registry entry with the same name already points somewhere different. A dirty primary clone is
reported as a warning, not a refusal — `git worktree add` never touches it.

Connecting a workbench sets up the access guardrails: direct file reads, writes, and commands
against the linked repository directory are blocked across supported agent clients (Claude Code,
Codex CLI, Antigravity, GitHub Copilot). The active session gate lease (`.agents/oversoul-gate.json`)
must be opened via `oversoul inspect` or `oversoul prepare` before operations can proceed.

`connect.mjs` locates the `oversoul` package next to itself: nested under `./oversoul` (the
layout after vendoring into a shared repository) or, failing that, as the sibling
`../oversoul` (the layout in this workbench's development tree). The same file works unmodified
in both places.

`verify-sync.mjs` is a separate, read-only drift detector for release time — it hashes every file
in a maintained source package and a vendored copy and reports what's added, removed, or changed.
It takes the source path as an argument; it has no idea (and should never be given a reason to
care) whether that source is this workbench or, eventually, a central connector package shared
across multiple knowledge-base repositories.

Tests: `node --test test/*.test.mjs`. Hermetic — temporary directories and a local bare
repository standing in for "origin"; nothing touches GitHub, the real workbench, or the real
Shrimp worktree.
