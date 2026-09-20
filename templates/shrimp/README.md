# {{NAME}}

A shared knowledge repository for team collaboration.
Team members use this repository to maintain durable records, collaborate on projects, and synchronize with Notion.

For complete infrastructure specifications, scaffolding instructions, and the administrator update manual, see [Susu Knowledge Engine](https://github.com/Bossax/Susu-knowledge-engine).

---

## How to connect your project to this knowledge base?

Connecting your project workbench takes four simple steps:

1. **Clone this repository**:
   ```bash
   git clone https://github.com/{{REPOSITORY}}.git
   ```

2. **Create your dedicated worktree**:
   Create an isolated folder linked to this repository for your daily work:
   ```bash
   git -C {{NAME}} worktree add -b workbench/<your-name> ../{{NAME}}-worktrees/<your-name> main
   ```

3. **Link your project workbench**:
   Run the connector script from your project root folder:
   ```bash
   node ../{{NAME}}/.shrimp/system/connector/bootstrap/connect.mjs link --workbench .
   ```
   This installs the Oversoul skill directly into your project's `.agents/skills/oversoul/` folder and registers the connection in `.linked-repos.json`.

4. **Verify your connection**:
   Open your AI assistant in your project workbench and run:
   ```bash
   /oversoul
   ```
   The assistant displays your active branch, repository health, and available actions.

---

## How to interact with this knowledge base?

Teammates interact with this repository through the `/oversoul` command in their workbench:

| Command | Action | What it does |
|---|---|---|
| `/oversoul` | Status & Menu | Shows connection health, active branch, and the action menu. |
| `/oversoul --sync` | Sync Upstream | Pulls latest changes from team members and opens repository access. |
| `/oversoul --save "<message>"` | Save & Push | Shows a summary of your local edits and pushes upon your confirmation. |
| `/oversoul --health` | Health Check | Verifies Notion tokens, database connections, and cache freshness. |
| `/oversoul --list` | Tracked Items | Lists active Work Threads, Tasks, and sync items. |
| `/oversoul --compare` | Diff Check | Compares local records against Notion before syncing. |

You can also speak in plain conversational language (such as "sync with Notion", "save my work", or "check connection health").
Your assistant automatically routes conversational requests to the right action.

---

## Daily Team Workflow

Most of your time is spent thinking and analyzing in your local workspace:

1. **Work in your workspace**: Conduct analysis and draft notes in your own project files.
2. **Check team state**: Use `/oversoul` or `/oversoul --list` to view active Work Threads and assigned Tasks.
3. **Draft a proposal or decision**: Add a new proposal in `proposals/` or record a chosen path in `decisions/`.
4. **Update Work Threads**: Append a progress log entry to the active thread in `work/`.
5. **Save and share**: Run `/oversoul --save "<message>"` to review changes, draft a commit, and push to your team branch.

GitHub Actions automatically publishes records from `main` to Notion on scheduled runs.

---

## Keeping Your Workbench in Sync with Engine Updates

When an administrator updates the infrastructure on `main`, keeping your local workbench aligned takes two simple steps:

1. **Fast-forward your dedicated worktree**:
   ```bash
   git -C <path-to-your-worktree> merge --ff-only main
   ```

2. **Run `/oversoul`**:
   The gate check compares versions automatically.
   When this repository carries a newer approved engine release, Oversoul replaces your local workbench skill in place automatically.

The update process handles file replacement and dependency alignment automatically.

---

## Folder Taxonomy

| Folder | What goes here |
|---|---|
| `work/` | Active Work Threads: current initiatives, context, and log entries. |
| `knowledge/` | Reusable reference material, verified methods, and settled parameters. |
| `proposals/` | Proposed changes and research options open for team review. |
| `decisions/` | Concluded decisions with reasons and recorded trade-offs. |
| `tasks/` | Concrete task records and state change events. |
| `archive/` | Historical and superseded records kept for permanent reference. |

---

## Before the First Sync

Two configuration items require initial setup by the repository owner:

1. **Fill in Notion identifiers** in `.shrimp/project.json`. Placeholders ending in `_ID` safeguard against publishing to unintended workspaces.
2. **Set repository secrets and variables** in GitHub repository settings:
   - Set the repository variable `NOTION_ENABLED` to `true`.
   - Add the `NOTION_WRITE_TOKEN` repository secret.

Publishing runs from this repository's own `main` branch through GitHub Actions.

---

## Infrastructure Reference

Infrastructure files in `.shrimp/system/` are managed automatically by engine releases:
- Detailed setup, administrator updates, and connector mechanics live in the [Susu Knowledge Engine Reference Manual](https://github.com/Bossax/Susu-knowledge-engine).
- Instance configuration lives in `.shrimp/project.json` and is preserved across updates.
