# {{NAME}}

A shared knowledge repository. The team's records live here in plain Markdown, and a scheduled
GitHub Actions job publishes them to Notion.

## Where things go

| Folder | Holds |
|---|---|
| `work/` | Work Threads: what is being worked on and why |
| `knowledge/` | Durable reference material |
| `proposals/` | Suggested changes, before a decision |
| `decisions/` | Decisions made, with the reasoning kept |
| `tasks/` | Task records and their events |
| `archive/` | Superseded records, kept rather than deleted |

Everything under `.shrimp/system/` is infrastructure delivered by engine releases. Do not edit it by
hand; it is replaced wholesale on the next update. `.shrimp/project.json` is yours and is preserved
across updates.

## Before the first sync

Two things are still unset:

1. **Fill in the Notion identifiers** in `.shrimp/project.json`. Every value ending in `_ID` is a
   placeholder. The sync tool refuses to run until they are real, so nothing publishes by accident.
2. **Add the GitHub remote** and push:

   ```
   git remote add origin git@github.com:{{REPOSITORY}}.git
   git push -u origin main
   ```

Then set the repository variable `NOTION_ENABLED` to `true` and add a `NOTION_WRITE_TOKEN` secret.
Publishing runs only from this repository's own `main` branch in GitHub Actions.

## Updating

The administrator applies a new engine release from the Susu knowledge engine, reviews the resulting
diff, and commits it. Connected workbenches pick the release up the next time they open access.
