# Oversoul package

Node 24.11+ (24 LTS) and Git are required. No package installation is needed for the client.

From the workbench root run
`node workbench-connector/oversoul/scripts/install.mjs codex claude copilot`. This installs the
same package at project scope: `.claude/skills/oversoul` for Claude Code and
`.agents/skills/oversoul` shared by Codex and Copilot. These ignored copies belong only to this
workbench; there is no user-global installation. Use `$oversoul` in Codex or `/oversoul` in
Claude Code while working in this project.

The installer is version-aware: an absent target is installed, an equal version is left
unchanged, a newer source upgrades an older installation in place (removing any file the old
installation had that the new one doesn't), and an installed version newer than the source is
refused unless `--allow-downgrade` is passed. A legacy installation with a valid `SKILL.md` version
is migrated to the engine release model. Unreadable metadata blocks replacement. Restart the client session after an
install or upgrade if its skill list was already loaded.

If the project has no `AGENTS.md` yet, pass `--scaffold-agents` to create a minimal one instead
of failing; without the flag, installation refuses to proceed so a project's own instructions are
never silently created behind its back.

`copilot` installs to the same `.agents/skills/oversoul` path as `codex` and also writes
`.github/prompts/oversoul.prompt.md` from `integrations/oversoul.prompt.md`, rewriting its single
skill path to the installed location. Opening SKILL.md as explicit context is also supported.
This package is prepared for Copilot; an interactive pilot is still required on a machine with
Copilot.

Register existing worktree links in this project's ignored workbench-root `.linked-repos.json`:

```json
{"version":1,"targets":{"Team":{"path":"Team","remote":"https://github.com/example/team.git","branch":"workbench/my-workbench","upstream":"origin/main"}}}
```

Use the branch assigned to that workbench. Registration is machine-local; it carries neither
credentials nor protocol. Windows uses a directory junction and macOS a directory symlink.
Provisioning those links is outside this client. The registered link must point to a dedicated
worktree, not the primary clone. Git's normal ownership checks remain in force.

Client examples, from the workbench:

```text
node <skill>/scripts/linked-repo.mjs inspect --target Shrimp
node <skill>/scripts/linked-repo.mjs prepare --target Shrimp
node <skill>/scripts/linked-repo.mjs run --target Shrimp --capability inventory
```

Inspect returns repository evidence even when dirty or offline, and opens the session gate lease
(`.agents/oversoul-gate.json`) when the target is clean and synchronized. Prepare fast-forwards only a
clean behind branch and opens the session gate lease. Run repeats preflight and refuses dirty, ahead,
divergent or unverified state. Exit 0 is success, 2 is blocked/unverified operation, and 1 is an invalid
request or preflight exception. Reports do not imply an agent has already read the returned documents.
The run command accepts capability-declared option/value pairs after `--`; repository-root,
configuration, executable and arbitrary shell overrides are not accepted.
Direct read and write access to the linked repository is blocked until `inspect` or `prepare` opens
the session gate lease.

Tests: `npm test`. Tests use temporary local Git repositories and directories
and inject only the fetch transport; they do not contact GitHub, npm, or mutate the real
workbench or worktree.
