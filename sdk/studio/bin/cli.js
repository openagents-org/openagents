#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'start') {
  // Start the studio server
  const projectRoot = path.resolve(__dirname, '..');

  const startProcess = spawn('npm', ['start'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  });

  startProcess.on('error', (error) => {
    console.error('Failed to start OpenAgents Studio:', error);
    process.exit(1);
  });

  startProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === 'build') {
  // Build the studio
  const projectRoot = path.resolve(__dirname, '..');

  const buildProcess = spawn('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  });

  buildProcess.on('error', (error) => {
    console.error('Failed to build OpenAgents Studio:', error);
    process.exit(1);
  });

  buildProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else {
  console.log('OpenAgents Studio');
  console.log('');
  console.log('Usage:');
  console.log('  openagents-studio start    Start the development server');
  console.log('  openagents-studio build    Build the production bundle');
  console.log('');
  process.exit(0);
}
