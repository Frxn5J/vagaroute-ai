import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const includePaths = [
  'core',
  'middlewares',
  'services',
  'utils',
  'tests',
  'index.ts',
  'types.ts',
];
const sourceExtensions = new Set(['.ts', '.js', '.mjs']);
const forbiddenPatterns = [
  {
    pattern: /\bdebugger\b/,
    message: 'Remove debugger statements before shipping.',
  },
  {
    pattern: /\bconsole\.log\s*\(/,
    message: 'Use the structured logger instead of console.log.',
  },
];

function walk(targetPath, output = []) {
  const absolutePath = path.join(rootDir, targetPath);
  if (!statSync(absolutePath).isDirectory()) {
    output.push(absolutePath);
    return output;
  }

  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }

    const relativePath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      walk(relativePath, output);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      output.push(path.join(rootDir, relativePath));
    }
  }

  return output;
}

const files = includePaths.flatMap((item) => walk(item));
const failures = [];

for (const filePath of files) {
  const content = readFileSync(filePath, 'utf8');

  for (const rule of forbiddenPatterns) {
    if (rule.pattern.test(content)) {
      failures.push(`${path.relative(rootDir, filePath)}: ${rule.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Lint failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Lint passed for ${files.length} files.`);
