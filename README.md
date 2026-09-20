# Susu Knowledge Engine

Susu Knowledge Engine creates and updates shared team knowledge repositories and provides the Workbench connector used to access them.

## 1. System Overview & Repository Roles

The collaboration infrastructure divides responsibilities across three distinct repository roles:

- **Susu Knowledge Engine** (`Susu-knowledge-engine`): The sole editable source for engine code, connector code, capability schemas, and the Notion sync runtime.
- **Shared Knowledge Repository** (Archetype: Shrimp, e.g. `Soniferous-Shrimp`): The team's durable knowledge repository storing substance records (`work/`, `knowledge/`, `proposals/`, `decisions/`, `tasks/`, `archive/`), configuration, and one approved engine release package. Teams can name this repository anything that fits their project.
- **User Workbenches** (e.g. `susu-project-conductor`, `Susu_Ocean`): Private developer environments where teammates conduct research and collaborate through dedicated Git worktrees and the Oversoul skill.

---

## 2. Installation Manual

### Part A: Scaffolding a New Knowledge Repository (Administrator)

Infrastructure administrators use the engine to create brand-new shared knowledge repositories for projects or partner labs.

#### Step 1: Clone the engine repository

```bash
git clone https://github.com/Bossax/Susu-knowledge-engine.git
cd Susu-knowledge-engine
```

#### Step 2: Choose your knowledge repository name

A knowledge repository can take any name suitable for your research or lab (such as `Bioacoustic-Knowledge-Base`, `Marine-Survey-Records`, or `Acoustic-Ecology-Lab`).
"Shrimp" refers to the internal architecture archetype; your repository is an instance of this archetype.

#### Step 3: Scaffold the repository

You can run the scaffolder interactively or pass explicit command line flags:

- **Interactive Wizard**:
  Run without flags in a terminal:
  ```bash
  node scripts/init-shrimp.mjs
  ```
  The wizard prompts for the target directory, GitHub `OWNER/REPO` coordinates, friendly instance name, and optional Notion database links.

- **Direct Command**:
  ```bash
  node scripts/init-shrimp.mjs --target ../<Your-Knowledge-Repo-Name> --repository <YourOrg>/<Your-Knowledge-Repo-Name> --name "<Friendly Display Name>" --yes
  ```

The scaffolder installs the engine payload, creates `.shrimp/project.json` and `.shrimp/system/protocol.json`, sets up substance folders, and creates an initial Git commit.

#### Step 4: Connect GitHub remote and push

```bash
cd ../<Your-Knowledge-Repo-Name>
git remote add origin https://github.com/<YourOrg>/<Your-Knowledge-Repo-Name>.git
git push -u origin main
```

#### Step 5: Configure Notion synchronization

Open `.shrimp/project.json` and replace placeholder values ending in `_ID` with your real Notion database identifiers:
- `workspaceId`: Target Notion workspace ID.
- `threads`: Work Threads database ID.
- `tasks`: Tasks database ID.
- `activity`: Activity log database ID.
- `dashboardBlock`: Dashboard block ID.

In your GitHub repository settings, add the secret `NOTION_WRITE_TOKEN` and the repository variable `NOTION_ENABLED=true`.
Automated synchronization runs through GitHub Actions on pushes to `main`.

---

### Part B: Connecting a Team Member's Workbench (Collaborator)

Scientists, researchers, and developers connect their local workspace to the team knowledge repository.
Collaborators do not clone `Susu-knowledge-engine`. They only need their local workspace and a clone of the team knowledge repository.

#### Step 1: Clone the team knowledge repository

```bash
git clone https://github.com/<YourOrg>/<Your-Knowledge-Repo-Name>.git
```

#### Step 2: Create a dedicated worktree for your workbench

Each workbench uses a dedicated Git worktree to isolate local drafts and avoid colliding with other collaborators:

```bash
git -C <path-to-knowledge-repo> worktree add -b workbench/<your-username> <path-to-worktree> main
```

#### Step 3: Link your workbench

Run the bootstrap connector from the cloned knowledge repository:

```bash
node <path-to-knowledge-repo>/.shrimp/system/connector/bootstrap/connect.mjs link --workbench <path-to-workbench>
```

This installs the Oversoul skill at `.agents/skills/oversoul/` (or `.claude/skills/oversoul/`), registers the link in `.linked-repos.json`, and configures guardrails.

#### Step 4: Verify the connection

Type `/oversoul` in your workbench chat.
The command displays your connection health banner and the available action menu.

---

## 3. Update Manual

### Part A: Packaging an Engine Release

Engine developers build immutable, deterministic candidate packages from engine commits:

```bash
npm run check    # Verify all 110+ unit and integration tests pass
npm run pack     # Build dist/candidate.tar.gz and dist/manifest.json
```

The manifest records the engine release version, Git commit SHA, and a sha256 bundle hash.
Rebuilding the same commit produces the exact same hash.

