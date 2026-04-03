/**
 * Manages Python environment and OpenAgents SDK installation.
 *
 * Checks for system Python or bundled Python, installs the SDK via pip,
 * and provides the Python executable path for spawning agent processes.
 */

const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class PythonManager {
  constructor() {
    this._pythonPath = null;
    this._sdkInstalled = false;
    this._sdkVersion = null;
    this._detecting = false;
    this._detect();
  }

  getStatus() {
    return {
      pythonPath: this._pythonPath,
      pythonFound: !!this._pythonPath,
      sdkInstalled: this._sdkInstalled,
      sdkVersion: this._sdkVersion,
    };
  }

  getPythonPath() {
    return this._pythonPath;
  }

  /**
   * Run a command with proper quoting for paths with spaces on Windows.
   */
  _execQuoted(pythonPath, args, opts) {
    const isWin = process.platform === 'win32';
    if (isWin) {
      // On Windows, quote the python path and use exec (shell) to handle spaces
      const cmdLine = `"${pythonPath}" ${args.join(' ')}`;
      return execSync(cmdLine, { shell: true, ...opts }).toString().trim();
    } else {
      return execSync(`${pythonPath} ${args.join(' ')}`, opts).toString().trim();
    }
  }

  _detect() {
    if (this._detecting) return;
    this._detecting = true;

    const candidates = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];

    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        if (version.includes('Python 3.')) {
          // Get full path
          const whichCmd = process.platform === 'win32' ? 'where' : 'which';
          const fullPath = execSync(`${whichCmd} ${cmd}`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim().split('\n')[0].trim();

          this._pythonPath = fullPath || cmd;
          break;
        }
      } catch {
        continue;
      }
    }

    if (this._pythonPath) {
      this._checkSDK();
    }

    this._detecting = false;
  }

  _checkSDK() {
    try {
      const result = this._execQuoted(
        this._pythonPath,
        ['-c', '"import openagents; print(openagents.__version__)"'],
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this._sdkInstalled = true;
      this._sdkVersion = result;
    } catch {
      this._sdkInstalled = false;
      this._sdkVersion = null;
    }
  }

  /**
   * Install or upgrade the OpenAgents SDK via pip.
   */
  installSDK() {
    return new Promise((resolve, reject) => {
      if (!this._pythonPath) {
        reject(new Error('Python not found. Please install Python 3.10+ first.'));
        return;
      }

      const isWin = process.platform === 'win32';
      const args = ['-m', 'pip', 'install', '--upgrade', 'openagents'];

      if (isWin) {
        const cmdLine = `"${this._pythonPath}" ${args.join(' ')}`;
        exec(cmdLine, {
          timeout: 120000,
          encoding: 'utf-8',
          shell: true,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`pip install failed: ${(stderr || error.message).substring(0, 500)}`));
            return;
          }
          this._checkSDK();
          resolve({ success: true, version: this._sdkVersion, output: stdout });
        });
      } else {
        exec(`${this._pythonPath} ${args.join(' ')}`, {
          timeout: 120000,
          encoding: 'utf-8',
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`pip install failed: ${(stderr || error.message).substring(0, 500)}`));
            return;
          }
          this._checkSDK();
          resolve({ success: true, version: this._sdkVersion, output: stdout });
        });
      }
    });
  }
}

module.exports = { PythonManager };
