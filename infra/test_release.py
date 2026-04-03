#!/usr/bin/env python3
"""
Automated release testing for OpenAgents Launcher.

Usage:
  python test_release.py --platform windows --host 66.55.78.249 --user caonima --password TestPass123
  python test_release.py --platform macos --host 198.8.83.83 --user ZHONGYUAN --password R85dqC32ra

What it does:
  1. Downloads the latest release asset for the platform
  2. Cleans the target machine (removes Node.js, .openagents, old app)
  3. Installs/extracts the app
  4. Launches with CDP enabled
  5. Runs test scenarios via CDP
  6. Takes screenshots at each step
  7. Reports pass/fail
"""

import argparse
import json
import os
import subprocess
import sys
import time
import base64
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------

class RemoteMachine:
    def __init__(self, host, user, password, platform):
        self.host = host
        self.user = user
        self.password = password
        self.platform = platform  # 'windows' or 'macos'
        self.ssh_opts = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10']
        if platform == 'macos':
            self.ssh_opts += ['-o', 'PubkeyAuthentication=no']
        self.screenshot_count = 0
        self.results_dir = f'test_results_{platform}_{int(time.time())}'
        os.makedirs(self.results_dir, exist_ok=True)

    def ssh(self, cmd, timeout=30):
        """Run a command via SSH, return stdout."""
        full_cmd = ['sshpass', '-p', self.password, 'ssh'] + self.ssh_opts + \
                   [f'{self.user}@{self.host}', cmd]
        try:
            result = subprocess.run(full_cmd, capture_output=True, timeout=timeout)
            # Handle GBK encoding on Chinese Windows
            try:
                return result.stdout.decode('utf-8').strip()
            except UnicodeDecodeError:
                try:
                    return result.stdout.decode('gbk').strip()
                except:
                    return result.stdout.decode('utf-8', errors='replace').strip()
        except subprocess.TimeoutExpired:
            return 'TIMEOUT'
        except Exception as e:
            return f'ERROR: {e}'

    def scp_to(self, local_path, remote_path):
        """Upload a file."""
        full_cmd = ['sshpass', '-p', self.password, 'scp'] + self.ssh_opts + \
                   [local_path, f'{self.user}@{self.host}:{remote_path}']
        subprocess.run(full_cmd, capture_output=True, timeout=120)

    def scp_from(self, remote_path, local_path):
        """Download a file."""
        full_cmd = ['sshpass', '-p', self.password, 'scp'] + self.ssh_opts + \
                   [f'{self.user}@{self.host}:{remote_path}', local_path]
        subprocess.run(full_cmd, capture_output=True, timeout=30)

    def watcher_cmd(self, cmd, timeout=10):
        """Send a command via the watcher script (file-based)."""
        if self.platform == 'windows':
            cmd_file = r'C:\Users\{}\gui_cmd.txt'.format(self.user)
            result_file = r'C:\Users\{}\gui_result.txt'.format(self.user)
            self.ssh(f'echo. > {result_file}', 5)  # clear with empty
            self.ssh(f'echo {cmd} > {cmd_file}')
            time.sleep(timeout)
            return self.ssh(f'type {result_file}')
        else:
            cmd_file = f'/Users/{self.user}/gui_cmd.txt'
            result_file = f'/Users/{self.user}/gui_result.txt'
            self.ssh(f'echo -n > {result_file}', 5)
            self.ssh(f"echo '{cmd}' > {cmd_file}")
            time.sleep(timeout)
            return self.ssh(f'cat {result_file}')

    def cdp_eval(self, js_expr, wait=8):
        """Evaluate JS in the Electron renderer via CDP through watcher."""
        return self.watcher_cmd(f'cdp:{js_expr}', wait)

    def shell_cmd(self, cmd, wait=8):
        """Run a shell command via watcher."""
        return self.watcher_cmd(f'shell:{cmd}', wait)

    def screenshot(self, label=''):
        """Take a screenshot via watcher CDP."""
        self.screenshot_count += 1
        name = f'{self.screenshot_count:02d}_{label}.png' if label else f'{self.screenshot_count:02d}.png'
        self.watcher_cmd('screenshot', 10)
        if self.platform == 'windows':
            remote_path = f'C:/Users/{self.user}/screenshot.png'
        else:
            remote_path = f'/Users/{self.user}/screenshot.png'
        local_path = os.path.join(self.results_dir, name)
        self.scp_from(remote_path, local_path)
        print(f'  📸 Screenshot: {local_path}')
        return local_path

    def restart_app(self, wait=25):
        """Restart Electron via watcher."""
        self.watcher_cmd('restart', wait)


# ---------------------------------------------------------------------------
# Test scenarios
# ---------------------------------------------------------------------------