---

### Part B: Applying Updates to a Knowledge Repository (Administrator)

Administrators update a shared knowledge repository using `update-shrimp.mjs`.

#### Step 1: Pre-flight branch validation

Check `git branch --show-current` in your local clone of the knowledge repository.
Confirm that `main` is checked out, avoiding stale feature branches.

#### Step 2: Plan the update (Dry run)

```bash
node scripts/update-shrimp.mjs --shrimp <path-to-knowledge-repo> --package dist/candidate.tar.gz
```

The tool reports planned updates across `.shrimp/system/connector`, `.shrimp/system/sync`, and `.shrimp/release.json`.
It confirms that `.shrimp/project.json` and all team substance folders are preserved.

#### Step 3: Apply the update

```bash
node scripts/update-shrimp.mjs --shrimp <path-to-knowledge-repo> --package dist/candidate.tar.gz --yes
```

#### Step 4: Review and commit

Inspect changes with `git -C <path-to-knowledge-repo> diff --stat`.
Confirm that only `.shrimp/system/` files and `.shrimp/release.json` changed.
Commit and push the update:

```bash
git -C <path-to-knowledge-repo> add .shrimp/
git -C <path-to-knowledge-repo> commit -m "feat: adopt engine release <version>"
git -C <path-to-knowledge-repo> push origin main
```

---

### Part C: Workbench Propagation & Auto-Alignment

Team members receive engine updates automatically without running manual re-installation scripts.

#### Automatic alignment flow:

1. The collaborator fast-forwards their dedicated worktree to latest `main`:
   ```bash
   git -C <path-to-worktree> merge --ff-only main
   ```
2. The collaborator runs `/oversoul` in their workbench.
3. The gate script checks `.shrimp/release.json` against the local skill's `engine.json`.
4. If the shared repository carries a newer release, Oversoul replaces the local skill in place automatically.

#### Handling local customizations:

If `connect.mjs update` detects locally modified files (such as custom instructions in `AGENTS.md` or `CLAUDE.md`), it reports the specific files.
Unmodified files update cleanly, while customized files prompt for individual review.

---

## 4. Operation Manual for any Knowledge Repository

### Part A: The Unified `/oversoul` Command Surface

All repository operations run through the `/oversoul` command and its options:

| Command | Action | Description |
|---|---|---|
| `/oversoul` | Status & Menu | Displays connection health banner (repository, branch, sync status) and available action table. |
| `/oversoul --sync` | Synchronize | Pulls upstream changes, fast-forwards clean branches, and opens gate access. |
| `/oversoul --save "<message>"` | Save & Push | Inspects dirty work, drafts a commit message, and pushes to your workbench branch upon approval. |
| `/oversoul --health` | Diagnosis | Verifies Notion tokens, network connectivity, and cache freshness. |
| `/oversoul --list` | Inventory | Lists tracked Work Threads, Tasks, and sync items. |
| `/oversoul --compare` | Diff Check | Compares local records against Notion before syncing. |

You can also speak in natural conversational language (such as "sync latest notes from Notion", "save my work", or "check connection health").
The assistant routes conversational requests directly to the corresponding `/oversoul` action.

---

### Part B: Folder Taxonomy & Storage Rules

Shared knowledge repositories organize team substance into dedicated folders:

| Directory | Purpose | Contents |
|---|---|---|
| `work/` | Active Work Threads | High-level initiatives describing goals, current state, and next actions. |
| `knowledge/` | Reference Material | Durable reference documentation, specifications, and lab protocols. |
| `proposals/` | Proposed Changes | Draft recommendations open for team review. |
| `decisions/` | Architectural Decisions | Final decisions recorded with context and alternatives considered. |
| `tasks/` | Tasks & Activities | Discrete work items and status change logs. |
| `archive/` | Historical Records | Superseded records preserved for audit history. |

Operating rule: Nothing is deleted. If a record becomes obsolete, mark it superseded and move it to `archive/` with reasoning recorded.

---

### Part C: Notion Sync Formatting & Limits

The sync runtime translates Markdown files in `work/` into Notion page blocks.

#### Supported Markdown Elements:
- Headings: Levels 1 through 3 (`#`, `##`, `###`).
- Code blocks: Fenced blocks with syntax highlighting.
- Lists: Flat bulleted or numbered lists.
- Paragraphs: Standard text blocks separated by blank lines.

#### Markdown Elements Rendered Literally:
- Inline formatting like bold, italic, or inline links (`**text**`, `_text_`, `[label](url)`) display as literal characters in Notion.
- Deep headings (level 4+) and blockquotes display as standard paragraphs.

#### 300-Block Truncation Warning:
Notion page bodies exceeding 300 blocks are truncated at publish time.
The sync engine outputs a clear warning and link to the complete source document on GitHub, ensuring zero loss of research context.
