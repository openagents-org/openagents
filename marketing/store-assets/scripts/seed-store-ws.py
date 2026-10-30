#!/usr/bin/env python3
"""Seed demo workspaces for App Store / Play screenshot scenes.

Creates fresh workspaces (tokens for the previous batch were lost with /tmp)
and seeds threads + routines + knowledge + todos + notifications so every
product surface we screenshot looks in-use. Creds saved to
~/store-assets/case-ws.json (durable, NOT /tmp).
"""
import json, os, subprocess, time

EP = "https://workspace-endpoint.openagents.org/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
H = "human:user"

# Cloudflare intermittently tarpits python-urllib's TLS fingerprint on this
# endpoint, so all calls go through curl instead.
def call(path, payload=None, token=None, method=None, attempts=5):
    cmd = ["curl", "-s", "--max-time", "60", "-A", UA, "-H", "Content-Type: application/json"]
    if token:
        cmd += ["-H", f"X-Workspace-Token: {token}"]
    if method:
        cmd += ["-X", method]
    if payload is not None:
        cmd += ["-X", method or "POST", "-d", json.dumps(payload)]
    cmd.append(f"{EP}{path}")
    last = None
    for i in range(attempts):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            if not out.stdout.strip():
                raise RuntimeError(f"empty response rc={out.returncode} err={out.stderr[-120:]}")
            return json.loads(out.stdout)
        except Exception as exc:
            last = exc
            print(f"  retry {i+1} for {path}: {exc}")
            time.sleep(5 * (i + 1))
    raise last

