#!/usr/bin/env python3
"""
Watcher script for Windows — polls gui_cmd.txt and executes commands.
Auto-detects OpenAgents Launcher location.
Supports: shell:<cmd>, cdp:<js>, screenshot, restart
"""
import os, sys, time, subprocess, json, urllib.request, urllib.error, base64, glob

USER = os.environ.get('USERNAME', os.environ.get('USER', 'user'))
HOME = os.path.expanduser('~')
CMD_FILE = os.path.join(HOME, 'gui_cmd.txt')
RESULT_FILE = os.path.join(HOME, 'gui_result.txt')
SCREENSHOT_FILE = os.path.join(HOME, 'screenshot.png')
CDP_PORT = 9333

def find_app():
    """Find the OpenAgents Launcher executable."""
    candidates = [
        # Dev mode (launcher takes priority)
        os.path.join(HOME, 'Desktop', 'launcher'),
        # Installed via NSIS
        os.path.join(HOME, 'AppData', 'Local', 'Programs', 'OpenAgents Launcher'),
    ]

    for d in candidates:
        if os.path.isdir(d) and os.path.exists(os.path.join(d, 'node_modules')):
            return ('dev', d)
        exe = os.path.join(d, 'OpenAgents Launcher.exe')
        if os.path.exists(exe):
            return ('installed', d)

    return (None, None)

def kill_electron():
    try:
        subprocess.run(['taskkill', '/F', '/IM', 'electron.exe'], capture_output=True, timeout=10)
        subprocess.run(['taskkill', '/F', '/IM', 'OpenAgents Launcher.exe'], capture_output=True, timeout=10)
    except:
        pass
    time.sleep(2)

