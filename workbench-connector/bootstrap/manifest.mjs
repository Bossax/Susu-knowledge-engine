// Pure data: every file the engine owns in a connected workbench, and the one-time
// connection facts that are provisioned rather than kept current. Built with `buildManifest(ctx)`
// rather than exported as static data, because several entries need the oversoul package's own
// SKILL.md version and the rendered template text read at run time -- see connect.mjs for how
// `ctx` is assembled.

export const NOTION_URL = 'https://mcp.notion.com/mcp';

export function buildArtifacts({oversoulPath, payloadDir, contractTemplateText, promptTemplatePath}) {
  return [
    {id: 'skill:claude', kind: 'tree', skillId: 'oversoul', clients: ['claude'], dest: '.claude/skills/oversoul', source: oversoulPath},
    {id: 'skill:agents', kind: 'tree', skillId: 'oversoul', clients: ['codex', 'copilot'], dest: '.agents/skills/oversoul', source: oversoulPath},
    {
      id: 'copilot-prompt', kind: 'render', clients: ['copilot'], dest: '.github/prompts/oversoul.prompt.md',
      template: promptTemplatePath,
      substitutions: [['workbench-connector/oversoul/SKILL.md', '.agents/skills/oversoul/SKILL.md']],
    },
    {
      id: 'contract', kind: 'sentinel-block', dest: 'AGENTS.md',
      templateText: contractTemplateText,
    },
    {id: 'claude-md', kind: 'file', clients: ['claude'], dest: 'CLAUDE.md', contains: '@./AGENTS.md', content: '@./AGENTS.md\n', onLocallyModified: 'preserve'},
    {
      id: 'gitignore', kind: 'lines', dest: '.gitignore', requires: 'workbench-is-git-repo',
      header: '# Linked knowledge-base worktree (added by connect)',
      // {{DIR}} and {{REGISTRY}} are substituted by connect.mjs before this list reaches a probe/apply call.
      lines: ['/{{DIR}}/', '/.linked-repos.json', '.claude/skills/oversoul/', '.agents/', '.github/prompts/oversoul.prompt.md', '.codex/config.toml'],
    },
    {id: 'mcp:claude', kind: 'json-merge', clients: ['claude'], dest: '.mcp.json', keyPath: ['mcpServers', 'notion'], value: {type: 'http', url: NOTION_URL}},
    {id: 'mcp:copilot', kind: 'json-merge', clients: ['copilot'], dest: '.vscode/mcp.json', keyPath: ['servers', 'notion'], value: {type: 'http', url: NOTION_URL}},
    {id: 'mcp:codex', kind: 'toml-block', clients: ['codex'], dest: '.codex/config.toml', marker: '[mcp_servers.notion]', block: `[mcp_servers.notion]\nurl = "${NOTION_URL}"\n`},
    {id: 'mcp:antigravity', kind: 'json-merge', clients: ['antigravity'], dest: '.agents/mcp_config.json', keyPath: ['mcpServers', 'notion'], value: {serverUrl: NOTION_URL}, onDuplicateKey: 'block'},
    {
      id: 'guardrail-script', kind: 'copy', clients: ['claude', 'codex', 'copilot', 'antigravity'],
      source: `${payloadDir}/guardrail-check.mjs`,
      dest: ['scripts/guardrail-check.mjs', '.agents/scripts/guardrail-check.mjs'],
    },
    {
      id: 'claude-hook', kind: 'json-array-entry', clients: ['claude'], dest: '.claude/settings.json',
      keyPath: ['hooks', 'PreToolUse'],
      identifyBy: {path: 'hooks.0.command', equals: 'node scripts/guardrail-check.mjs'},
      value: {matcher: 'Read|Write|Edit|Bash', hooks: [{type: 'command', command: 'node scripts/guardrail-check.mjs', timeout: 15}]},
    },
    {
      id: 'copilot-instructions', kind: 'absent', dest: '.github/copilot-instructions.md',
      reason: 'Superseded by the AGENTS.md contract block; GitHub Copilot reads AGENTS.md natively',
      // The hand-written content every workbench connected before this mechanism existed was
      // given (see the Golden Rules guardrail backlog). Recognized content like this is safe to
      // remove automatically; anything else is a human's own file and is left alone, reported.
      knownHashes: [{hash: 'sha256:daee0951161f0d9c1214c65b50c0d7eeceb891b354b762ec7a4b2a4633e65071', version: '1.11.0'}],
    },
  ];
}
