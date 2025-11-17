#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const artifactsDir = path.join(root, 'artifacts');
const nodeBinary = process.execPath;
const npxBinary = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function resolveVsceCli() {
  try {
    return require.resolve('@vscode/vsce/out/vsce', { paths: [root] });
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    target: undefined,
    skipBuild: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--target':
        options.target = argv[i + 1];
        if (!options.target) {
          throw new Error('Missing value for --target');
        }
        i += 1;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const { target, skipBuild } = parseArgs(process.argv.slice(2));
const targetSuffix = target ? `-${target}` : '';
const vsixName = `${pkg.name}-${pkg.version}${targetSuffix}.vsix`;
const outputPath = path.join(artifactsDir, vsixName);
const vsceCli = resolveVsceCli();

const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
};

try {
  fs.mkdirSync(artifactsDir, { recursive: true });
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath);
  }

  if (!skipBuild) {
    run('npm', ['run', 'build']);
  }

  const vsceArgs = ['package', '--out', outputPath];
  if (target) {
    vsceArgs.push('--target', target);
  }

  if (vsceCli) {
    run(nodeBinary, [vsceCli, ...vsceArgs]);
  } else {
    console.warn('warning: @vscode/vsce not found locally, falling back to npx vsce');
    run(npxBinary, ['vsce', ...vsceArgs]);
  }

  console.log(`VSIX written to ${outputPath}`);
} catch (error) {
  console.error('Failed to create VSIX:', error.message);
  process.exit(1);
}


