import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Read all stdin
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Extract any paths and commands from caller payload
function extractTargets(payload) {
  const paths = [];
  const commands = [];

  const toolInput = payload.tool_input || payload.toolCall?.args || {};

  if (typeof toolInput === 'string') {
    commands.push(toolInput);
  } else if (typeof toolInput === 'object' && toolInput !== null) {
    if (typeof toolInput.file_path === 'string') paths.push(toolInput.file_path);
    if (typeof toolInput.path === 'string') paths.push(toolInput.path);
    if (typeof toolInput.TargetFile === 'string') paths.push(toolInput.TargetFile);
    if (typeof toolInput.AbsolutePath === 'string') paths.push(toolInput.AbsolutePath);
    if (typeof toolInput.command === 'string') commands.push(toolInput.command);
    if (typeof toolInput.CommandLine === 'string') commands.push(toolInput.CommandLine);
    if (typeof toolInput.patch === 'string') commands.push(toolInput.patch);
  }

  return {paths, commands};
}

// The set of linked-repository directory names to guard is read from this workbench's own
// `.linked-repos.json`, never hardcoded -- a package that knows one specific repository's name
// cannot be shipped as an ordinary managed artifact to a different workbench, and would break the
// moment a workbench links a second target. An absent or unreadable registry guards nothing,
// which matches today's behavior before any target is ever linked.
async function linkedDirNames(workbenchRoot) {
  try {
    const registry = JSON.parse(await readFile(join(workbenchRoot, '.linked-repos.json'), 'utf8'));
    return Object.values(registry.targets ?? {}).map(t => t.path).filter(Boolean);
  } catch {
    return [];
  }
}

function buildPattern(dirNames) {
  if (!dirNames.length) return null;
  const escaped = dirNames.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

function touchesLinkedRepo(pattern, paths, commands) {
  if (!pattern) return {hit: false};
  for (const p of paths) {
    const m = pattern.exec(p);
    if (m) return {hit: true, target: m[0]};
  }
  for (const c of commands) {
    const m = pattern.exec(c);
    if (m) {
      if (/linked-repo\.mjs/i.test(c) || /connect\.mjs/i.test(c)) continue;
      return {hit: true, target: m[0]};
    }
  }
  return {hit: false};
}

async function isGateOpen(workbenchRoot) {
  const candidatePaths = [
    join(workbenchRoot, '.agents', 'oversoul-gate.json'),
    join(workbenchRoot, 'oversoul-gate.json'),
    join(workbenchRoot, '..', '.agents', 'oversoul-gate.json'),
  ];
  for (const leasePath of candidatePaths) {
    try {
      const data = JSON.parse(await readFile(leasePath, 'utf8'));
      if (!data.expiresAt) continue;
      const expiry = new Date(data.expiresAt).getTime();
      if (Date.now() <= expiry) return true;
    } catch {}
  }
  return false;
}

function respond(payload, decision, reason) {
  const isAgy = Boolean(payload.toolCall);
  if (isAgy) {
    console.log(JSON.stringify(reason ? {decision, reason} : {decision}));
  } else if (payload.hookEventName === 'PreToolUse') {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        ...(reason ? {permissionDecisionReason: reason} : {}),
      },
    }));
  } else if (decision === 'deny') {
    // Claude Code hook contract: stderr explanation + exit code 2.
    console.error(reason);
    process.exitCode = 2;
    return;
  }
  process.exitCode = 0;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) { process.exitCode = 0; return; }

  let payload;
  try { payload = JSON.parse(raw); } catch { process.exitCode = 0; return; }

  const workbenchRoot = process.cwd();
  const {paths, commands} = extractTargets(payload);
  const pattern = buildPattern(await linkedDirNames(workbenchRoot));
  const {hit, target} = touchesLinkedRepo(pattern, paths, commands);

  if (!hit) return respond(payload, 'allow');

  if (await isGateOpen(workbenchRoot)) return respond(payload, 'allow');

  const reason = `Gate closed: direct access to ${target ?? 'the linked repository'} is prevented until synchronization is verified. Run /oversoul (or the installed client's \`prepare\` command) to open the gate.`;
  respond(payload, 'deny', reason);
}

main().catch(err => {
  console.error('Guardrail error:', err);
  process.exitCode = 0;
});
