import { spawnSync } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const bunCommand = process.env.BUN_BINARY || 'bun';

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.error) {
    if (command === bunCommand && result.error.code === 'ENOENT') {
      console.error('Bun is required to run test/build checks. Install Bun or set BUN_BINARY.');
    } else {
      console.error(`${label} failed to start: ${result.error.message}`);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [path.join('scripts', 'lint.mjs')], 'lint');
run(bunCommand, ['test'], 'test');
run(bunCommand, ['build', './index.ts', '--outdir', 'dist', '--target', 'bun'], 'build');

console.log('Check passed.');
