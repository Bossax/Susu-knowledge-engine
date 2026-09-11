# Connector package

This is the tool that sets up a workbench's link to the shared knowledge-base repo, and keeps
every file that link depends on up to date afterward. It's the one piece `oversoul/` deliberately
doesn't do itself: cloning, worktree setup, and writing the files each agent client needs.

It's human-invoked only. Never a `protocol.json` capability, never run by an agent unless a person
explicitly asked for it in that moment.

Run from inside a primary clone of the shared knowledge-base repository:

```text
node connect.mjs status --workbench <path> [--clients claude,codex,copilot,antigravity] [--json]
node connect.mjs apply  --workbench <path> [--yes] [--force id1,id2] [--clients ...] [--allow-downgrade]
node connect.mjs link   --workbench <path> [--yes] [--name NAME] [--dir DIR] [--branch BRANCH]
                         [--worktree PATH] [--clients claude,codex,copilot] [--allow-downgrade]
node connect.mjs verify --workbench <path>
```

Two commands, used for almost everything:

- **`status`** looks at every file the connector manages and says, for each one, whether it's
  current, out of date, missing, or edited by hand. It never writes anything.
- **`apply`** fixes whatever `status` found. If a file was edited by hand, `apply` stops instead
  of overwriting it — pass `--force <id>`, naming that file specifically, to overwrite it anyway.

`link` is for a workbench that isn't connected yet. It sets up the worktree, the junction, and the
registry entry, then runs `apply` right after, so a brand-new workbench and an already-connected
one end up going through the same code path. Without `--yes`, it only prints what it would do.

`link` stops (exit 2, nothing written) instead of acting when something already there doesn't
match what it expects: the worktree path is occupied by something else, the branch already exists
somewhere else, the link path points elsewhere, or a registry entry under the same name points to
a different remote. A dirty primary clone is reported as a warning, not a reason to stop —
`git worktree add` never touches it.

Connecting a workbench also turns on the access guardrails: direct file reads, writes, and shell
commands against the linked repository are blocked across every supported agent client (Claude
Code, Codex CLI, Antigravity, GitHub Copilot) until the session gate
(`.agents/oversoul-gate.json`) is opened via `oversoul inspect` or `oversoul prepare`. The guard
figures out what to protect by reading the workbench's own `.linked-repos.json`, so it doesn't
need one repository's name written into it.

`connect.mjs` finds the `oversoul` package next to itself: nested under `./oversoul` once
vendored into a shared repository, or as the sibling `../oversoul` in this workbench's own
development tree. The same file works unmodified in both places, and the same logic now resolves
`_shared/` too — `connect.mjs` sits one level shallower once vendored, since vendoring drops this
package's own folder name while `oversoul/` and `_shared/` keep theirs.

`verify-sync.mjs` is a separate, read-only tool for release time. It hashes every file in a
maintained source package and a vendored copy and reports what's added, removed, or changed. It
takes the source path as an argument and has no opinion about what that source is — today it's
this workbench, and nothing about the tool assumes that stays true.

Tests: `node --test test/*.test.mjs`. Everything runs against temporary directories and a local
bare repository standing in for "origin" — nothing touches GitHub, the real workbench, or the real
Shrimp worktree.
