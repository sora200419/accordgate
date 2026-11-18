// F-001 guard: package names written in the docs must match package.json.
// (a) a package mentioned in backticks must be a direct dependency, unless ALLOWED says why not;
// (b) a line saying "not in / removed from package.json" must not name a direct dependency.
// A backtick token counts as a package when it is scoped (`@scope/name`) or installed per
// package-lock.json, so code words like `fetch` are ignored. Not checked: unscoped names that are
// not installed, upper case, or a version inside the backticks. Check (b) is per line, so a line
// that says one package was removed and names a kept one fails (closed); split such lines.
// Run: `npm run check:docs` (default files) or `tsx scripts/check-doc-packages.ts <file>...`.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Mentioned on purpose although not a direct dependency.
export const ALLOWED: Record<string, string> = {
  '@google/genai': 'removed 2026-11-18; SECURITY.md keeps it as history',
  '@grpc/grpc-js': 'transitive (npm audit advisory)',
  picomatch: 'transitive (npm audit advisory)',
  uuid: 'transitive (npm audit advisory)',
};

const TOKEN = /`((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)`/g;
const SAYS_ABSENT = /(not in|removed from) package\.json/i;

export function findProblems(file: string, text: string, direct: Set<string>, installed: Set<string>): string[] {
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [, name] of line.matchAll(TOKEN)) {
      if (!name.startsWith('@') && !installed.has(name)) continue;
      const where = `${file}:${i + 1}: ${name}`;
      if (SAYS_ABSENT.test(line) && direct.has(name)) {
        problems.push(`${where} — line says it is not in package.json, but it is a direct dependency`);
      } else if (!direct.has(name) && !(name in ALLOWED)) {
        problems.push(`${where} — not a direct dependency in package.json (add it to ALLOWED with a reason if intended)`);
      }
    }
  });
  return problems;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const installed = new Set(
    Object.keys(lock.packages ?? {})
      .filter((key) => key.includes('node_modules/'))
      .map((key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)),
  );
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        'README.md',
        'CLAUDE.md',
        ...fs
          .readdirSync('docs', { recursive: true })
          .map(String)
          .filter((f) => f.endsWith('.md'))
          .map((f) => path.join('docs', f)),
      ];
  const problems = files.flatMap((f) => findProblems(f, fs.readFileSync(f, 'utf8'), direct, installed));
  for (const p of problems) console.error(p);
  console.log(`check-doc-packages: ${files.length} files, ${problems.length} problem(s)`);
  if (problems.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
