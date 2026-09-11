### Linked repository: {{TARGET}}

This workbench exposes a dedicated Git worktree of the shared knowledge-base repository through
the Git-ignored `{{DIR}}/` directory junction (or symlink on macOS), on branch `{{BRANCH}}`. It
does not contain or maintain a second copy of that repository.

#### Access Guardrail: Direct Read/Write Blocked
Direct access to `{{DIR}}/` with generic file tools (Read, Write, Edit, Patch) or shell commands
is blocked. The workbench enforces this boundary to ensure agents do not act on stale or divergent
revisions. All operations must proceed through the `oversoul` skill.

#### Using the Oversoul Skill
Use the generic installed linked-repository client through the installed `oversoul` skill from
the workbench root. Its machine-local registry is `{{REGISTRY}}`.

1. **Inspect**: `node <skill>/scripts/linked-repo.mjs inspect --target {{TARGET}}` (or `/oversoul inspect` / `/oversoul`)
   Checks synchronization, remote status (ahead/behind), and local changes, and returns a `ready`
   field (true or false) that is the sole authority on whether the session gate opened — read that
   field from the command's own output, don't re-derive it. A non-empty raw `changes` line is not
   by itself proof of anything: it can be line-ending noise with no real content difference, which
   the command already accounts for. `ready: true` means the gate (`.agents/oversoul-gate.json`) is
   open for the active session; `ready: false` means it was revoked, with `diagnostics` saying why.
2. **Prepare**: `node <skill>/scripts/linked-repo.mjs prepare --target {{TARGET}}` (or `/oversoul prepare`)
   Safely fast-forwards the worktree if it is strictly behind upstream and opens the session gate
   lease on success, reported the same way via `ready`.
3. **Run**: `node <skill>/scripts/linked-repo.mjs run --target {{TARGET}} --capability <NAME> [-- <args>]`
   Executes interactive capabilities advertised in the target's `protocol.json`.

The target's `protocol.json`, `AGENTS.md`, and linked documents supply its current protocol; this file
does not duplicate that policy. A real dirty change (not line-ending noise) or a branch both ahead and
behind upstream remains a human choice; the client never merges, rebases, resets, or force-pushes
silently.

The shared knowledge base and its connected services are contacted on demand when an update must
be sent or verified, not automatically at the start of every workbench session.
