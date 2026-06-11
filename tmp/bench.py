#!/usr/bin/env python3
import subprocess, json, time, sys

URL = "https://workspace-endpoint.openagents.org"
TOKEN = "5hA4o6_66U0KduTAZCz4U7bIBkdRL8HYraaMJTiB_oA"
NET = "2550c9ab"
RUNS = 3

def curl_post(path, body):
    r = subprocess.run(["curl", "-s", "-X", "POST", f"{URL}{path}",
        "-H", f"X-Workspace-Token: {TOKEN}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(body)], capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout else {}

def curl_get(path):
    r = subprocess.run(["curl", "-s", f"{URL}{path}",
        "-H", f"X-Workspace-Token: {TOKEN}"], capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout else {}

print("=" * 50)
print(f"  OpenAgents Latency Benchmark")
print(f"  {time.strftime('%c')}")
print("=" * 50)

# Test 1: Local CLI
print("\n=== Test 1: Local Claude CLI ===")
cli_times = []
for i in range(RUNS):
    t0 = time.time()
    r = subprocess.run(["claude", "--print"], input="Reply with exactly: PONG",
        capture_output=True, text=True, timeout=60)
    elapsed = (time.time() - t0) * 1000
    cli_times.append(elapsed)
    print(f"  Run {i+1}: {elapsed:.0f}ms  -> {r.stdout.strip()[:20]}")
cli_avg = sum(cli_times) / len(cli_times)
print(f"  Average: {cli_avg:.0f}ms")

# Test 2: Workspace Agent
print("\n=== Test 2: Workspace Agent ===")

resp = curl_post("/v1/events", {
    "network": NET, "channel": NET,
    "type": "network.channel.create",
    "source": "human:benchmarker", "target": "core",
    "payload": {"title": f"Bench {int(time.time())}", "participants": ["tester"], "master": "tester"}
})
ch = resp.get("data", {}).get("metadata", {}).get("channel_name", "")
print(f"  Session: {ch}")
if not ch:
    print(f"  ERROR: {resp}")
    sys.exit(1)

time.sleep(2)

ws_times = []
for i in range(RUNS):
    tag = f"B{i}_{int(time.time())}"
    t0 = time.time()

    curl_post("/v1/events", {
        "network": NET, "channel": ch,
        "type": "workspace.message.posted",
        "source": "human:benchmarker",
        "target": f"channel/{ch}",
        "payload": {"content": f"Reply with exactly one word: {tag}", "message_type": "chat", "sender_type": "human"}
    })
    t_send = (time.time() - t0) * 1000

    found = ""
    for poll in range(240):
        time.sleep(0.5)
        data = curl_get(f"/v1/events?network={NET}&channel={ch}&type=workspace.message&limit=10&sort=desc")
        for e in data.get("data", {}).get("events", []):
            src = e.get("source", "")
            p = e.get("payload", {})
            if src.startswith("openagents:") and p.get("message_type") == "chat":
                found = p.get("content", "")[:50]
                break
            if src.startswith("openagents:") and p.get("message_type") in ("status", "thinking"):
                found = f"[{p.get('message_type')}] {p.get('content', '')[:40]}"
                break
        if found:
            break

    elapsed = (time.time() - t0) * 1000
    ws_times.append(elapsed)
    print(f"  Run {i+1}: {elapsed:.0f}ms (send: {t_send:.0f}ms, wait: {elapsed-t_send:.0f}ms)  -> {found[:40]}")
    time.sleep(5)

ws_avg = sum(ws_times) / len(ws_times)
print(f"  Average: {ws_avg:.0f}ms")

print(f"\n{'=' * 50}")
print(f"  RESULTS")
print(f"{'=' * 50}")
print(f"  Local CLI:        {cli_avg:.0f}ms")
print(f"  Workspace Agent:  {ws_avg:.0f}ms")
print(f"  Overhead:         {ws_avg - cli_avg:.0f}ms")
print(f"{'=' * 50}")
