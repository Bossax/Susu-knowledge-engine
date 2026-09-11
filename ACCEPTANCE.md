# Connector acceptance — 2026-09-09 (Stage 2 of Connector distribution)

Human requester: Bossa. Recorder: Claude.

## Verified

- Built `connect.mjs` (`status | link | update | verify`) as a two-phase check-then-mutate tool:
  without `--yes`, `link` computes and prints the full plan and mutates nothing; with `--yes`, it
  only mutates steps that were not already `unchanged`, and refuses (exit 2, no mutation) when the
  intended worktree path, branch, link path, or registry entry conflicts with something already
  there.
- `connect.mjs` locates the `oversoul` package next to itself, trying a nested `./oversoul`
  (the post-vendoring layout) before a sibling `../oversoul` (this workbench's development
  layout) — the same file is expected to work unmodified in both places once Stage 3 vendors it
  into Shrimp.
- Added `verify-sync.mjs`, a read-only SHA-256 drift detector between a source and vendored
  package tree, taking both paths as arguments.
- 11 hermetic tests in `test/connect.test.mjs` cover: a dry run mutating nothing; a full connect
  wiring the worktree, junction, registry, all three clients' skill installs, the sentinel-marked
  `AGENTS.md` contract block, `CLAUDE.md`, and MCP declarations for `.mcp.json`/`.vscode/mcp.json`
  /`.codex/config.toml`; full idempotency on a second run; an unrelated existing registry target
  surviving a new `link`; refusal (no mutation) when the worktree or link path is occupied by
  something unexpected; refusal when a registry entry under the same name already points
  somewhere else; a pre-existing `.mcp.json` keeping an unrelated server and not having a
  differing `notion` entry overwritten; `status`/`verify` reporting without mutating; an
  unregistered workbench being reported as such rather than failing; `verify-sync` detecting no
  drift against itself and reporting added/removed/changed files against a mutated copy; and the
  forward-compat no-literals invariant (no file under this package contains a literal
  shared-repo name or repository owner reference).
- Fixed a bug found by the tests themselves: `install.mjs`'s own `--scaffold-agents` template
  originally contained a sentinel-marked stub, which collided with `connect.mjs`'s own sentinel
  injection when `AGENTS.md` was absent on first run, producing two blocks and a false
  "differing block" refusal on the next run. Removed the stub from
  `workbench-adapters/oversoul/templates/agents-scaffold.md` so the sentinel format has exactly
  one owner; also made the contract-write step re-check the file's actual current content rather
  than trusting a pre-install snapshot, as a safety net against similar ordering issues in future.
- All 22 tests pass together: `node --test workbench-adapters/oversoul/test/*.test.mjs
  workbench-adapters/connector/test/*.test.mjs`.
- Ran `connect.mjs status` and a no-`--yes` `link` against the real workbench (from inside the
  real shared-repo worktree, targeting the real `.linked-repos.json` entry). The
  load-bearing checks — worktree, branch, link, registry, `.gitignore` — all correctly reported
  `unchanged`, since this workbench was already hand-provisioned before this tool existed. The
  contract and MCP steps correctly reported genuine gaps (no sentinel-marked `AGENTS.md` block;
  no Notion MCP entry for Codex/Copilot in this workbench) rather than false positives. `--yes`
  was deliberately not run against the real workbench in this stage — see plan Stage 5.

## Known, honest test limitation

- `self-verify` (and `status`/`verify` against a freshly connected workbench) spawn a real
  subprocess running the installed `linked-repo.mjs`, which performs its own real `git fetch
  --no-tags origin`. That subprocess has no way to receive the test's injected local-fetch
  transport, so against the fixture's fake `https://github.com/example/team.git` the fetch
  genuinely fails — correctly reported as the single diagnostic `Fetch failed; remote state is
  unverified`, non-fatal, with everything else (branch, upstream, cleanliness, protocol) still
  verified correct. The tests additionally call the client's own `inspect()` in-process with the
  fetch injected to confirm the wiring would report fully `ready: true` with a reachable remote.

## Remaining acceptance

- macOS: none of this stage has been run on macOS.
- The real workbench has not yet been connected with `--yes` through this tool end-to-end;
  Stage 3 (vendoring into Shrimp) and Stage 5 (real bootstrap validation, including a throwaway
  workbench copy) remain.
- `update.mjs`'s `update` subcommand and `verify` subcommand are covered by one hermetic test
  each; they have not been exercised beyond that.
- No commit, push, merge, or live Notion mutation was performed in this stage.

---

# Connector acceptance — 2026-09-11 (unified install/update mechanism, v2.0.0)

Human requester: Bossa. Recorder: Claude.

## Verified

- Replaced the uneven coverage above (one command writing twelve files, another writing one,
  two more writing none) with a single list of everything the package owns
  (`manifest.mjs`) and two commands that walk it: `status` reports each file's real state and
  touches nothing, `apply` fixes what's not current. `update` is gone as a command name — `apply`
  covers what it used to do and everything it used to miss. `link` now sets up a new workbench and
  then runs `apply` in the same step, instead of being a separate, differently-covered path.
- Every file is checked the same way: what should be there right now, what's actually there, and
  what was last written (recorded in `.agents/oversoul-artifacts.json`). That third piece is what
  lets the tool tell "the package changed" apart from "a person edited this by hand" — something a
  version number alone can't do, since most of these files (a `.gitignore` line, one key in a JSON
  file) can't carry one.
- A workbench connected before this mechanism existed gets real answers on its first `status`
  check too, never "I don't know" — by checking whether required content is simply present, by
  reading version numbers already embedded in files, or by matching against a list of previously
  published file contents.
- Brought four files that nothing previously tracked under the same mechanism: the access-guard
  script (rewritten so it reads what to protect from the workbench's own `.linked-repos.json`
  instead of having one repository's name typed into it — it can now ship as an ordinary managed
  file, and got its first test suite, 8 tests), the untracked second copy of that script, the hook
  entry in `.claude/settings.json` that turns it on, and `.github/copilot-instructions.md`
  (removed — it said the same thing as the `AGENTS.md` section, and Copilot reads that directly).
- Caught a real, live bug while building this: a workbench's `.agents/mcp_config.json` can end up
  with the same top-level key written twice, and `JSON.parse` silently keeps only the second one.
  `status`/`apply` now call this out directly instead of quietly going along with whichever value
  won.
- 39 tests pass together (25 in this package, 14 in oversoul's, plus the existing shared-installer
  test): `node --test workbench-adapters/connector/test/*.test.mjs
  workbench-adapters/oversoul/test/*.test.mjs workbench-adapters/_shared/test/*.test.mjs`.
- Ran `status` against the real workbench. It correctly found exactly what was already known to
  be wrong there — the duplicate-key file, a missing Codex Notion entry, a missing Copilot Notion
  entry, an `AGENTS.md` with no section yet — and reported nothing as unknown.

## Known, honest limitation

- Same one as the entry above: a subprocess spawned during `link`'s self-check does a real
  network fetch that can't reach a fixture's fake GitHub URL, so it reports one expected,
  non-fatal diagnostic rather than a false "ready". Unrelated to this stage's own work.

## Remaining acceptance

- `apply --yes` has not yet been run against the real workbench — two of its files (the guard
  script, the duplicate-key MCP file) would need `--force` or a hand fix first, and doing that is
  its own deliberate step, not something to run in passing.
- macOS: not run there.
- This package's `README.md` now matches the new commands; `VENDORING.md` and the two
  human-facing HTML guides have also been brought up to date in the same session.