def start_electron():
    kind, path = find_app()
    if kind == 'dev':
        cmd = f'cd /d "{path}" && npx electron . --remote-debugging-port={CDP_PORT} --remote-allow-origins=*'
        subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif kind == 'installed':
        exe = os.path.join(path, 'OpenAgents Launcher.exe')
        subprocess.Popen([exe, f'--remote-debugging-port={CDP_PORT}', '--remote-allow-origins=*'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif kind == 'exe':
        # Portable exe — just run it directly
        subprocess.Popen([path, f'--remote-debugging-port={CDP_PORT}', '--remote-allow-origins=*'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print(f'ERROR: Could not find OpenAgents Launcher')
        return
    print(f'Electron started ({kind}: {path}), CDP on port {CDP_PORT}')

def get_cdp_ws():
    try:
        data = urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json', timeout=5).read()
        targets = json.loads(data)
        for t in targets:
            if t.get('type') == 'page':
                return t['webSocketDebuggerUrl']
    except:
        return None

def cdp_eval(js_expr, timeout=30):
    try:
        import websocket
    except ImportError:
        os.system('pip install websocket-client -q')
        import websocket

    ws_url = get_cdp_ws()
    if not ws_url:
        return 'CDP ERROR: no websocket target'

    try:
        ws = websocket.create_connection(ws_url, timeout=timeout)
        msg = json.dumps({'id': 1, 'method': 'Runtime.evaluate',
                          'params': {'expression': js_expr, 'awaitPromise': True, 'returnByValue': True}})
        ws.send(msg)
        result = json.loads(ws.recv())
        ws.close()
        if 'result' in result and 'result' in result['result']:
            val = result['result']['result']
            if val.get('type') == 'string':
                return val['value']
            elif 'value' in val:
                return json.dumps(val['value'])
            elif val.get('type') == 'undefined':
                return 'OK (undefined)'
            elif 'description' in val:
                return val['description']
        if 'exceptionDetails' in result.get('result', {}):
            return json.dumps(result['result']['exceptionDetails']['exception'].get('description', 'unknown error'))
        return json.dumps(result.get('result', result))
    except Exception as e:
        return f'CDP ERROR: {e}'

def cdp_screenshot():
    try:
        import websocket
    except ImportError:
        os.system('pip install websocket-client -q')
        import websocket

    ws_url = get_cdp_ws()
    if not ws_url:
        return 'Screenshot ERROR: no websocket target'
    try:
        ws = websocket.create_connection(ws_url, timeout=15)
        ws.send(json.dumps({'id': 1, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
        result = json.loads(ws.recv())
        ws.close()
        img = base64.b64decode(result['result']['data'])
        with open(SCREENSHOT_FILE, 'wb') as f:
            f.write(img)
        return f'Screenshot saved to {SCREENSHOT_FILE} ({len(img)} bytes)'
    except Exception as e:
        return f'Screenshot ERROR: {e}'

def run_shell(cmd, timeout=30):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        output = result.stdout
        if result.stderr:
            output += result.stderr
        return output.strip() if output.strip() else '(no output)'
    except subprocess.TimeoutExpired:
        return f'ERROR: Command timed out after {timeout} seconds'
    except Exception as e:
        return f'ERROR: {e}'

def process_command(cmd):
    cmd = cmd.strip()
    if not cmd:
        return

    if cmd == 'restart':
        kill_electron()
        start_electron()
        for i in range(30):
            time.sleep(1)
            if get_cdp_ws():
                write_result('Electron restarted, CDP ready')
                return
        write_result('Electron restarted, CDP not ready after 30s')
        return

    if cmd == 'clean-restart':
        # Kill electron, remove stale Desktop files, then exit (loop restarts us)
        kill_electron()
        time.sleep(2)
        import glob as g
        stale = [
            os.path.join(HOME, 'Desktop', 'openagents-connector'),
            os.path.join(HOME, 'Desktop', 'launcher.exe'),
            os.path.join(HOME, 'Desktop', 'launcher-test.exe'),
        ]
        # Remove NSIS exe files
        for f in g.glob(os.path.join(HOME, 'Desktop', 'OpenAgents.Launcher-*.exe')):
            stale.append(f)
        removed = []
        for p in stale:
            try:
                if os.path.isdir(p):
                    import shutil
                    shutil.rmtree(p, ignore_errors=True)
                    removed.append(p)
                elif os.path.isfile(p):
                    os.remove(p)
                    removed.append(p)
            except Exception as e:
                removed.append(f'{p}: {e}')
        write_result('Cleaned: ' + ', '.join(removed) + '. Exiting for restart...')
        time.sleep(1)
        sys.exit(0)  # Loop will restart us

    if cmd == 'screenshot':
        write_result(cdp_screenshot())
        return

    if cmd.startswith('cdp:'):
        write_result(cdp_eval(cmd[4:]))
        return

    if cmd.startswith('shell:'):
        write_result(run_shell(cmd[6:]))
        return

    write_result(f'Unknown command: {cmd}')

def write_result(text):
    with open(RESULT_FILE, 'w', encoding='utf-8') as f:
        f.write(str(text))

def main():
    # Start electron on launch
    kill_electron()
    print('Starting Electron with CDP...')
    start_electron()
    time.sleep(10)

    print(f'Watcher ready. Polling {CMD_FILE}')

    # Clean any leftover command file
    try:
        os.remove(CMD_FILE)
    except:
        pass

    while True:
        try:
            if os.path.exists(CMD_FILE):
                with open(CMD_FILE, 'r', encoding='utf-8') as f:
                    cmd = f.read().strip()
                os.remove(CMD_FILE)
                if cmd:
                    print(f'\n> {cmd}')
                    process_command(cmd)
                    result = ''
                    try:
                        with open(RESULT_FILE, 'r', encoding='utf-8') as f:
                            result = f.read()[:200]
                    except:
                        pass
                    print(f'  Result: {result}')
        except KeyboardInterrupt:
            kill_electron()
            sys.exit(0)
        except Exception as e:
            print(f'Error: {e}')

        time.sleep(0.5)

if __name__ == '__main__':
    main()
