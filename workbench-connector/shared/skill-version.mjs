// Shared version parsing so every workbench-adapters installer/validator uses one source of truth.
export function parseVersion(skillMdText) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMdText)?.[1];
  return /^\s{2}version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(frontmatter ?? '')?.[1];
}

export function compare(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
  return 0;
}