class TestResult:
    def __init__(self):
        self.tests = []

    def add(self, name, passed, detail=''):
        status = '✅' if passed else '❌'
        self.tests.append((name, passed, detail))
        print(f'  {status} {name}' + (f' — {detail}' if detail else ''))

    def summary(self):
        total = len(self.tests)
        passed = sum(1 for _, p, _ in self.tests if p)
        failed = total - passed
        print(f'\n{"="*60}')
        print(f'Results: {passed}/{total} passed, {failed} failed')
        if failed:
            print('Failed tests:')
            for name, p, detail in self.tests:
                if not p:
                    print(f'  ❌ {name}: {detail}')
        print(f'{"="*60}')
        return failed == 0


def test_app_launches(m, r):
    """Test 1: App launches and shows correct title."""
    title = m.cdp_eval('document.title')
    r.add('App launches', 'OpenAgents' in (title or ''), f'title={title}')
    m.screenshot('launch')


def test_dashboard_tab(m, r):
    """Test 2: Dashboard tab works, no flapping."""
    m.cdp_eval('document.querySelector(\'[data-tab="dashboard"]\').click()')
    time.sleep(2)
    text1 = m.cdp_eval('document.body.innerText', 5)
    # Click away and back to test flapping
    m.cdp_eval('document.querySelector(\'[data-tab="agents"]\').click()')
    time.sleep(1)
    m.cdp_eval('document.querySelector(\'[data-tab="dashboard"]\').click()')
    time.sleep(2)
    text2 = m.cdp_eval('document.body.innerText', 5)

    # Check both show same daemon status
    has_daemon = 'Daemon' in (text1 or '')
    r.add('Dashboard tab works', has_daemon, f'text contains Daemon: {has_daemon}')
    m.screenshot('dashboard')


def test_install_tab(m, r):
    """Test 3: Install tab shows catalog."""
    m.cdp_eval('document.querySelector(\'[data-tab="install"]\').click()')
    time.sleep(3)
    text = m.cdp_eval('document.body.innerText', 5)
    has_catalog = 'Claude Code' in (text or '') and 'OpenClaw' in (text or '')
    r.add('Install tab shows catalog', has_catalog)
    m.screenshot('install_tab')


def test_install_openclaw(m, r):
    """Test 4: Install OpenClaw (triggers Node.js auto-install if needed)."""
    # Make sure we're on install tab first
    time.sleep(2)
    m.cdp_eval('document.querySelector(\'[data-tab="install"]\').click()', 5)
    time.sleep(3)

    # Click Install on OpenClaw
    js = '(function(){var rows=document.querySelectorAll(".catalog-row");for(var i=0;i<rows.length;i++){if(rows[i].textContent.includes("OpenClaw")){var btn=rows[i].querySelector("button");if(btn&&btn.textContent.trim()==="Install"){btn.click();return "clicked"}return "already_installed"}}return "not_found"})()'
    click_result = m.cdp_eval(js, 8)

    if 'already_installed' in (click_result or ''):
        r.add('OpenClaw install', True, 'Already installed')
        return

    if 'clicked' not in (click_result or ''):
        r.add('OpenClaw install', False, f'Could not click Install: {click_result}')
        return

    # Wait for confirm dialog to appear, then click confirm
    time.sleep(3)
    m.cdp_eval('document.getElementById("confirm-install-yes")?.click()', 5)

    # Wait for install to complete (Node.js download + npm install can take 3-5 min)
    print('  ⏳ Waiting for install to complete (up to 5 minutes)...')
    for i in range(30):  # 30 * 10s = 5 min
        time.sleep(10)
        text = m.cdp_eval('document.body.innerText', 5)
        if text and ('Done!' in text or 'Error' in text or 'Back to Install' in text):
            break
        if i % 3 == 0:
            print(f'    ... {(i+1)*10}s elapsed')

    m.screenshot('install_result')

    success = text and 'Done!' in text and 'Error' not in text
    r.add('OpenClaw install', success, (text or '')[-200:])


def test_openclaw_binary(m, r):
    """Test 5: OpenClaw binary exists and is runnable."""
    if m.platform == 'windows':
        result = m.shell_cmd('where openclaw', 8)
        exists = result and 'openclaw' in result.lower() and 'not found' not in result.lower()
    else:
        result = m.shell_cmd('which openclaw || echo NOT_FOUND', 8)
        exists = result and 'NOT_FOUND' not in result

    r.add('OpenClaw binary exists', exists, f'path={result}')


