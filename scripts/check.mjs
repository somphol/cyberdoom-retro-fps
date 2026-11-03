#!/usr/bin/env node
// Dependency-free release check for CYBERDOOM.
//
//   node scripts/check.mjs
//
// Verifies required files, local HTML references, relative Markdown links,
// JavaScript syntax (node --check), JSON parsing, and that the skill template
// still matches the released sources byte-for-byte.
//
// Exit codes: 0 all checks pass, 1 one or more checks failed.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_ID = 'cyberdoom-retro-fps';
const SKIP_DIRS = new Set(['.git', 'node_modules', '_site', 'dist', 'shots', 'film']);

let checks = 0;
const failures = [];

function check(name, fn) {
  checks += 1;
  try {
    const result = fn();
    if (result === false) failures.push(`${name} — returned false`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    failures.push(`${name} — ${message}`);
  }
}

function walk(directory, predicate) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.nojekyll') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...walk(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      found.push(path);
    }
  }
  return found;
}

function cleanTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function isRemote(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) || target.startsWith('#') || target.startsWith('/');
}

const REQUIRED = [
  'index.html',
  'style.css',
  'script.js',
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'docs/ARCHITECTURE.md',
  'docs/REPRODUCTION.md',
  'docs/DEPLOYMENT.md',
  'docs/TESTING.md',
  `skills/${SKILL_ID}/SKILL.md`,
  `skills/${SKILL_ID}/ATTRIBUTION.md`,
  `skills/${SKILL_ID}/references/method.md`,
  `skills/${SKILL_ID}/references/lessons.md`,
  `skills/${SKILL_ID}/references/verification.md`,
  `skills/${SKILL_ID}/assets/template/index.html`,
  `skills/${SKILL_ID}/assets/template/style.css`,
  `skills/${SKILL_ID}/assets/template/script.js`
];

for (const file of REQUIRED) {
  check(`required file ${file}`, () => existsSync(join(ROOT, file)));
}

const indexHtml = join(ROOT, 'index.html');
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const raw of refs) {
    if (isRemote(raw)) continue;
    const target = cleanTarget(raw);
    if (!target) continue;
    check(`index.html local reference ${raw}`, () => existsSync(resolve(ROOT, target)));
  }
}

const MARKDOWN = [
  join(ROOT, 'README.md'),
  join(ROOT, 'AGENTS.md'),
  ...walk(join(ROOT, 'docs'), (path) => extname(path).toLowerCase() === '.md')
];
for (const file of MARKDOWN) {
  if (!existsSync(file)) continue;
  const body = readFileSync(file, 'utf8');
  const links = [...body.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  for (const raw of links) {
    if (isRemote(raw)) continue;
    const target = cleanTarget(raw);
    if (!target) continue;
    check(`Markdown link ${relative(ROOT, file)} -> ${target}`, () =>
      existsSync(resolve(dirname(file), target))
    );
  }
}

const JS_FILES = walk(ROOT, (path) => extname(path).toLowerCase() === '.js');
for (const file of JS_FILES) {
  check(`node --check ${relative(ROOT, file)}`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  });
}

const JSON_FILES = walk(ROOT, (path) => extname(path).toLowerCase() === '.json');
for (const file of JSON_FILES) {
  check(`JSON parses ${relative(ROOT, file)}`, () => {
    JSON.parse(readFileSync(file, 'utf8'));
    return true;
  });
}

const templateDir = join(ROOT, 'skills', SKILL_ID, 'assets', 'template');
for (const name of ['index.html', 'style.css', 'script.js']) {
  check(`skill template ${name} is byte-identical`, () => {
    const released = readFileSync(join(ROOT, name));
    const template = readFileSync(join(templateDir, name));
    return released.equals(template);
  });
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`FAILED ${failures.length} of ${checks} checks`);
  process.exit(1);
}

console.log(`OK ${checks} checks`);
