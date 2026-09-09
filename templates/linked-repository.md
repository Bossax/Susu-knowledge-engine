### Linked repository: {{TARGET}}

This workbench exposes a dedicated Git worktree of the shared knowledge-base repository through
the Git-ignored `{{DIR}}/` directory junction (or symlink on macOS), on branch `{{BRANCH}}`. It
does not contain or maintain a second copy of that repository.

When instructed to interact with `{{TARGET}}`, use the generic installed linked-repository client
through the installed `oversoul` skill from the workbench root. Its machine-local registry is
`{{REGISTRY}}`. The target's `protocol.json`, `AGENTS.md`, and linked documents supply its
current protocol; this file does not duplicate that policy. Dirty or divergent state remains a
human choice — the client never merges, rebases, resets, or force-pushes silently.

The shared knowledge base and its connected services are contacted on demand when an update must
be sent or verified, not automatically at the start of every workbench session.
