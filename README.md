# Oversoul package

Node 24.11+ (24 LTS) and Git are required. No package installation is needed for the client.

From the workbench root run
`node workbench-adapters/oversoul/scripts/install.mjs codex claude`. This installs the same
package at project scope: `.agents/skills/oversoul` for Codex and
`.claude/skills/oversoul` for Claude Code. These ignored copies belong only to this workbench;
there is no user-global installation. Existing project installations are preserved and reported
rather than overwritten. Restart the client session if its skill list was already loaded.
Use `$oversoul` in Codex or `/oversoul` in Claude Code while working in this project.

For Copilot, copy `integrations/oversoul.prompt.md` to this workbench's `.github/prompts/` and
keep this package at `workbench-adapters/oversoul`, or update the prompt's single skill path.
Opening SKILL.md as explicit context is also supported. This package is prepared for Copilot;
an interactive pilot is still required on a machine with Copilot.

Register existing worktree links in this project's ignored workbench-root `.linked-repos.json`:

```json
{"version":1,"targets":{"Shrimp":{"path":"Soniferous-Shrimp","remote":"https://github.com/Bossax/Soniferous-Shrimp.git","branch":"workbench/susu-project-conductor","upstream":"origin/main"}}}
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

Inspect returns repository evidence even when dirty or offline. Prepare fast-forwards only a
clean behind branch. Run repeats preflight and refuses dirty, ahead, divergent or unverified
state. Exit 0 is success, 2 is blocked/unverified operation, and 1 is an invalid request or
preflight exception. Reports do not imply an agent has already read the returned documents.
The run command accepts capability-declared option/value pairs after `--`; repository-root,
configuration, executable and arbitrary shell overrides are not accepted.

Tests: `node --test test/client.test.mjs`. Tests use temporary local Git repositories and
inject only the fetch transport; they do not contact GitHub or mutate the real worktree.