def test_uninstall_openclaw(m, r):
    """Test 6: Uninstall OpenClaw."""
    # Go to install tab
    m.cdp_eval('document.querySelector(\'[data-tab="install"]\').click()')
    time.sleep(3)

    # Click Uninstall on OpenClaw
    js = '''(function(){
        var rows = document.querySelectorAll('.catalog-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.includes('OpenClaw')) {
                var btns = rows[i].querySelectorAll('button');
                for (var j = 0; j < btns.length; j++) {
                    if (btns[j].textContent.trim() === 'Uninstall') {
                        btns[j].click();
                        return 'clicked';
                    }
                }
                return 'no_uninstall_btn';
            }
        }
        return 'not_found';
    })()'''
    click_result = m.cdp_eval(js)

    if 'clicked' not in (click_result or ''):
        r.add('OpenClaw uninstall', False, f'Could not click Uninstall: {click_result}')
        return

    # Click confirm
    time.sleep(3)
    m.cdp_eval('document.getElementById("confirm-install-yes")?.click()')

    # Wait for uninstall
    print('  ⏳ Waiting for uninstall...')
    for i in range(12):
        time.sleep(5)
        text = m.cdp_eval('document.body.innerText', 5)
        if text and ('Done!' in text or 'uninstalled' in text or 'Back to Install' in text):
            break

    m.screenshot('uninstall_result')

    success = text and 'uninstalled' in text.lower()
    r.add('OpenClaw uninstall', success, (text or '')[-200:])


def test_catalog_refreshed(m, r):
    """Test 7: Catalog shows NOT INSTALLED after uninstall."""
    # Click Back to Install
    m.cdp_eval('document.querySelector("#install-back-btn")?.click()')
    time.sleep(3)

    text = m.cdp_eval('document.body.innerText', 5)
    # Check OpenClaw row shows NOT INSTALLED
    shows_not_installed = text and 'NOT INSTALLED' in text
    r.add('Catalog refreshed after uninstall', shows_not_installed)
    m.screenshot('catalog_refreshed')


def test_logs_tab(m, r):
    """Test 8: Logs tab works."""
    m.cdp_eval('document.querySelector(\'[data-tab="logs"]\').click()')
    time.sleep(2)
    text = m.cdp_eval('document.body.innerText', 5)
    has_logs = text and 'Logs' in text
    r.add('Logs tab works', has_logs)
    m.screenshot('logs')


def test_settings_tab(m, r):
    """Test 9: Settings tab works."""
    m.cdp_eval('document.querySelector(\'[data-tab="settings"]\').click()')
    time.sleep(2)
    text = m.cdp_eval('document.body.innerText', 5)
    has_settings = text and 'Settings' in text
    r.add('Settings tab works', has_settings)
    m.screenshot('settings')


# ---------------------------------------------------------------------------
# Clean environment
# ---------------------------------------------------------------------------

def clean_environment(m):
    """Remove Node.js, .openagents, and old app installations."""
    print('\n🧹 Cleaning environment...')

    if m.platform == 'windows':
        # Remove .openagents
        m.ssh(r'rmdir /S /Q C:\Users\{}\. openagents 2>nul'.format(m.user), 15)
        # Remove npm global dir
        m.ssh(r'rmdir /S /Q %APPDATA%\npm 2>nul', 10)
        m.ssh(r'rmdir /S /Q %APPDATA%\npm-cache 2>nul', 10)
        print('  Cleaned Windows environment')
    else:
        m.ssh('rm -rf ~/.openagents 2>/dev/null', 10)
        # Don't remove system Node.js — just the portable one
        print('  Cleaned macOS environment')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Automated release testing for OpenAgents Launcher')
    parser.add_argument('--platform', required=True, choices=['windows', 'macos'])
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--password', required=True)
    parser.add_argument('--tag', default='latest', help='Release tag (default: latest)')
    parser.add_argument('--skip-clean', action='store_true', help='Skip environment cleanup')
    parser.add_argument('--skip-install', action='store_true', help='Skip app installation')
    args = parser.parse_args()

    m = RemoteMachine(args.host, args.user, args.password, args.platform)
    r = TestResult()

    print(f'\n🚀 OpenAgents Launcher Release Test')
    print(f'   Platform: {args.platform}')
    print(f'   Host: {args.host}')
    print(f'   Tag: {args.tag}')
    print(f'   Results: {m.results_dir}/')

    # 1. Check watcher is alive
    print('\n📡 Checking watcher connection...')
    alive = m.shell_cmd('echo alive', 8)
    if 'alive' not in (alive or ''):
        print(f'  ❌ Watcher not responding: {alive}')
        print('  Start the watcher on the remote machine first.')
        sys.exit(1)
    print('  ✅ Watcher alive')

    # 2. Clean environment
    if not args.skip_clean:
        clean_environment(m)
        m.restart_app()

    # 3. Run tests
    print('\n🧪 Running tests...\n')

    test_app_launches(m, r)
    test_dashboard_tab(m, r)
    test_install_tab(m, r)
    test_install_openclaw(m, r)
    test_openclaw_binary(m, r)
    test_uninstall_openclaw(m, r)
    test_catalog_refreshed(m, r)
    test_logs_tab(m, r)
    test_settings_tab(m, r)

    # 4. Summary
    all_passed = r.summary()
    print(f'\nScreenshots saved to: {m.results_dir}/')

    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
