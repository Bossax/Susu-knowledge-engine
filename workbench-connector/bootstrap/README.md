# Workbench bootstrap

`connect.mjs` links a Workbench to an existing knowledge repository and manages the installed connector files declared in `manifest.mjs`.

## Commands

```text
node workbench-connector/bootstrap/connect.mjs link --workbench PATH [--yes]
node workbench-connector/bootstrap/connect.mjs status --workbench PATH
node workbench-connector/bootstrap/connect.mjs update --workbench PATH [--yes]
node workbench-connector/bootstrap/connect.mjs verify --workbench PATH
```

Commands plan before writing, preserve locally modified managed files, and require explicit flags for mutation or downgrade behavior.
