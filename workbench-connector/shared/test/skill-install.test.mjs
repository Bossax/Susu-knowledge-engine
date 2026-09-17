import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSkill} from '../skill-install.mjs';

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function makeSkill(root, version) {
  const dir = join(root, 'skill-' + version);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'SKILL.md'), '---\nname: demo\n  version: ' + version + '\n---\n# Demo\n');
  return dir;
}

test('shared installer is agnostic to which skill calls it: fresh install then forward upgrade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-'));
  const project = join(root, 'project');
  const v1 = await makeSkill(root, '0.1.0');
  const v2 = await makeSkill(root, '0.2.0');
  const pathFor = () => join(project, '.claude', 'skills', 'demo');

  let results = await installSkill({skillId: 'demo', source: v1, project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'installed');
  assert.equal(await exists(join(project, '.claude', 'skills', 'demo', 'SKILL.md')), true);

  results = await installSkill({skillId: 'demo', source: v2, project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'upgraded');
  assert.match(await readFile(join(project, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'), /version:\s*0\.2\.0/);

  results = await installSkill({skillId: 'demo', source: v1, project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'blocked');
  assert.equal(results[0].failed, true);
});