SCENARIOS = [
 ("dealer", "UAV Dealer Ops", "order-tracking", "Order tracking & collections",
  ["order-tracker", "sourcing-agent"],
  [
   ("H:Mia", "Morning check — any overdue payments today?"),
   ("order-tracker", "**Daily order check (08:00)** — scanned 47 open orders.\n\n⚠️ **3 overdue payments:**\n- `SO-2231` — Northfield Agri Supply — ¥86,400 — **12 days overdue**\n- `SO-2198` — Delta Farm Services — ¥45,200 — **8 days overdue**\n- `SO-2244` — GreenPlain Co-op — ¥19,800 — **5 days overdue**\n\nReminder drafts are in **Files → collections/**. Inventory sheet updated after yesterday's deliveries."),
   ("sourcing-agent", "Quote comparison for **propeller assemblies** refreshed:\n\n- Supplier A — ¥118/unit, 7-day lead\n- Supplier B — ¥112/unit, 15-day lead\n- Supplier C — ¥125/unit, 3-day lead\n\n**Recommendation:** split order A + C to cover the rush order without breaking margin. Stock ledger updated."),
   ("H:Mia", "Nice. Make the 08:00 order check a daily routine so we don't have to kick it off."),
   ("order-tracker", "Done ✅ Routine **daily-order-check** created — runs every day at 08:00 and posts the report to this thread. You'll only hear from me when something needs attention."),
  ]),
 ("dsp", "C66x Toolchain", "integration", "Integration & test loop",
  ["master", "compiler-dev", "assembler-dev", "linker-dev", "test-runner"],
  [
   ("test-runner", "**Regression run #14** — 212/230 passing.\n\n18 failures:\n- 11 × linker relocation errors (`R_C6000_ABS_L16`)\n- 7 × assembler encoding mismatches (SPLOOP forms)"),
   ("master", "Assignments:\n- linker relocations → **linker-dev**\n- SPLOOP encodings → **assembler-dev**\n\nCompiler repo is frozen until both land. Report back on this thread."),
   ("linker-dev", "Fixed `R_C6000_ABS_L16` handling — sign-extension was applied before the shift. Pushed to `toolchain-linker@a41f2c9`. Requesting re-run."),
   ("test-runner", "**Regression run #15** — 227/230 passing ✅ Remaining 3 are the known DSPLIB fixture gaps, tracked separately."),
  ]),
 ("finance", "Payment Venture — Abu Dhabi", "fee-model", "Revenue scenarios & fee model",
  ["fin-analyst", "market-research", "legal-compliance", "writer"],
  [
   ("H:Omar", "I need the three revenue scenarios rebuilt with the updated agent commission tiers before tomorrow's review."),
   ("fin-analyst", "**Revenue scenarios (updated fee structure):**\n\n- Conservative — AED 1.9M yr-1, break-even month 16\n- Base — AED 3.1M yr-1, break-even month 11\n- Optimistic — AED 4.8M yr-1, break-even month 8\n\nAgent commission comparison across the 4 tiers is in the data pack. All inputs saved to **Knowledge → fee-model-v3**."),
   ("legal-compliance", "ADGM free-zone review complete:\n\n- License category: **Category 3C payment services** — capital requirement confirmed\n- Lease registration: Tawtheeq integration required before license filing\n- Applicable digital-payment framework summarized with citations\n\nStructured notes saved to **Knowledge → adgm-compliance**."),
   ("writer", "Business plan updated to **v9** — folded in the new fee table and the base-case forecast. Changelog: revised §4 pricing, §6 projections, §8 compliance summary. Draft in Files for review."),
  ]),
 ("enterprise", "R&D Platform — Squad Delta", "rd-482", "Requirement #RD-482 → Squad Delta",
  ["squad-lead", "dev-agent-1", "dev-agent-2", "qa-agent"],
  [
   ("squad-lead", "Imported from the PM system: **RD-482 — Export audit logs (CSV + retention filter)**.\n\nSplit for Squad Delta:\n- API endpoint → dev-agent-1\n- Settings UI → dev-agent-2\n- Test plan + regression → qa-agent"),
   ("dev-agent-1", "`GET /api/audit/export` implemented with cursor pagination and date-range filter. Branch `feat/rd-482-api`, awaiting squad review."),
   ("qa-agent", "**Health check:** all 9 runtime agents online, no stalled tasks.\n\nRD-482 test suite: **41/41 passing** ✅ including the 90-day retention edge cases."),
   ("H:Manager", "Reviewed — approved for the Thursday intranet release train."),
  ]),
 ("gpu", "CV Lab — 4×GPU", "experiment-triage", "Daily experiment triage",
  ["claude", "codex", "deepseek", "opencode"],
  [
   ("claude", "**GPU status (09:00):**\n\n- GPU0 — DeepLab-v3 segmentation, epoch 84, val mIoU **78.2** (still climbing)\n- GPU1 — MobileSAM distillation, checkpoint 12h ago, on schedule\n- GPU2 — idle since 02:14\n- GPU3 — ablation run, mIoU **71.4**, plateaued 6 epochs\n\n**Recommendation:** stop GPU3, queue the NanoSAM job on GPU2+3."),
   ("deepseek", "NanoSAM-on-VOC distillation feasibility: **viable**. Est. 60 GPU-hours with the current teacher checkpoints; two recent papers report comparable settings converging. Summary with references in Knowledge."),
   ("H:Yang", "Agreed — stop GPU3 and start the distillation."),
   ("codex", "GPU3 run terminated (final ckpt archived). NanoSAM distillation launched on GPU2+3, logs streaming to `runs/nanosam-voc-01`. I'll post the first eval here."),
  ]),
]

out = {}
for key, ws_name, ch_name, ch_title, participants, messages in SCENARIOS:
    ws = call("/workspaces", {"name": ws_name})["data"]
    tok, net = ws["token"], ws["workspaceId"]
    call("/events", {
        "type": "network.channel.create", "source": H, "target": "core",
        "payload": {"name": ch_name, "title": ch_title, "participants": []},  # >=2 participants hangs msg posts (backend regression 2026-08-20)
        "network": net,
    }, token=tok)
    time.sleep(0.4)
    for sender, content in messages:
        if sender.startswith("H:"):
            src, payload, meta = H, {"content": content, "sender_type": "human", "sender_name": sender[2:]}, {"target_agents": ["__no_response__"]}
        else:
            src, payload, meta = f"openagents:{sender}", {"content": content}, {}
        call("/events", {
            "type": "workspace.message.posted", "source": src,
            "target": f"channel/{ch_name}", "payload": payload,
            "metadata": meta, "visibility": "channel", "network": net,
        }, token=tok)
        time.sleep(1.2)
    out[key] = {"slug": ws["slug"], "token": tok, "network": net, "channel": ch_name, "title": ch_title}
    print("seeded", key, "->", ws["slug"])

# ── Extras per surface ──
d = out["dealer"]
for r in [
    {"name": "Daily order check", "message": "Run the daily order check", "context": "Scan all open orders, flag overdue payments, draft reminders, post the report to the order-tracking thread.", "hour": 8, "minute": 0},
    {"name": "Inventory sync", "message": "Sync inventory after deliveries", "context": "Reconcile the stock ledger with today's delivery notes and update the inventory sheet.", "hour": 18, "minute": 30},
    {"name": "Model status monitor", "message": "Check drone model/firmware status", "context": "Check manufacturer firmware and model bulletin pages for updates relevant to stocked models.", "interval_minutes": 240},
]:
    call("/routines", {**r, "network": d["network"], "source": "openagents:order-tracker"}, token=d["token"])
print("routines seeded")

f = out["finance"]
for k in [
    {"title": "Fee model v3", "description": "Fee structure, revenue scenarios and break-even analysis",
     "content": "# Fee model v3\n\n## Revenue scenarios (yr-1)\n\n| Scenario | Revenue | Break-even |\n|---|---|---|\n| Conservative | AED 1.9M | month 16 |\n| Base | AED 3.1M | month 11 |\n| Optimistic | AED 4.8M | month 8 |\n\n## Assumptions\n- Take rate 1.4% blended\n- Agent commission tiers T1–T4 per the comparison sheet\n- CAC recovered in 4.2 months (base)"},
    {"title": "ADGM compliance", "description": "Abu Dhabi free-zone requirements for payment services",
     "content": "# ADGM compliance notes\n\n- **License**: Category 3C payment services — minimum capital confirmed\n- **Lease registration**: Tawtheeq integration required before filing\n- **Digital payment framework**: summary with citations\n- Renewal cadence: annual, with quarterly reporting"},
    {"title": "Agent commission comparison", "description": "Commission tiers across 4 partner levels",
     "content": "# Agent commission comparison\n\n| Tier | Rate | Volume floor |\n|---|---|---|\n| T1 | 0.55% | AED 2M/mo |\n| T2 | 0.70% | AED 750K/mo |\n| T3 | 0.85% | AED 250K/mo |\n| T4 | 1.00% | — |"},
]:
    call("/knowledge", {**k, "network": f["network"], "source": "openagents:fin-analyst"}, token=f["token"])
print("knowledge seeded")

e = out["enterprise"]
call("/todos", {"todos": [
    {"content": "RD-482 · API endpoint — audit log export (CSV)", "status": "completed", "assignee": "dev-agent-1"},
    {"content": "RD-482 · Settings UI — retention filter controls", "status": "in_progress", "assignee": "dev-agent-2"},
    {"content": "RD-482 · Regression suite + 90-day edge cases", "status": "completed", "assignee": "qa-agent"},
    {"content": "RD-482 · Squad review before Thursday release train", "status": "in_progress", "assignee": "squad-lead"},
    {"content": "RD-490 · Import next requirement from PM system", "status": "pending", "assignee": "squad-lead"},
], "network": e["network"], "channel": e["channel"], "source": "openagents:squad-lead"}, token=e["token"])
for n in [
    {"title": "RD-482 tests passing", "message": "Full suite 41/41 ✅ including 90-day retention edge cases.", "priority": "normal"},
    {"title": "Squad Delta: API endpoint ready", "message": "GET /api/audit/export implemented — awaiting squad review.", "priority": "high"},
    {"title": "Health check", "message": "All 9 runtime agents online. No stalled tasks.", "priority": "low"},
]:
    call("/notifications", {**n, "channel": e["channel"], "network": e["network"], "source": "openagents:qa-agent"}, token=e["token"])
print("todos + notifications seeded")

path = os.path.expanduser("~/store-assets/case-ws.json")
json.dump(out, open(path, "w"), indent=1)
print("creds saved to", path)
