'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';

// ═══════════════════════════════════════════════════════════════
// Onboarding welcome film (~28s) — derived from the Workspace 1.0
// launch film in openagents-web (internal_frontend/app/mocks/
// video_workspace_1_0). Same scenes, recut for the first-run
// welcome stage: Hook → Hub → Demo → Team → CTA, looping, silent.
// Long scenes are TIME-SCALED (their choreography fast-forwards)
// rather than truncated, so every beat keeps its full arc.
//
// v4 — brand-native. Two visual sources, nothing invented:
//  · Film cards use the official openagents.org design language:
//    Inter black, blue #2F6BFF / teal #16C79A / navy #0B1121,
//    2px black borders, hard offset shadows, ice-blue hero wash.
//  · Product shots are faithful recreations of the real
//    workspace.openagents.org app: zinc shell, icon rail, thread
//    list, left-aligned transcript rows (no bubbles), beam
//    avatars, amber leader chips, mono tool-step lines, 7-bar
//    working ticker, rounded-2xl composer.
// ═══════════════════════════════════════════════════════════════

const TOTAL_DURATION_MS = 28_000;
const STAGE_W = 1280;
const STAGE_H = 800;

// — official site brand —
const BLUE = '#2F6BFF';
const TEAL = '#16C79A';
const NAVY = '#0B1121';
const INK = '#0A0A0A';
// — real product tokens (light mode) —
const SHELL = '#f4f4f5';
const PANE = '#ffffff';
const BORDER = '#ececee';
const INPUTB = '#e4e4e7';
const TXT = '#09090b';
const MUTED = '#71717a';
const GREEN = '#22c55e';
const AMBER_BG = '#fef3c7';
const AMBER_TX = '#b45309';
const AVATAR_PALETTE = ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B'];

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const HERO_WASH = 'linear-gradient(160deg, #eaf2ff 0%, #f4f8ff 40%, #ffffff 100%)';
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

type SceneInfo = { id: number; localMs: number; dur: number };

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Welcome cut: 6 scenes in 28s. SCENE_SCALE maps each slot back onto the
// original scene's timeline (localMs × scale). The "02 · They collaborate"
// title card introduces the game demo, and the Demo slot (9s × 2.2 = 19.8s
// of source) deliberately stops just short of SHOWCASE_AT (20s) — the
// build story closes on "Ship it", and the full-screen finished-game
// showcase is cut from the welcome edition entirely.
const SCENE_TABLE: [number, number][] = [
  [0, 2_500], [2_500, 8_000], [8_000, 10_000], [10_000, 19_000], [19_000, 24_000], [24_000, 28_000],
];
const SCENE_SCALE = [1.2, 1.18, 1.0, 2.2, 2.0, 1.25];

function getScene(ms: number): SceneInfo {
  for (let i = SCENE_TABLE.length - 1; i >= 0; i--) {
    const [start, end] = SCENE_TABLE[i];
    if (ms >= start) return { id: i + 1, localMs: ms - start, dur: end - start };
  }
  return { id: 1, localMs: ms, dur: 3_000 };
}

// ── tiny inline icon set (lucide-style outlines) ──

function Ic({ d, size = 16, sw = 2, className = '', style, fill = 'none' }: {
  d: React.ReactNode; size?: number; sw?: number; className?: string; style?: React.CSSProperties; fill?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      {d}
    </svg>
  );
}
const dMsg = <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const dFolder = <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />;
const dGlobe = <><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>;
const dBell = <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>;
const dSearch = <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>;
const dPlus = <><path d="M12 5v14" /><path d="M5 12h14" /></>;
const dArrowUp = <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>;
const dUser = <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>;
const dTerminal = <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>;
const dPencil = <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />;
const dEye = <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>;
const dChevR = <path d="m9 18 6-6-6-6" />;
const dCrown = <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />;
const dShare = <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98" /><path d="m15.41 6.51-6.82 3.98" /></>;
const dTree = <><path d="M21 12h-8" /><path d="M21 6H8" /><path d="M21 18h-8" /><path d="M3 6v4c0 1.1.9 2 2 2h3" /><path d="M3 10v6c0 1.1.9 2 2 2h3" /></>;
const dArrowR = <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>;
const dZap = <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />;
const dClock = <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>;
const dCols = <><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="8" rx="1" /></>;
const dUsers = <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>;
const dFile = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>;
const dMail = <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 7L2 7" /></>;
const dCheck = <path d="M20 6 9 17l-5-5" />;
const dDb = <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></>;
const dWorkflow = <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h5.5A2 2 0 0 1 17.5 8.5V14" /></>;

// ── beam-style agent avatar (like boring-avatars in the real app) ──

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function BeamAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const h = hashStr(name);
  const c1 = AVATAR_PALETTE[h % 5];
  const c2 = AVATAR_PALETTE[(h >> 3) % 5];
  const flip = h % 2 === 0;
  const u = size / 28;
  return (
    <div className="relative shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size, background: c1 }}>
      <div className="absolute rounded-full" style={{
        width: size * 0.9, height: size * 0.9, background: c2,
        left: flip ? size * 0.28 : -size * 0.18, top: size * 0.3,
      }} />
      <div className="absolute rounded-full" style={{ width: 3 * u, height: 3 * u, background: 'rgba(0,0,0,0.75)', left: size * 0.32, top: size * 0.38 }} />
      <div className="absolute rounded-full" style={{ width: 3 * u, height: 3 * u, background: 'rgba(0,0,0,0.75)', left: size * 0.58, top: size * 0.38 }} />
      <div className="absolute rounded-full" style={{ width: 8 * u, height: 2.2 * u, background: 'rgba(0,0,0,0.75)', left: size * 0.36, top: size * 0.6 }} />
    </div>
  );
}

function HumanAvatar({ size = 28, hue = 210 }: { size?: number; hue?: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `hsl(${hue} 55% 82%)` }}>
      <Ic d={dUser} size={size * 0.5} className="text-zinc-700" />
    </div>
  );
}

const HUMANS = {
  you: { name: 'You', role: 'PM', src: '/images/avatars/you.png' },
  maya: { name: 'Maya', role: 'Data lead', src: '/images/avatars/maya.png' },
};

function PhotoAvatar({ src, size = 28 }: { src: string; size?: number }) {
  return (
    <img src={src} alt="" className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, background: '#f4f4f5' }} />
  );
}

function StatusDot({ online, size = 8 }: { online: boolean; size?: number }) {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 rounded-full transition-colors duration-300"
      style={{ width: size, height: size, background: online ? GREEN : '#d4d4d8', border: '1.5px solid #fff' }} />
  );
}

// ── cinematic helpers ──

function Stamp({ show, delay = 0, children, className = '' }: {
  show: boolean; delay?: number; children: React.ReactNode; className?: string;
}) {
  if (!show) return <div className={className} style={{ visibility: 'hidden' }}>{children}</div>;
  return (
    <div className={className} style={{ animation: `stamp 0.35s ${EASE} ${delay}ms backwards` }}>
      {children}
    </div>
  );
}

function WordReveal({ show, text, className = '', style, delay = 0, stagger = 60 }: {
  show: boolean; text: string; className?: string; style?: React.CSSProperties; delay?: number; stagger?: number;
}) {
  return (
    <div className={className} style={style}>
      {text.split(' ').map((w, i, arr) => (
        <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.09em] -mb-[0.09em]"
          style={{ marginRight: i < arr.length - 1 ? '0.24em' : 0 }}>
          <span className="inline-block" style={{
            visibility: show ? undefined : 'hidden',
            animation: show ? `rise 0.55s ${EASE} ${delay + i * stagger}ms backwards` : undefined,
          }}>
            {w}
          </span>
        </span>
      ))}
    </div>
  );
}

function Push({ localMs, dur, children }: { localMs: number; dur: number; children: React.ReactNode }) {
  const s = 1 + 0.03 * clamp(localMs / dur, 0, 1);
  return (
    <div className="h-full w-full" style={{ transform: `scale(${s})`, transformOrigin: '50% 42%' }}>
      {children}
    </div>
  );
}

const WIPE_BOUNDS = SCENE_TABLE.slice(1).map(([start]) => start);
function Wipe({ ms }: { ms: number }) {
  for (const b of WIPE_BOUNDS) {
    const t = ms - (b - 240);
    if (t >= 0 && t < 520) {
      const p = t / 520;
      return (
        <div className="absolute inset-0 z-[46] pointer-events-none overflow-hidden">
          <div className="absolute inset-y-[-10%] w-[130%]" style={{ background: BLUE, transform: `translateX(${-130 + p * 260}%) skewX(-10deg)` }} />
          <div className="absolute inset-y-[-10%] w-[130%]" style={{ background: NAVY, transform: `translateX(${-160 + p * 260}%) skewX(-10deg)` }} />
        </div>
      );
    }
  }
  return null;
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

// site-style pill kicker: white pill, 2px black border, hard shadow
function KickerPill({ children, bg = '#fff', color = INK }: { children: React.ReactNode; bg?: string; color?: string }) {
  return (
    <span className="inline-block rounded-full px-3.5 py-1 text-[12px] font-extrabold uppercase tracking-wider"
      style={{ background: bg, color, border: '2px solid #000', boxShadow: '3px 3px 0 0 #000' }}>
      {children}
    </span>
  );
}

// official wordmark treatment: "Open" ink + "Agents" blue→teal gradient
function Wordmark({ size = 76 }: { size?: number }) {
  return (
    <span className="font-black tracking-tighter leading-none" style={{ fontSize: size, color: INK }}>
      Open
      <span style={{
        background: 'linear-gradient(90deg, #3B82F6, #00D6B9)',
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
      }}>
        Agents
      </span>
    </span>
  );
}

function BrutalButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-stretch rounded-[5px] overflow-hidden"
      style={{ border: '2.5px solid #000', boxShadow: '6px 6px 0 0 #000', background: BLUE, color: '#fff' }}>
      <span className="flex items-center px-7 py-3.5 text-[16px] font-extrabold tracking-tight">{children}</span>
      <span className="flex w-[52px] items-center justify-center bg-white" style={{ borderLeft: '2.5px solid #000' }}>
        <Ic d={dArrowR} size={20} sw={2.5} style={{ color: '#000' }} />
      </span>
    </span>
  );
}

function LowerThird({ show, kicker, line }: { show: boolean; kicker: string; line: string }) {
  return (
    <div className="absolute left-10 bottom-9 z-40 pointer-events-none">
      <div style={{ transition: `all 0.45s ${EASE}`, opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(20px)' }}>
        <KickerPill>{kicker}</KickerPill>
        <div className="mt-2 text-xl font-extrabold tracking-tight" style={{ color: INK }}>{line}</div>
      </div>
    </div>
  );
}

// ── browser window chrome (neo-brutal frame, real product URL) ──

function BrowserWindow({ url, width, height, children, frame = NAVY }: {
  url: string; width: number; height: number; children: React.ReactNode; frame?: string;
}) {
  return (
    <div className="rounded-2xl p-2.5" style={{ background: frame, border: '2.5px solid #000', boxShadow: '10px 10px 0 0 #000' }}>
      <div className="overflow-hidden rounded-lg bg-white" style={{ width, height, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2 px-3" style={{ height: 34, background: SHELL, borderBottom: `1px solid ${INPUTB}` }}>
          <span className="size-2.5 rounded-full" style={{ background: '#FF5F57' }} />
          <span className="size-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
          <span className="size-2.5 rounded-full" style={{ background: '#28C840' }} />
          <div className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-0.5 text-[11px]"
            style={{ border: `1px solid ${INPUTB}`, color: MUTED, minWidth: 260, justifyContent: 'center' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            {url}
          </div>
          <span className="w-12" />
        </div>
        <div className="relative" style={{ height: height - 34, background: SHELL }}>{children}</div>
      </div>
    </div>
  );
}

// ── real product UI pieces ──

const RAIL_AGENTS = [
  { name: 'claude-dev', type: 'Claude Code' },
  { name: 'codex-art', type: 'Codex CLI' },
  { name: 'openclaw-qa', type: 'OpenClaw' },
  { name: 'pi-agent', type: 'Pi Agent' },
  { name: 'gemini-cli', type: 'Gemini CLI' },
];

function NavRail({ onlineCount, expanded = true, height }: { onlineCount: number; expanded?: boolean; height?: number }) {
  const navItems = [
    { d: dMsg, label: 'Threads', active: true },
    { d: dFolder, label: 'Files' },
    { d: dGlobe, label: 'Browser' },
    { d: dBell, label: 'Inbox' },
  ];
  return (
    <div className="flex h-full shrink-0 flex-col py-2" style={{ width: expanded ? 180 : 52, borderRight: `1px solid ${BORDER}`, background: 'rgba(244,244,245,0.6)', height }}>
      <div className={`flex items-center gap-2 px-3 pb-2 ${expanded ? '' : 'justify-center px-0'}`}>
        <img src="/images/oa-logo-black.png" alt="" className="size-7 shrink-0" />
        {expanded && <span className="truncate text-[13px] font-semibold" style={{ color: TXT }}>acme-team</span>}
      </div>
      <div className="px-2 space-y-0.5">
        {navItems.map(n => (
          <div key={n.label} className={`flex items-center gap-2 rounded-md px-2 ${expanded ? '' : 'justify-center px-0'}`}
            style={{ height: 30, background: n.active ? 'rgba(9,9,11,0.05)' : 'transparent', color: n.active ? TXT : '#52525b', fontWeight: n.active ? 500 : 400 }}>
            <Ic d={n.d} size={15} sw={1.8} />
            {expanded && <span className="text-[13px]">{n.label}</span>}
          </div>
        ))}
      </div>
      {expanded && (
        <>
          <div className="mx-3 my-2" style={{ borderTop: `1px solid ${BORDER}` }} />
          <div className="px-4 pb-1 text-[10px] font-medium" style={{ color: MUTED }}>
            Agents ({onlineCount}/5 online)
          </div>
          <div className="px-2 space-y-0.5">
            {RAIL_AGENTS.map((a, i) => (
              <div key={a.name} className="flex items-center gap-2 rounded-md px-2" style={{ height: 30 }}>
                <div className="relative">
                  <BeamAvatar name={a.name} size={20} />
                  <StatusDot online={i < onlineCount} />
                </div>
                <span className="truncate text-[13px]" style={{ color: TXT }}>{a.name}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto px-2">
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]" style={{ color: MUTED }}>
              <Ic d={dPlus} size={14} /> Connect agent
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ThreadListPanel({ localMs }: { localMs: number }) {
  const threads = [
    { title: 'mini-rpg', preview: 'You: Build a mini RPG game…', time: 'now', active: true, agents: ['claude-dev', 'codex-art'] },
    { title: 'Q3 revenue audit', preview: 'claude-dev: Report is in /files', time: '2m', active: false, agents: ['claude-dev'] },
    { title: 'Landing page copy', preview: 'pi-agent: Draft two is ready…', time: '1h', active: false, agents: ['pi-agent'] },
  ];
  return (
    <div className="flex h-full w-[230px] shrink-0 flex-col bg-white" style={{ borderRight: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-3" style={{ height: 40, borderBottom: `1px solid ${BORDER}` }}>
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>Threads</span>
        <span className="rounded-full px-1.5 text-[10px]" style={{ border: `1px solid ${INPUTB}`, color: MUTED }}>3</span>
        <span className="ml-auto flex items-center gap-1" style={{ color: MUTED }}>
          <Ic d={dSearch} size={13} />
          <Ic d={dPlus} size={14} />
        </span>
      </div>
      <div className="p-1.5 space-y-0.5">
        {threads.map((t, i) => (
          <Stamp key={t.title} show={localMs >= 300 + i * 150}>
            <div className="flex items-start gap-2 rounded-md px-2 py-2"
              style={t.active ? { background: 'rgba(0,0,0,0.055)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)' } : undefined}>
              <div className="mt-0.5"><BeamAvatar name={t.agents[0]} size={24} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[12.5px] font-medium" style={{ color: TXT }}>{t.title}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: '#a1a1aa' }}>{t.time}</span>
                </div>
                <p className="truncate text-[11px]" style={{ color: MUTED }}>{t.preview}</p>
              </div>
            </div>
          </Stamp>
        ))}
      </div>
    </div>
  );
}

function WorkingBars() {
  return (
    <div className="flex h-4 items-center gap-[2px] py-1" style={{ color: MUTED }}>
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} className="w-[2px] h-[13px] rounded-[1px] bg-current"
          style={{ animation: 'workbar 1.6s ease-in-out infinite', animationDelay: `${i * 0.13}s` }} />
      ))}
    </div>
  );
}

function Composer({ placeholder = 'Message… (@ to mention an agent)', typed = '' }: { placeholder?: string; typed?: string }) {
  return (
    <div className="rounded-2xl bg-white px-2.5 py-2" style={{ border: `1px solid ${INPUTB}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-end gap-1.5">
        <span className="flex size-7 items-center justify-center rounded-full" style={{ color: MUTED }}>
          <Ic d={dPlus} size={16} />
        </span>
        <span className="flex-1 px-1 py-1.5 text-[13px]" style={{ color: typed ? TXT : '#a1a1aa' }}>
          {typed || placeholder}
          {typed && <span className="animate-pulse" style={{ color: TXT }}>▏</span>}
        </span>
        <span className="flex size-7 items-center justify-center rounded-full"
          style={{ background: typed ? TXT : '#f4f4f5', color: typed ? '#fff' : '#a1a1aa' }}>
          <Ic d={dArrowUp} size={14} sw={2.2} />
        </span>
      </div>
    </div>
  );
}

// transcript rows — the real app has NO bubbles; everything is left-aligned
function MsgRow({ who, name, role, time, children, leader = false }: {
  who: 'human' | 'agent'; name: string; role?: string; time: string; children: React.ReactNode; leader?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {who === 'human' ? <HumanAvatar size={26} /> : <BeamAvatar name={name} size={26} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: TXT }}>{who === 'human' ? 'You' : name}</span>
          {leader && (
            <span className="rounded px-1 py-px text-[9px] font-semibold" style={{ background: AMBER_BG, color: AMBER_TX }}>leader</span>
          )}
          {role && !leader && (
            <span className="rounded px-1 py-px text-[9px] font-semibold" style={{ background: '#f4f4f5', color: MUTED }}>{role}</span>
          )}
          <span className="text-[10px]" style={{ color: '#a1a1aa' }}>{time}</span>
        </div>
        <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: TXT }}>{children}</div>
      </div>
    </div>
  );
}

function StepsCluster({ lines, working }: { lines: { icon: React.ReactNode; tool: string; arg: string }[]; working: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-0.5">
      <div className="size-[26px] shrink-0" />
      <div className="min-w-0 flex-1 pl-3" style={{ borderLeft: '2px solid #e4e4e7' }}>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ color: MUTED, animation: `msg-in 0.25s ${EASE} backwards`, animationDelay: `${i * 80}ms` }}>
            <span style={{ color: 'rgba(9,9,11,0.75)' }}>{l.icon}</span>
            <span className="font-mono font-medium" style={{ color: 'rgba(9,9,11,0.7)' }}>{l.tool}</span>
            <span style={{ color: 'rgba(113,113,122,0.4)' }}>›</span>
            <span className="truncate" style={{ color: 'rgba(113,113,122,0.75)' }}>{l.arg}</span>
            <Ic d={dChevR} size={11} style={{ color: 'rgba(113,113,122,0.4)' }} />
          </div>
        ))}
        {working && <WorkingBars />}
      </div>
    </div>
  );
}

function Mention({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold" style={{ color: BLUE }}>{children}</span>;
}

// ── Scene 1: Hook (0–3s) ──

function Scene1_Hook({ localMs }: { localMs: number }) {
  const chips = ['Claude Code', 'Codex', 'Pi Agent', 'OpenClaw'];
  const punch = localMs >= 1600;
  return (
    <div className="h-full relative" style={{ background: HERO_WASH }}>
      <div className="h-full flex flex-col items-center justify-center px-24"
        style={punch && localMs < 2000 ? { animation: 'shake 0.3s linear' } : undefined}>
        <Stamp show={localMs >= 100}>
          <KickerPill>You already run great agents</KickerPill>
        </Stamp>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          {chips.map((c, i) => (
            <Stamp key={c} show={localMs >= 350 + i * 240}>
              <span className="inline-block rounded-xl bg-white px-6 py-3.5 text-[30px] font-extrabold tracking-tight transition-all duration-300"
                style={{
                  border: '2.5px solid #000', color: punch ? '#b8b8b8' : INK,
                  boxShadow: punch ? 'none' : '5px 5px 0 0 #000',
                  transform: punch ? `rotate(${(i % 2 ? 1 : -1) * 2}deg) translateY(4px)` : 'rotate(0deg)',
                }}>
                {c}
              </span>
            </Stamp>
          ))}
        </div>
        <div className="mt-9 text-[58px] font-black tracking-tight leading-none text-center" style={{ color: INK }}>
          <WordReveal show={punch} text="But they never" stagger={70} className="inline-block" />{' '}
          <WordReveal show={punch} delay={220} text="work together." stagger={70} className="inline-block" style={{ color: BLUE }} />
        </div>
      </div>
    </div>
  );
}

// ── Scene 2: Title (3–5.5s) ──

function Scene2_Title({ localMs }: { localMs: number }) {
  const burst = localMs >= 750;
  return (
    <div className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      <div className="h-full flex flex-col items-center justify-center">
        <Stamp show={localMs >= 120}>
          <img src="/images/oa-logo-black.png" alt="" className="w-16 h-16 mx-auto mb-6"
            style={{ animation: localMs >= 120 ? `logo-in 0.7s ${EASE} backwards` : undefined }} />
        </Stamp>
        <Stamp show={localMs >= 280}>
          <Wordmark size={84} />
        </Stamp>
        <div className="mt-1 flex items-center gap-5">
          <WordReveal show={localMs >= 480} text="Workspace" stagger={80}
            className="text-[84px] font-black tracking-tighter leading-none" style={{ color: INK }} />
          <span className="inline-block rounded-xl px-4 py-1.5 font-black text-[42px] leading-none"
            style={{
              background: TEAL, color: '#fff', border: '2.5px solid #000', boxShadow: '5px 5px 0 0 #000',
              transform: 'rotate(-3deg)',
              visibility: burst ? undefined : 'hidden',
              animation: burst ? `drop-in 0.45s ${EASE} backwards` : undefined,
            }}>
            1.0
          </span>
        </div>
        <Stamp show={localMs >= 1050}>
          <div className="mt-7 text-[20px] font-medium" style={{ color: '#525252' }}>
            The command center for your AI agents.
          </div>
        </Stamp>
      </div>
    </div>
  );
}

// ── Scene 3: 01 One hub (5.5–12s) — the real app, in a real browser ──

function Scene3_Hub({ localMs }: { localMs: number }) {
  const onlineCount = clamp(Math.floor((localMs - 600) / 220) + 1, 0, 5);
  const showPhone = localMs >= 3400;
  return (
    <div className="h-full relative" style={{ background: HERO_WASH }}>
      <div className="h-full flex items-center justify-center gap-9 pt-2">
        <div style={{ animation: localMs >= 150 ? `card-up 0.6s ${EASE} backwards` : undefined, visibility: localMs >= 150 ? undefined : 'hidden' }}>
          <BrowserWindow url="openagents.org/acme-team" width={790} height={520} frame={TEAL}>
            <div className="flex h-full">
              <NavRail onlineCount={onlineCount} expanded />
              <ThreadListPanel localMs={localMs} />
              {/* detail pane */}
              <div className="flex min-w-0 flex-1 flex-col bg-white">
                <div className="flex items-center gap-1.5 px-3" style={{ height: 40, borderBottom: `1px solid ${BORDER}` }}>
                  <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: TXT }}>mini-rpg</span>
                  <div className="flex -space-x-1.5">
                    {['claude-dev', 'codex-art', 'openclaw-qa'].map(n => (
                      <div key={n} className="rounded-full" style={{ border: '2px solid #fff' }}><BeamAvatar name={n} size={16} /></div>
                    ))}
                  </div>
                  <span style={{ color: MUTED }}><Ic d={dTree} size={13} /></span>
                  <span style={{ color: MUTED }}><Ic d={dShare} size={13} /></span>
                </div>
                <div className="flex-1 px-4 py-2 overflow-hidden">
                  <Stamp show={localMs >= 2100}>
                    <MsgRow who="human" name="You" time="09:02">Morning, team — status?</MsgRow>
                  </Stamp>
                  <Stamp show={localMs >= 2700}>
                    <MsgRow who="agent" name="claude-dev" time="09:02" leader>
                      All five agents online. Ready when you are.
                    </MsgRow>
                  </Stamp>
                </div>
                <div className="px-3 pb-3">
                  <Composer />
                </div>
              </div>
            </div>
          </BrowserWindow>
        </div>

        {/* mobile app — same workspace */}
        <div style={{ visibility: showPhone ? undefined : 'hidden', animation: showPhone ? `phone-in 0.65s ${EASE} backwards` : undefined }}>
          <div className="overflow-hidden rounded-[26px] bg-white"
            style={{ width: 172, height: 350, border: '3px solid #000', boxShadow: '7px 7px 0 0 #000', animation: 'float-soft 3.4s ease-in-out infinite' }}>
            <div className="flex items-center justify-between px-4 pt-2 text-[9px] font-semibold" style={{ color: TXT }}>
              <span>9:41</span>
              <span className="h-3.5 w-14 rounded-full" style={{ background: '#0a0a0a' }} />
              <span>5G</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <img src="/images/oa-logo-black.png" alt="" className="size-4" />
              <span className="text-[11px] font-semibold" style={{ color: TXT }}>acme-team</span>
              <span className="ml-auto text-[9px]" style={{ color: GREEN }}>● {onlineCount}/5</span>
            </div>
            <div className="p-1.5 space-y-0.5">
              {[
                { t: 'mini-rpg', p: 'claude-dev: On it —', a: 'claude-dev' },
                { t: 'Q3 revenue audit', p: 'Report is in /files', a: 'claude-dev' },
                { t: 'Landing page copy', p: 'Draft two is ready', a: 'pi-agent' },
              ].map((t, i) => (
                <Stamp key={t.t} show={showPhone} delay={200 + i * 100}>
                  <div className="flex items-start gap-1.5 rounded-md px-1.5 py-1.5" style={i === 0 ? { background: 'rgba(0,0,0,0.05)' } : undefined}>
                    <BeamAvatar name={t.a} size={18} />
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-medium" style={{ color: TXT }}>{t.t}</div>
                      <div className="truncate text-[9px]" style={{ color: MUTED }}>{t.p}</div>
                    </div>
                  </div>
                </Stamp>
              ))}
            </div>
            <div className="absolute" />
          </div>
        </div>
      </div>
      <LowerThird show={localMs >= 900} kicker="01 · One hub" line="Every agent in one workspace. Desktop and mobile." />
    </div>
  );
}

// ── Scene 4: 02 card (12–14s) — navy brand section ──

function Scene4_Card({ localMs }: { localMs: number }) {
  return (
    <div className="h-full relative" style={{ background: NAVY }}>
      <div className="h-full flex items-center px-28">
        <div>
          <Stamp show={localMs >= 100}>
            <KickerPill bg={TEAL} color="#fff">02 · They collaborate</KickerPill>
          </Stamp>
          <div className="mt-6">
            <WordReveal show={localMs >= 300} text="Three agents." stagger={80}
              className="text-[68px] font-black tracking-tight leading-[1.04] text-white" />
            <div className="text-[68px] font-black tracking-tight leading-[1.04] text-white">
              <WordReveal show={localMs >= 550} text="One job:" stagger={80} className="inline-block" />{' '}
              <WordReveal show={localMs >= 800} text="build a game." stagger={80} className="inline-block" style={{ color: TEAL }} />
            </div>
          </div>
          <Stamp show={localMs >= 1250}>
            <div className="mt-6 text-[16px] font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Watch a real thread — no cuts, no human glue.
            </div>
          </Stamp>
        </div>
      </div>
    </div>
  );
}

// ── Scene 5: the demo — real product, split shared-browser pane (14–34s) ──

type FlowItem =
  | { t: number; kind: 'msg'; who: 'human' | 'agent'; name: string; leader?: boolean; role?: string; time: string; text: React.ReactNode; assets?: boolean }
  | { t: number; kind: 'steps'; until: number; lines: { icon: React.ReactNode; tool: string; arg: string }[] };

const FLOW: FlowItem[] = [
  {
    t: 100, kind: 'msg', who: 'human', name: 'You', time: '09:04',
    text: <>Build a mini RPG. <Mention>@claude-dev</Mention> leads, <Mention>@codex-art</Mention> on art, <Mention>@openclaw-qa</Mention> tests.</>,
  },
  { t: 700, kind: 'msg', who: 'agent', name: 'claude-dev', leader: true, time: '09:04', text: 'On it — a forest, a river with a bridge, and a dragon’s keep. Boss fight, loot, HUD.' },
  {
    t: 1300, kind: 'steps', until: 5100, lines: [
      { icon: <Ic d={dPencil} size={12} />, tool: 'Write', arg: 'game/world.ts — 16×8 tile map' },
      { icon: <Ic d={dPencil} size={12} />, tool: 'Write', arg: 'game/combat.ts · game/hud.ts' },
      { icon: <Ic d={dTerminal} size={12} />, tool: 'Bash', arg: 'npm run dev' },
    ],
  },
  { t: 2600, kind: 'msg', who: 'agent', name: 'codex-art', role: 'agent', time: '09:05', text: 'Sprite sheet ready — hero, dragon, tileset, loot.', assets: true },
  { t: 5200, kind: 'msg', who: 'agent', name: 'claude-dev', leader: true, time: '09:05', text: '“Dragon’s Keep” v1 is live in the shared browser.' },
  { t: 5800, kind: 'msg', who: 'agent', name: 'openclaw-qa', role: 'agent', time: '09:05', text: 'Testing now.' },
  {
    t: 6200, kind: 'steps', until: 8500, lines: [
      { icon: <Ic d={dEye} size={12} />, tool: 'Playtest', arg: 'follow the path — fight the slime…' },
    ],
  },
  { t: 8600, kind: 'msg', who: 'agent', name: 'openclaw-qa', role: 'agent', time: '09:06', text: <>Found a bug — the hero can&apos;t cross the bridge. <Mention>@claude-dev</Mention> collision check?</> },
  { t: 9800, kind: 'msg', who: 'agent', name: 'claude-dev', leader: true, time: '09:06', text: 'Good catch — patched.' },
  {
    t: 10100, kind: 'steps', until: 10900, lines: [
      { icon: <Ic d={dPencil} size={12} />, tool: 'Edit', arg: 'game/collision.ts — bridge tiles walkable' },
    ],
  },
  { t: 11000, kind: 'msg', who: 'agent', name: 'openclaw-qa', role: 'agent', time: '09:06', text: 'Retesting.' },
  {
    t: 11400, kind: 'steps', until: 16900, lines: [
      { icon: <Ic d={dEye} size={12} />, tool: 'Playtest', arg: 'cross the bridge — boss fight — loot' },
    ],
  },
  { t: 17200, kind: 'msg', who: 'agent', name: 'openclaw-qa', role: 'agent', time: '09:07', text: 'Clean run — bridge works, dragon down, 120 gold looted. Ship it.' },
];

const DEMO_THIRDS = [
  { from: 700, to: 2600, kicker: 'claude-dev · leader', line: 'Writes the game' },
  { from: 2600, to: 5200, kicker: 'codex-art', line: 'Draws the assets — hands them straight over' },
  { from: 5800, to: 9800, kicker: 'openclaw-qa', line: 'Plays it. Finds a bug.' },
  { from: 9800, to: 11400, kicker: 'Feedback → fix', line: 'Same thread. Seconds later.' },
  { from: 16500, to: 19800, kicker: 'Built · drawn · tested', line: 'By three agents, on their own.' },
];
// after the thread wraps, step back and play the finished game full-screen
const SHOWCASE_AT = 20000;
const SHOWCASE_GAME_FROM = 11000;   // replay: cross the bridge → boss → loot → quest cleared
const SHOWCASE_SCALE = 1.72;

// — game board (shared browser content) — "Dragon's Keep" —
// a designed world: forest, river + bridge, dirt path, stone keep

const TILE = 34;
const COLS = 16;
const ROWS = 8;

// G grass · T tree · W water · B bridge · P path · S keep floor · R rock wall
const MAP = [
  'TTGGGTGGGWWRRRRR',
  'TGGTGGGTGWWRSSSR',
  'GGGGGGGGGWWSSSSR',
  'GGTGGTGGGWWSSSSR',
  'PPPPPPPPPBBPSSSR',
  'GTGGGGTGGWWSSSSR',
  'GGGGTGGGGWWSSSSR',
  'TGGTGGGTGWWRRRRR',
];

const FLOWERS: [number, number, string][] = [
  [3, 2, '#f472b6'], [6, 1, '#facc15'], [2, 6, '#f472b6'], [7, 6, '#facc15'], [5, 5, '#f9a8d4'],
];
const DRAGON_POS: [number, number] = [13, 2];
const CHEST_POS: [number, number] = [13, 5];
const SLIME_POS: [number, number] = [5, 4];

const HERO_ROWS = [
  '...PPP....',
  '..PPPPP...',
  '..FFFFF...',
  '..FEFEF...',
  '..FFFFF...',
  '.RRRRRR.W.',
  '.RRRRRR.W.',
  '..RRRR..W.',
  '..R..R..Y.',
  '.BB..BB...',
];
const HERO_PALETTE: Record<string, string> = {
  P: '#a78bfa', F: '#fcd9b8', E: '#1f2937', R: '#7c3aed', B: '#27272a', W: '#cbd5e1', Y: '#f59e0b',
};

// two wing frames — the dragon flaps
const DRAGON_A = [
  '.V..........V.',
  'VVV........VVV',
  'VVGG......GGVV',
  '.VGGGGGGGGGGV.',
  '..GGEGGGGEGG..',
  '..GGGGRRGGGG..',
  '.GGGGGGGGGGGG.',
  'GGGGGGGGGGGGGG',
  '.GG.GGGGGG.GG.',
  '..Y..Y..Y..Y..',
];
const DRAGON_B = [
  '..............',
  '.V..........V.',
  'VVGG......GGVV',
  'VVGGGGGGGGGGVV',
  '..GGEGGGGEGG..',
  '..GGGGRRGGGG..',
  '.GGGGGGGGGGGG.',
  'GGGGGGGGGGGGGG',
  '.GG.GGGGGG.GG.',
  '..Y..Y..Y..Y..',
];
const DRAGON_PALETTE: Record<string, string> = {
  G: '#22c55e', E: '#fef08a', R: '#ef4444', V: '#15803d', Y: '#eab308',
};

const TREE_ROWS = ['..LL..', '.LLLL.', 'LLLLLL', 'LLLLLL', '.LLLL.', '..KK..', '..KK..'];
const TREE_PALETTE: Record<string, string> = { L: '#15803d', K: '#78350f' };
const CHEST_ROWS = ['.CCCCCC.', 'CCCCCCCC', 'CCYYYYCC', 'CCCYYCCC', 'CCCCCCCC', '.CCCCCC.'];
const CHEST_OPEN_ROWS = ['.YYYYYY.', 'YCCCCCCY', 'CCYYYYCC', 'CYYYYYYC', 'CCCCCCCC', '.CCCCCC.'];
const CHEST_PALETTE: Record<string, string> = { C: '#92400e', Y: '#facc15' };
const SLIME_ROWS = ['..LLLL..', '.LLLLLL.', 'LLELLELL', 'LLLLLLLL', '.L.LL.L.'];
const SLIME_PALETTE: Record<string, string> = { L: '#4ade80', E: '#14532d' };

function PixelSprite({ rows, palette, px = 4, style }: {
  rows: string[]; palette: Record<string, string>; px?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows[0].length}, ${px}px)`, imageRendering: 'pixelated', ...style }}>
      {rows.flatMap((row, y) => row.split('').map((c, x) => (
        <div key={`${x}-${y}`} style={{ width: px, height: px, background: palette[c] || 'transparent' }} />
      )))}
    </div>
  );
}

// hero route: down the path, bump the slime, stall at the broken
// bridge (the bug), then across into the keep for the boss + loot
const HERO_KEYFRAMES: [number, number, number][] = [
  [0, 1, 4],
  [6000, 2, 4], [6300, 3, 4], [6600, 4, 4],           // meets the slime
  [7100, 5, 4], [7500, 6, 4], [7900, 7, 4], [8300, 8, 4], // reaches the bridge — stuck (bug)
  [11000, 9, 4], [11450, 10, 4], [11900, 11, 4],      // retest: crossing the bridge
  [12350, 12, 4], [12800, 12, 3], [13300, 12, 2],     // up into the keep
  [15100, 12, 3], [15500, 12, 4], [15800, 12, 5],     // down to the chest
];

function heroAt(ms: number) {
  let cur = HERO_KEYFRAMES[0];
  for (const k of HERO_KEYFRAMES) { if (ms >= k[0]) cur = k; }
  return { x: cur[1], y: cur[2] };
}

function grassColor(x: number, y: number) {
  const v = (x * 7 + y * 13) % 3;
  return v === 0 ? '#3f6d3a' : v === 1 ? '#44743e' : '#3a6636';
}

function tileStyle(c: string, x: number, y: number): React.CSSProperties {
  switch (c) {
    case 'W': return { background: (x + y) % 2 ? '#2b5f9e' : '#2a5a95' };
    case 'B': return { background: 'repeating-linear-gradient(0deg, #8a5a2b 0px, #8a5a2b 6px, #6d4520 6px, #6d4520 8px)' };
    case 'P': return { background: (x * 5 + y * 3) % 2 ? '#b08a55' : '#a67f4b' };
    case 'S': return { background: (x + y) % 2 ? '#7b8290' : '#727986' };
    case 'R': return { background: '#3d4250', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.09), inset 0 -2px 0 rgba(0,0,0,0.35)' };
    default: return { background: grassColor(x, y) };
  }
}

function PixelHeart({ off = false }: { off?: boolean }) {
  return (
    <span className="text-[11px] leading-none transition-colors duration-300" style={{ color: off ? '#3f3f46' : '#ef4444' }}>
      ♥
    </span>
  );
}

function GameBoard({ ms }: { ms: number }) {
  const wire = ms >= 1400;
  const terrain = ms >= 2200;
  const decorAt = 3600;
  const title = ms >= 5000 && ms < 5950;
  const slimeFight = ms >= 6650 && ms < 6950;
  const slimeDead = ms >= 6950;
  const stuck = ms >= 8400 && ms < 9900;      // the bridge bug
  const fixOn = ms >= 9900 && ms < 11000;
  const battle = ms >= 14100 && ms < 14800;   // boss fight
  const bossBar = ms >= 13600 && ms < 14800;
  const heartLost = ms >= 14450;
  const dragonDead = ms >= 14800;
  const lvUp = ms >= 14900 && ms < 15700;
  const chestOpen = ms >= 15900;
  const chestBursting = ms >= 15900 && ms < 16700;
  const goldPop = ms >= 15950 && ms < 16700;
  const win = ms >= 16500;
  const hero = heroAt(ms);
  const shaking = battle || (ms >= 8400 && ms < 8800) || slimeFight;
  const dragonFrame = Math.floor(ms / 320) % 2 === 0 ? DRAGON_A : DRAGON_B;
  const quest = !dragonDead ? 'Slay the dragon' : !chestOpen ? 'Open the treasure' : 'Complete ✓';

  return (
    <div style={shaking ? { animation: 'shake 0.4s linear infinite' } : undefined}>
      <div className="overflow-hidden rounded-md" style={{ width: COLS * TILE }}>
        {/* HUD — hearts, quest, gold */}
        <div className="flex items-center gap-3 px-2.5 font-mono transition-opacity duration-500"
          style={{ height: 26, background: '#15171c', opacity: terrain ? 1 : 0 }}>
          <span className="flex items-center gap-[3px]">
            <PixelHeart /><PixelHeart /><PixelHeart off={heartLost} />
          </span>
          <span className="text-[9px] uppercase" style={{ color: '#9ca3af', letterSpacing: '0.1em' }}>
            Quest: <span style={{ color: quest === 'Complete ✓' ? '#4ade80' : '#fbbf24' }}>{quest}</span>
          </span>
          <span className="ml-auto text-[9px] uppercase" style={{ color: '#facc15', letterSpacing: '0.1em' }}>
            {chestOpen && ms >= 16000 ? '120' : '0'} G
          </span>
          <span className="text-[9px]" style={{ color: '#52525b' }}>LV {dragonDead ? 2 : 1}</span>
        </div>

        <div className="relative overflow-hidden" style={{ width: COLS * TILE, height: ROWS * TILE, background: '#20241d' }}>
          {/* tiles from the map */}
          {MAP.flatMap((row, y) => row.split('').map((c, x) => (
            <div key={`${x}-${y}`} className="absolute transition-all"
              style={{
                left: x * TILE, top: y * TILE, width: TILE, height: TILE,
                transitionDuration: '300ms', transitionDelay: `${(x + y) * 10}ms`,
                ...(terrain ? tileStyle(c === 'T' ? 'G' : c, x, y) : { background: 'transparent' }),
                border: wire && !terrain ? '1px dashed rgba(246,245,241,0.25)' : '1px solid rgba(0,0,0,0.05)',
                opacity: wire ? 1 : 0,
              }}>
              {/* water ripples */}
              {terrain && c === 'W' && (
                <span className="absolute rounded-full" style={{
                  left: 6 + ((x * 13 + y * 7) % 12), top: 9 + ((x * 5 + y * 11) % 14),
                  width: 10, height: 2, background: 'rgba(255,255,255,0.32)',
                  animation: 'ripple 2.4s ease-in-out infinite', animationDelay: `${((x * 3 + y * 5) % 10) * 0.2}s`,
                }} />
              )}
            </div>
          )))}
          {/* flowers */}
          {terrain && FLOWERS.map(([x, y, c], i) => (
            <div key={i} className="absolute" style={{
              left: x * TILE + TILE * 0.55, top: y * TILE + TILE * 0.6,
              animation: `stamp 0.3s ease-out ${300 + i * 60}ms backwards`,
            }}>
              <div style={{ width: 4, height: 4, background: c }} />
              <div style={{ width: 2.5, height: 4, background: '#166534', marginLeft: 1 }} />
            </div>
          ))}
          {/* cloud shadows */}
          {terrain && (
            <>
              <div className="absolute rounded-full pointer-events-none" style={{
                width: 190, height: 80, top: 26, background: 'rgba(0,0,0,0.10)', filter: 'blur(13px)',
                animation: 'cloud-drift 11s linear infinite',
              }} />
              <div className="absolute rounded-full pointer-events-none" style={{
                width: 130, height: 54, top: 150, background: 'rgba(0,0,0,0.08)', filter: 'blur(11px)',
                animation: 'cloud-drift 15s linear 4s infinite',
              }} />
            </>
          )}
          {/* trees (from the map) */}
          {MAP.flatMap((row, y) => row.split('').map((c, x) => c === 'T' ? (
            <div key={`t${x}-${y}`} className="absolute transition-all duration-200 flex items-center justify-center"
              style={{
                left: x * TILE, top: y * TILE, width: TILE, height: TILE,
                opacity: ms >= decorAt + ((x * 3 + y * 5) % 7) * 60 ? 1 : 0,
                transform: ms >= decorAt + ((x * 3 + y * 5) % 7) * 60 ? 'scale(1)' : 'scale(0.3)',
              }}>
              <div style={{ animation: 'tree-sway 3.2s ease-in-out infinite', animationDelay: `${(x + y) * 300}ms`, transformOrigin: '50% 100%' }}>
                <PixelSprite rows={TREE_ROWS} palette={TREE_PALETTE} px={4.4} />
              </div>
            </div>
          ) : null))}
          {/* slime mini-enemy */}
          {!slimeDead && (
            <div className="absolute flex items-end justify-center transition-all duration-200"
              style={{
                left: SLIME_POS[0] * TILE + 3, top: SLIME_POS[1] * TILE + 6, width: TILE - 6, height: TILE - 8,
                opacity: ms >= decorAt + 300 ? 1 : 0,
              }}>
              <div style={{ animation: 'hero-bob 0.7s ease-in-out infinite' }}>
                <PixelSprite rows={SLIME_ROWS} palette={SLIME_PALETTE} px={3.2} />
              </div>
            </div>
          )}
          {slimeFight && (
            <div className="absolute z-30 font-mono font-bold text-[12px]" style={{
              left: SLIME_POS[0] * TILE + 4, top: (SLIME_POS[1] - 0.6) * TILE,
              color: '#fff', textShadow: '2px 2px 0 #161613', animation: 'dmg-pop 0.6s ease-out both',
            }}>
              -10
            </div>
          )}
          {/* dragon boss (flapping) */}
          <div className="absolute transition-all duration-300 flex items-center justify-center"
            style={{
              left: DRAGON_POS[0] * TILE - 14, top: DRAGON_POS[1] * TILE - 8, width: TILE + 28, height: TILE + 14,
              opacity: ms >= 4200 && !dragonDead ? 1 : 0,
              transform: dragonDead ? 'scale(0.2) rotate(30deg)' : ms >= 4200 ? 'scale(1)' : 'scale(0.3)',
            }}>
            <div style={{
              animation: battle ? 'jitter 0.15s linear infinite' : 'float-soft 2.2s ease-in-out infinite',
              filter: battle ? 'brightness(1.5) saturate(1.8) hue-rotate(-40deg)' : undefined,
            }}>
              <PixelSprite rows={dragonFrame} palette={DRAGON_PALETTE} px={3.6} />
            </div>
          </div>
          {/* boss HP bar */}
          {bossBar && (
            <div className="absolute z-20" style={{ left: DRAGON_POS[0] * TILE - 16, top: DRAGON_POS[1] * TILE - 16, width: 64 }}>
              <div className="font-mono text-[7px] font-bold uppercase" style={{ color: '#fca5a5', letterSpacing: '0.1em' }}>Dragon</div>
              <div className="h-[5px] w-full rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(0,0,0,0.7)' }}>
                <div className="h-full rounded-sm" style={{
                  background: '#ef4444',
                  width: `${clamp(((14800 - ms) / 1200) * 100, 0, 100)}%`,
                  transition: 'width 200ms linear',
                }} />
              </div>
            </div>
          )}
          {/* chest */}
          <div className="absolute transition-all duration-200 flex items-center justify-center"
            style={{
              left: CHEST_POS[0] * TILE, top: CHEST_POS[1] * TILE, width: TILE, height: TILE,
              opacity: ms >= 4600 ? 1 : 0,
              transform: chestOpen ? 'scale(1.15)' : ms >= 4600 ? 'scale(1)' : 'scale(0.3)',
            }}>
            <PixelSprite rows={chestOpen ? CHEST_OPEN_ROWS : CHEST_ROWS} palette={CHEST_PALETTE} px={3.8} />
            {chestBursting && Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="absolute block" style={{
                left: '50%', top: '40%', width: 4, height: 4,
                background: i % 2 ? '#facc15' : '#fde68a',
                ['--dx' as string]: `${Math.cos((i / 8) * Math.PI * 2) * 30}px`,
                ['--dy' as string]: `${Math.sin((i / 8) * Math.PI * 2) * 26 - 12}px`,
                animation: `burst 0.7s ${EASE} both`,
              }} />
            ))}
            {goldPop && (
              <span className="absolute -top-3 font-mono text-[11px] font-bold" style={{
                color: '#facc15', textShadow: '1.5px 1.5px 0 #161613', animation: 'dmg-pop 0.8s ease-out both',
              }}>
                +120g
              </span>
            )}
          </div>
          {/* hero */}
          <div className="absolute flex items-center justify-center transition-all ease-linear z-10"
            style={{
              transitionDuration: '340ms',
              left: hero.x * TILE + 1, top: hero.y * TILE - 4, width: TILE - 2, height: TILE + 4,
              opacity: ms >= 5000 ? 1 : 0,
              animation: stuck ? 'jitter 0.22s linear infinite' : undefined,
            }}>
            <div style={{ animation: stuck ? undefined : 'hero-bob 0.55s ease-in-out infinite' }}>
              <PixelSprite rows={HERO_ROWS} palette={HERO_PALETTE} px={3.2} />
            </div>
            {lvUp && (
              <span className="absolute -top-3 font-mono text-[11px] font-bold whitespace-nowrap" style={{
                color: '#fbbf24', textShadow: '1.5px 1.5px 0 #161613', animation: 'dmg-pop 0.8s ease-out both',
              }}>
                LV UP!
              </span>
            )}
          </div>
          {/* boss battle flash + damage */}
          {battle && (
            <>
              <div className="absolute inset-0 z-20 pointer-events-none" style={{ background: '#fff', animation: 'flash 0.35s ease-out both' }} />
              <div className="absolute z-30 font-mono font-bold text-[14px]" style={{
                left: (DRAGON_POS[0] - 0.6) * TILE, top: (DRAGON_POS[1] - 1.1) * TILE,
                color: '#fff', textShadow: '2px 2px 0 #161613', animation: 'dmg-pop 0.7s ease-out both',
              }}>
                -99
              </div>
            </>
          )}
          {heartLost && ms < 14750 && (
            <div className="absolute inset-0 z-20 pointer-events-none" style={{ background: 'rgba(239,68,68,0.28)', animation: 'flash 0.4s ease-out both' }} />
          )}
          {/* status chips */}
          {stuck && (
            <div className="absolute top-2 right-2 z-20 px-2 py-0.5 rounded text-[9px] uppercase font-bold font-mono"
              style={{ background: '#dc2626', color: '#fff', letterSpacing: '0.1em', animation: 'stamp 0.25s ease-out' }}>
              bug: bridge collision
            </div>
          )}
          {fixOn && (
            <div className="absolute top-2 right-2 z-20 px-2 py-0.5 rounded text-[9px] uppercase font-bold font-mono"
              style={{ background: '#0E9F6E', color: '#fff', letterSpacing: '0.1em', animation: 'stamp 0.25s ease-out' }}>
              patched
            </div>
          )}
          {/* v1 title splash */}
          {title && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center" style={{ background: 'rgba(10,10,14,0.72)', animation: 'flash-in 0.3s ease-out' }}>
              <div className="font-mono text-[24px] font-black tracking-[0.18em]" style={{ color: '#facc15', textShadow: '3px 3px 0 #92400e' }}>
                DRAGON&apos;S KEEP
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.3em]" style={{ color: '#a1a1aa' }}>v1.0 — press start</div>
            </div>
          )}
          {/* win overlay */}
          {win && (
            <>
              {Array.from({ length: 18 }).map((_, i) => (
                <span key={i} className="absolute z-40 block" style={{
                  left: `${(i * 59) % 100}%`, top: -8, width: 5, height: 9,
                  background: [BLUE, '#facc15', TEAL, '#a78bfa'][i % 4],
                  animation: `confetti-fall ${1.2 + (i % 3) * 0.3}s linear ${(i * 97) % 500}ms both`,
                }} />
              ))}
              <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: 'rgba(10,10,10,0.5)' }}>
                <div style={{ animation: `drop-in 0.5s ${EASE} both` }}>
                  <div className="px-6 py-3.5 text-center rounded-lg bg-white" style={{ border: '2.5px solid #000', boxShadow: `5px 5px 0 0 ${TEAL}` }}>
                    <div className="text-[9px] uppercase font-bold font-mono mb-0.5" style={{ letterSpacing: '0.25em', color: MUTED }}>run complete</div>
                    <div className="text-xl font-black tracking-tight" style={{ color: INK }}>QUEST CLEARED</div>
                  </div>
                </div>
              </div>
            </>
          )}
          {/* CRT feel */}
          <div className="absolute inset-0 z-[35] pointer-events-none" style={{
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 1px, transparent 1px, transparent 4px)',
          }} />
          <div className="absolute inset-0 z-[35] pointer-events-none" style={{
            background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.3) 100%)',
          }} />
          {!wire && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 font-mono text-[10px] uppercase"
              style={{ color: 'rgba(246,245,241,0.45)', letterSpacing: '0.2em' }}>
              <span>waiting for dev server…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetStrip() {
  return (
    <div className="mt-1.5 flex gap-1.5">
      {[
        { rows: HERO_ROWS, palette: HERO_PALETTE, label: 'hero.png' },
        { rows: DRAGON_A, palette: DRAGON_PALETTE, label: 'dragon.png' },
        { rows: TREE_ROWS, palette: TREE_PALETTE, label: 'tiles.png' },
        { rows: CHEST_ROWS, palette: CHEST_PALETTE, label: 'chest.png' },
      ].map((s, i) => (
        <div key={s.label} className="flex flex-col items-center gap-0.5 rounded-lg p-1.5"
          style={{ border: `1px solid ${BORDER}`, background: '#fafafa', animation: `drop-in 0.35s ${EASE} ${i * 90}ms backwards` }}>
          <PixelSprite rows={s.rows} palette={s.palette} px={2.2} />
          <span className="font-mono text-[7px]" style={{ color: MUTED }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function Scene5_Demo({ localMs }: { localMs: number }) {
  const visible = FLOW.filter(f => localMs >= f.t).slice(-6);
  const third = DEMO_THIRDS.find(c => localMs >= c.from && localMs < c.to);
  const done = localMs >= 16500;
  const showcase = localMs >= SHOWCASE_AT;
  const showcaseMs = localMs - SHOWCASE_AT;

  return (
    <div className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      <div className="h-full flex items-center justify-center pt-1 pb-16"
        style={{ opacity: showcase ? 0 : 1, transform: showcase ? 'scale(0.94)' : 'scale(1)', transition: `opacity 0.55s ease, transform 0.7s ${EASE}` }}>
        <div style={{ animation: `card-up 0.55s ${EASE} backwards` }}>
          <BrowserWindow url="openagents.org/acme-team" width={1120} height={600} frame={NAVY}>
            <div className="flex h-full">
              <NavRail onlineCount={5} expanded={false} />
              {/* chat pane */}
              <div className="flex min-w-0 flex-col bg-white" style={{ width: 480, borderRight: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-1.5 px-3.5 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
                  <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: TXT }}>mini-rpg</span>
                  <div className="flex -space-x-1.5">
                    {['claude-dev', 'codex-art', 'openclaw-qa'].map(n => (
                      <div key={n} className="rounded-full" style={{ border: '2px solid #fff' }}><BeamAvatar name={n} size={17} /></div>
                    ))}
                  </div>
                  <span style={{ color: MUTED }}><Ic d={dTree} size={13} /></span>
                  <span style={{ color: MUTED }}><Ic d={dShare} size={13} /></span>
                </div>
                {/* roster bar (real product: multi-agent threads) */}
                <div className="flex items-center gap-1.5 px-3.5 py-1 shrink-0 overflow-hidden whitespace-nowrap"
                  style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(250,250,250,0.6)' }}>
                  <BeamAvatar name="claude-dev" size={14} />
                  <span className="text-[10px] font-semibold" style={{ color: TXT }}>claude-dev</span>
                  <Ic d={dCrown} size={10} fill="#f59e0b" sw={0} style={{ color: '#f59e0b' }} />
                  <span className="text-[10px]" style={{ color: '#d4d4d8' }}>|</span>
                  <BeamAvatar name="codex-art" size={14} />
                  <span className="text-[10px] font-semibold" style={{ color: TXT }}>codex-art</span>
                  <span className="text-[10px]" style={{ color: '#d4d4d8' }}>|</span>
                  <BeamAvatar name="openclaw-qa" size={14} />
                  <span className="text-[10px] font-semibold" style={{ color: TXT }}>openclaw-qa</span>
                </div>
                <div className="flex flex-1 flex-col justify-end overflow-hidden px-3.5 py-1.5">
                  {visible.map((f) => (
                    <div key={f.t} style={{ animation: `msg-in 0.3s ${EASE}` }}>
                      {f.kind === 'msg' ? (
                        <MsgRow who={f.who} name={f.name} leader={f.leader} role={f.role} time={f.time}>
                          {f.text}
                          {f.assets && <AssetStrip />}
                        </MsgRow>
                      ) : (
                        <StepsCluster lines={f.lines} working={localMs < f.until} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-2.5 shrink-0">
                  <Composer />
                </div>
              </div>
              {/* shared browser pane — a real product feature */}
              <div className="flex min-w-0 flex-1 flex-col bg-white">
                <div className="flex items-center gap-2 px-3.5 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
                  <Ic d={dGlobe} size={13} style={{ color: MUTED }} />
                  <span className="text-[12px] font-semibold" style={{ color: TXT }}>Shared browser</span>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: '#f4f4f5', color: MUTED }}>localhost:5173</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium" style={{ color: done ? '#0E9F6E' : MUTED }}>
                    <span className="size-1.5 rounded-full" style={{ background: done ? '#0E9F6E' : GREEN, animation: done ? undefined : 'pulse-dot 1.6s ease-in-out infinite' }} />
                    {done ? 'complete' : 'agents controlling'}
                  </span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-2" style={{ background: '#fafafa' }}>
                  <GameBoard ms={localMs} />
                  <div className="flex gap-4">
                    {[['claude-dev', 'builds'], ['codex-art', 'draws'], ['openclaw-qa', 'tests']].map(([n, r]) => (
                      <span key={n} className="flex items-center gap-1.5 text-[10px]" style={{ color: MUTED }}>
                        <BeamAvatar name={n} size={13} />
                        <span className="font-semibold" style={{ color: TXT }}>{n}</span> {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </BrowserWindow>
        </div>
      </div>
      {/* ── the finished game, full screen ── */}
      {showcase && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center"
          style={{ background: 'radial-gradient(ellipse at 50% 45%, #1a1f2e 0%, #0b0d12 70%)', animation: 'flash-in 0.5s ease-out both' }}>
          <div className="mb-5 flex items-center gap-3" style={{ animation: `stamp 0.4s ${EASE} 500ms backwards` }}>
            <span className="rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#a1a1aa', border: '1px solid rgba(255,255,255,0.14)' }}>
              ▶ live build · localhost:5173
            </span>
            <span className="font-mono text-[20px] font-black tracking-[0.16em]" style={{ color: '#facc15', textShadow: '3px 3px 0 #92400e' }}>
              DRAGON&apos;S KEEP
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: '#71717a' }}>v1.0</span>
          </div>
          <div className="flex items-center justify-center" style={{
            width: COLS * TILE * SHOWCASE_SCALE, height: (ROWS * TILE + 26) * SHOWCASE_SCALE,
            animation: `reveal-in 0.8s ${EASE} 150ms backwards`,
          }}>
            <div style={{ transform: `scale(${SHOWCASE_SCALE})`, transformOrigin: '50% 50%', width: COLS * TILE, height: ROWS * TILE + 26,
              borderRadius: 6, boxShadow: '0 0 0 2px #000, 0 0 90px rgba(47,107,255,0.35), 0 30px 60px rgba(0,0,0,0.6)' }}>
              <GameBoard ms={SHOWCASE_GAME_FROM + showcaseMs} />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-5" style={{ animation: `stamp 0.4s ${EASE} 900ms backwards` }}>
            {[['claude-dev', 'built it'], ['codex-art', 'drew it'], ['openclaw-qa', 'tested it']].map(([n, r]) => (
              <span key={n} className="flex items-center gap-2 text-[13px]" style={{ color: '#a1a1aa' }}>
                <BeamAvatar name={n} size={22} />
                <span className="font-semibold" style={{ color: '#fff' }}>{n}</span> {r}
              </span>
            ))}
            <span className="text-[13px]" style={{ color: '#52525b' }}>·</span>
            <span className="text-[13px] font-bold" style={{ color: TEAL }}>One thread. Zero hand-holding.</span>
          </div>
        </div>
      )}
      <LowerThird show={!!third} kicker={third?.kicker ?? ''} line={third?.line ?? ''} />
    </div>
  );
}

// ── Scene 6: feature montage — "a lot more inside" (34–42s) ──

const SKILLS = [
  { name: 'Web Research', desc: 'Deep-dive any topic', bg: BLUE },
  { name: 'PDF Reports', desc: 'Branded docs & decks', bg: TEAL },
  { name: 'Slack Digest', desc: 'Channel summaries', bg: '#7c3aed' },
  { name: 'Data Charts', desc: 'CSV → visuals', bg: '#F59E0B' },
  { name: 'Code Review', desc: 'PR feedback', bg: NAVY },
  { name: 'Email Triage', desc: 'Inbox zero, daily', bg: '#D6266F' },
];

function SkillsPanel({ ms }: { ms: number }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
        <Ic d={dZap} size={14} style={{ color: TXT }} />
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>Skills</span>
        <span className="rounded-full px-1.5 text-[10px]" style={{ border: `1px solid ${INPUTB}`, color: MUTED }}>128</span>
        <div className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px]" style={{ border: `1px solid ${INPUTB}`, color: '#a1a1aa' }}>
          <Ic d={dSearch} size={11} /> Search skills…
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2.5 p-4" style={{ background: '#fafafa' }}>
        {SKILLS.map((s, i) => {
          const installed = i === 0 && ms >= 1300;
          return (
            <div key={s.name} className="flex flex-col rounded-xl bg-white p-3"
              style={{ border: `1px solid ${BORDER}`, animation: `card-up 0.35s ${EASE} ${i * 70}ms backwards` }}>
              <span className="flex size-8 items-center justify-center rounded-lg text-white" style={{ background: s.bg }}>
                <Ic d={dZap} size={14} />
              </span>
              <div className="mt-2 text-[12px] font-semibold" style={{ color: TXT }}>{s.name}</div>
              <div className="text-[10px]" style={{ color: MUTED }}>{s.desc}</div>
              <div className="mt-auto pt-2">
                <span className="inline-block rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all duration-300"
                  style={installed
                    ? { background: 'rgba(22,199,154,0.12)', color: '#0FA983', border: '1px solid rgba(22,199,154,0.4)' }
                    : { background: TXT, color: '#fff' }}>
                  {installed ? '✓ Installed' : 'Install'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoutinesPanel({ ms }: { ms: number }) {
  const routines = [
    { name: 'Morning standup digest', sched: 'daily 09:00', agent: 'claude-dev', running: true },
    { name: 'Weekly metrics report', sched: 'Mon 08:00', agent: 'pi-agent', running: false },
    { name: 'Inbox triage', sched: 'every 2h', agent: 'gemini-cli', running: false },
    { name: 'Competitor watch', sched: 'daily 18:00', agent: 'codex-art', running: false },
  ];
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
        <Ic d={dClock} size={14} style={{ color: TXT }} />
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>Routines</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: TXT, color: '#fff' }}>
          <Ic d={dPlus} size={11} /> New routine
        </span>
      </div>
      <div className="flex-1 space-y-2 p-4" style={{ background: '#fafafa' }}>
        {routines.map((r, i) => (
          <div key={r.name} className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-2.5"
            style={{ border: `1px solid ${BORDER}`, animation: `card-up 0.35s ${EASE} ${i * 90}ms backwards` }}>
            <BeamAvatar name={r.agent} size={24} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold" style={{ color: TXT }}>{r.name}</div>
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: MUTED }}>
                <span className="rounded px-1 py-px font-mono" style={{ background: '#f4f4f5' }}>{r.sched}</span>
                {r.agent}
              </div>
            </div>
            {r.running && ms >= 1000 ? (
              <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: '#0FA983' }}>
                <WorkingBars /> running
              </span>
            ) : (
              <span className="text-[10px]" style={{ color: '#a1a1aa' }}>last run ✓</span>
            )}
            <span className="relative h-4 w-7 rounded-full" style={{ background: TEAL }}>
              <span className="absolute right-0.5 top-0.5 size-3 rounded-full bg-white" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksPanel({ ms }: { ms: number }) {
  const moved = ms >= 1400;
  const col = (title: string, count: number, cards: { t: string; a: string }[]) => (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl p-2" style={{ background: '#f4f4f5' }}>
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        <span className="text-[11px] font-semibold" style={{ color: TXT }}>{title}</span>
        <span className="text-[10px]" style={{ color: '#a1a1aa' }}>{count}</span>
      </div>
      <div className="space-y-1.5">
        {cards.map(c => (
          <div key={c.t} className="rounded-lg bg-white px-2.5 py-2" style={{ border: `1px solid ${BORDER}`, animation: `msg-in 0.3s ${EASE}` }}>
            <div className="text-[11px] font-medium leading-snug" style={{ color: TXT }}>{c.t}</div>
            <div className="mt-1.5 flex items-center justify-between">
              <BeamAvatar name={c.a} size={16} />
              <span className="size-1.5 rounded-full" style={{ background: GREEN }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
        <Ic d={dCols} size={14} style={{ color: TXT }} />
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>Tasks</span>
        <span className="text-[11px]" style={{ color: MUTED }}>Assign a card — an agent picks it up</span>
      </div>
      <div className="flex flex-1 gap-2.5 p-4" style={{ background: '#fafafa' }}>
        {col('To do', 2, [
          { t: 'Draft onboarding email', a: 'pi-agent' },
          { t: 'Refresh pricing page', a: 'codex-art' },
        ])}
        {col('In progress', moved ? 1 : 2, moved
          ? [{ t: 'Q3 revenue audit', a: 'claude-dev' }]
          : [{ t: 'Q3 revenue audit', a: 'claude-dev' }, { t: 'Fix login redirect', a: 'openclaw-qa' }])}
        {col('Done', moved ? 3 : 2, moved
          ? [{ t: 'Fix login redirect', a: 'openclaw-qa' }, { t: 'Mini RPG v1', a: 'claude-dev' }, { t: 'Sprint notes', a: 'gemini-cli' }]
          : [{ t: 'Mini RPG v1', a: 'claude-dev' }, { t: 'Sprint notes', a: 'gemini-cli' }])}
      </div>
    </div>
  );
}

// workflow = a pipeline of handoffs: agent → human → agent → agent,
// all editing the same shared file
function WorkflowsPanel({ ms }: { ms: number }) {
  const steps = [
    { who: 'agent' as const, name: 'claude-dev', task: 'Draft Q3 report', doneAt: 800 },
    { who: 'human' as const, name: 'You', task: 'Review & approve', doneAt: 1500 },
    { who: 'agent' as const, name: 'codex-art', task: 'Design the slides', doneAt: 2100 },
    { who: 'agent' as const, name: 'pi-agent', task: 'Send to client', doneAt: 99999 },
  ];
  const activeIdx = steps.findIndex(s => ms < s.doneAt);
  const fileStep = activeIdx === -1 ? steps.length - 1 : activeIdx;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
        <Ic d={dWorkflow} size={14} style={{ color: TXT }} />
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>Workflows</span>
        <span className="text-[11px]" style={{ color: MUTED }}>Client report pipeline</span>
        <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(22,199,154,0.12)', color: '#0FA983' }}>
          running
        </span>
      </div>
      <div className="relative flex flex-1 flex-col justify-center px-6" style={{ background: '#fafafa' }}>
        {/* step chain */}
        <div className="flex items-stretch gap-0">
          {steps.map((s, i) => {
            const done = ms >= s.doneAt;
            const active = i === activeIdx;
            return (
              <div key={s.name + i} className="flex flex-1 items-center min-w-0">
                <div className="min-w-0 flex-1 rounded-xl bg-white p-3 transition-all duration-500"
                  style={{
                    border: active ? '2px solid #000' : `1px solid ${BORDER}`,
                    boxShadow: active ? '4px 4px 0 0 #000' : 'none',
                    opacity: done || active ? 1 : 0.55,
                    animation: `card-up 0.4s ${EASE} ${i * 120}ms backwards`,
                  }}>
                  <div className="flex items-center gap-2">
                    {s.who === 'human' ? <HumanAvatar size={22} /> : <BeamAvatar name={s.name} size={22} />}
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold" style={{ color: TXT }}>{s.name}</div>
                      <div className="text-[9px] font-medium uppercase tracking-wide" style={{ color: s.who === 'human' ? BLUE : MUTED }}>
                        {s.who === 'human' ? 'human step' : 'agent step'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] leading-snug" style={{ color: TXT }}>{s.task}</div>
                  <div className="mt-2 text-[10px] font-medium">
                    {done ? (
                      <span style={{ color: '#0FA983' }}>✓ done</span>
                    ) : active ? (
                      s.who === 'human'
                        ? <span className="rounded px-1.5 py-0.5" style={{ background: BLUE, color: '#fff' }}>{ms >= s.doneAt - 350 ? 'Approved ✓' : 'Waiting for you…'}</span>
                        : <span className="flex items-center gap-1" style={{ color: '#0FA983' }}><WorkingBars /></span>
                    ) : (
                      <span style={{ color: '#a1a1aa' }}>queued</span>
                    )}
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex w-7 shrink-0 items-center justify-center" style={{ color: ms >= s.doneAt ? TXT : '#d4d4d8' }}>
                    <Ic d={dArrowR} size={15} sw={2.4} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* the shared file travels down the pipeline */}
        <div className="relative mt-5 h-8">
          <div className="absolute flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 transition-all duration-700"
            style={{
              border: '1.5px solid #000', boxShadow: '3px 3px 0 0 #000',
              left: `${Math.min((fileStep / steps.length) * 100 + 3, 70)}%`,
            }}>
            <Ic d={dFile} size={12} style={{ color: BLUE }} />
            <span className="font-mono text-[10px] font-medium" style={{ color: TXT }}>q3-report.md</span>
            <span className="text-[9px]" style={{ color: MUTED }}>· shared file</span>
          </div>
        </div>
        <div className="mt-3 text-center text-[11px] font-medium" style={{ color: MUTED }}>
          One shared file — every step, human or agent, edits the same doc.
        </div>
      </div>
    </div>
  );
}

// dedicated humans+agents thread — used by the standalone Team scene
function MayaRow({ children, time }: { children: React.ReactNode; time: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <HumanAvatar size={26} hue={340} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: TXT }}>Maya</span>
          <span className="rounded px-1 py-px text-[9px] font-semibold" style={{ background: '#f4f4f5', color: MUTED }}>human</span>
          <span className="text-[10px]" style={{ color: '#a1a1aa' }}>{time}</span>
        </div>
        <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: TXT }}>{children}</div>
      </div>
    </div>
  );
}

function HumanRow({ who, time, children }: { who: keyof typeof HUMANS; time: string; children: React.ReactNode }) {
  const h = HUMANS[who];
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <PhotoAvatar src={h.src} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: TXT }}>{h.name}</span>
          <span className="rounded px-1 py-px text-[9px] font-semibold" style={{ background: '#f4f4f5', color: MUTED }}>{h.role}</span>
          <span className="text-[10px]" style={{ color: '#a1a1aa' }}>{time}</span>
        </div>
        <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: TXT }}>{children}</div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="rounded px-1 font-mono text-[11.5px]" style={{ background: '#f4f4f5', color: TXT }}>{children}</span>;
}

// Phase A (0–3s): invite Maya by email. Phase B (3–10s): the analytics thread.
const INVITE_MS = 3000;
const INVITE_EMAIL = 'maya@acme.com';

function InviteModal({ ms }: { ms: number }) {
  const typed = INVITE_EMAIL.slice(0, clamp(Math.floor((ms - 450) / 60), 0, INVITE_EMAIL.length));
  const sent = ms >= 1900;
  const closing = ms >= 2450;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: 'rgba(9,9,11,0.35)', backdropFilter: 'blur(2px)', opacity: closing ? 0 : 1, transition: 'opacity 0.3s ease' }}>
      <div className="w-[340px] rounded-2xl bg-white p-5"
        style={{ border: '2px solid #000', boxShadow: '6px 6px 0 0 #000', animation: `card-up 0.45s ${EASE} backwards` }}>
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: '#eaf2ff', color: BLUE }}>
            <Ic d={dMail} size={15} />
          </span>
          <div>
            <div className="text-[14px] font-bold" style={{ color: TXT }}>Invite teammates</div>
            <div className="text-[11px]" style={{ color: MUTED }}>They join the same threads as your agents.</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]"
          style={{ border: `1.5px solid ${sent ? GREEN : typed ? TXT : INPUTB}`, color: typed ? TXT : '#a1a1aa', transition: 'border-color 0.2s' }}>
          <Ic d={dMail} size={14} style={{ color: MUTED }} />
          <span className="flex-1">
            {typed || 'name@company.com'}
            {typed && !sent && <span className="animate-pulse" style={{ color: TXT }}>▏</span>}
          </span>
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: '#f4f4f5', color: MUTED }}>Data lead</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: MUTED }}>Invite link expires in 7 days</span>
          <span className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold"
            style={{ background: sent ? GREEN : typed.length === INVITE_EMAIL.length ? TXT : '#e4e4e7', color: sent || typed.length === INVITE_EMAIL.length ? '#fff' : '#a1a1aa', transition: 'all 0.2s' }}>
            {sent && <Ic d={dCheck} size={12} sw={3} />}
            {sent ? 'Invite sent' : 'Send invite'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TeamPanel({ ms }: { ms: number }) {
  const joined = ms >= 2600;
  const t = ms - INVITE_MS;
  const mayaTyping = t >= 3500 && t < 4300;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
        <Ic d={dUsers} size={14} style={{ color: TXT }} />
        <span className="text-[13px] font-semibold" style={{ color: TXT }}>posthog-data-analysis</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex -space-x-1.5">
            <div className="rounded-full" style={{ border: '2px solid #fff' }}><PhotoAvatar src={HUMANS.you.src} size={18} /></div>
            {joined && <div className="rounded-full" style={{ border: '2px solid #fff', animation: `stamp 0.35s ${EASE} backwards` }}><PhotoAvatar src={HUMANS.maya.src} size={18} /></div>}
            <div className="rounded-full" style={{ border: '2px solid #fff' }}><BeamAvatar name="posthog-analyst" size={18} /></div>
            <div className="rounded-full" style={{ border: '2px solid #fff' }}><BeamAvatar name="claude-dev" size={18} /></div>
            <div className="rounded-full" style={{ border: '2px solid #fff' }}><BeamAvatar name="pi-agent" size={18} /></div>
          </div>
          <span className="text-[10px] font-medium" style={{ color: GREEN }}>{joined ? '2 humans' : '1 human'} · 3 agents</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-4 py-2">
        {joined && (
          <div className="flex items-center gap-2 py-1.5 text-[11px]" style={{ color: MUTED, animation: `msg-in 0.3s ${EASE}` }}>
            <PhotoAvatar src={HUMANS.maya.src} size={16} />
            <span><span className="font-semibold" style={{ color: TXT }}>Maya</span> joined via email invite</span>
            <span className="h-px flex-1" style={{ background: BORDER }} />
            <span style={{ color: '#a1a1aa' }}>16:01</span>
          </div>
        )}
        {t >= 300 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <HumanRow who="you" time="16:02">Activation dropped 12% this week. Why? <Mention>@posthog-analyst</Mention> <Mention>@claude-dev</Mention></HumanRow>
          </div>
        )}
        {t >= 1100 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <MsgRow who="agent" name="posthog-analyst" time="16:02" leader>Drop is at onboarding step 3 (−38%). Breaking down by platform…</MsgRow>
            <StepsCluster lines={[{ icon: <Ic d={dDb} size={12} />, tool: 'HogQL', arg: "SELECT … FROM events WHERE event = 'onboarding_step'" }]} working={t < 2500} />
          </div>
        )}
        {t >= 2600 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <MsgRow who="agent" name="claude-dev" time="16:03">Found it — <Code>onboarding_step_completed</Code> stopped firing on mobile Safari after PR #412. Fix ready.</MsgRow>
            <StepsCluster lines={[{ icon: <Ic d={dTerminal} size={12} />, tool: 'Bash', arg: 'git diff src/track.ts' }]} working={false} />
          </div>
        )}
        {mayaTyping && (
          <div className="flex items-center gap-2.5 py-1.5" style={{ animation: `msg-in 0.2s ${EASE}` }}>
            <PhotoAvatar src={HUMANS.maya.src} size={26} />
            <div className="flex gap-1 rounded-lg px-3 py-2.5" style={{ background: '#f4f4f5' }}>
              {[0, 1, 2].map(d => (
                <span key={d} className="size-1.5 rounded-full" style={{ background: MUTED, animation: `dot-bounce 0.9s ease-in-out ${d * 150}ms infinite` }} />
              ))}
            </div>
            <span className="text-[10px]" style={{ color: '#a1a1aa' }}>Maya is typing…</span>
          </div>
        )}
        {t >= 4300 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <HumanRow who="maya" time="16:03">Confirmed — not a real drop. Approved, ship it. <Mention>@pi-agent</Mention> add a daily data-quality alert.</HumanRow>
          </div>
        )}
        {t >= 5200 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <MsgRow who="agent" name="claude-dev" time="16:04">Merged ✓ — tracking fix is live.</MsgRow>
          </div>
        )}
        {t >= 5700 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <MsgRow who="agent" name="pi-agent" time="16:04">Daily event-volume check scheduled → posts here.</MsgRow>
          </div>
        )}
        {t >= 6300 && (
          <div style={{ animation: `msg-in 0.3s ${EASE}` }}>
            <MsgRow who="agent" name="posthog-analyst" time="16:04" leader>Dashboard corrected ✓ — Maya, want a look?</MsgRow>
          </div>
        )}
      </div>
      <div className="px-3 pb-2.5 shrink-0"><Composer /></div>
    </div>
  );
}

const MORE_FEATURES = [
  { key: 'routines', label: 'Routines', sub: 'Put agents on a schedule — they run 24/7.', icon: dClock, frame: TEAL },
  { key: 'tasks', label: 'Tasks', sub: 'Drop a card on the board. An agent picks it up.', icon: dCols, frame: '#F59E0B' },
  { key: 'workflows', label: 'Workflows', sub: 'Multi-step pipelines: agent → you → agent → agent.', icon: dWorkflow, frame: '#7c3aed' },
  { key: 'skills', label: 'Skill center', sub: 'Browse 100+ skills. Install in one click.', icon: dZap, frame: BLUE },
];
const MORE_START = 800;
const MORE_EACH = 5000;
const ZOOM_IN_AT = 450;
const ZOOM_OUT_AT = 4300;
const ZOOM = 1.45;

function MorePanel({ feature, ms }: { feature: typeof MORE_FEATURES[number]; ms: number }) {
  return (
    <BrowserWindow url="openagents.org/acme-team" width={700} height={470} frame={feature.frame}>
      <div className="flex h-full">
        <NavRail onlineCount={5} expanded={false} height={470 - 34} />
        <div className="min-w-0 flex-1">
          {feature.key === 'skills' && <SkillsPanel ms={ms} />}
          {feature.key === 'routines' && <RoutinesPanel ms={ms} />}
          {feature.key === 'tasks' && <TasksPanel ms={ms} />}
          {feature.key === 'workflows' && <WorkflowsPanel ms={ms} />}
        </div>
      </div>
    </BrowserWindow>
  );
}

function Scene6_More({ localMs }: { localMs: number }) {
  const idx = clamp(Math.floor((localMs - MORE_START) / MORE_EACH), 0, MORE_FEATURES.length - 1);
  const panelMs = Math.max(0, localMs - (MORE_START + idx * MORE_EACH));
  const feature = MORE_FEATURES[idx];
  const started = localMs >= MORE_START;
  const zoomed = started && panelMs >= ZOOM_IN_AT && panelMs < ZOOM_OUT_AT;

  // measure where the panel sits so it can glide to the exact stage centre
  const rootRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const r = rootRef.current?.getBoundingClientRect();
    const w = winRef.current?.getBoundingClientRect();
    if (!r || !w || r.width === 0) return;
    const k = r.width / STAGE_W;
    setOffset({
      x: (r.left + r.width / 2 - (w.left + w.width / 2)) / k,
      y: (r.top + r.height / 2 - (w.top + w.height / 2)) / k,
    });
  }, []);
  const glide = zoomed && offset
    ? `translate(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px) scale(${ZOOM})`
    : 'translate(0px, 0px) scale(1)';

  return (
    <div ref={rootRef} className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      {/* caption for the zoomed panel */}
      <div className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2.5 rounded-full bg-white pl-2 pr-4 py-1.5"
        style={{ border: '2px solid #000', boxShadow: '4px 4px 0 0 #000',
          opacity: zoomed ? 1 : 0, transform: `translateX(-50%) translateY(${zoomed ? 0 : 12}px)`,
          transition: zoomed ? `opacity 0.4s ease 0.45s, transform 0.5s ${EASE} 0.45s` : 'opacity 0.25s ease, transform 0.25s ease',
          pointerEvents: 'none' }}>
        <span className="flex size-7 items-center justify-center rounded-full text-white" style={{ background: feature.frame }}>
          <Ic d={feature.icon} size={14} />
        </span>
        <span className="text-[14px] font-extrabold tracking-tight" style={{ color: INK }}>{feature.label}</span>
        <span className="text-[12px] font-medium" style={{ color: '#525252' }}>{feature.sub}</span>
      </div>
      <div className="h-full flex items-center justify-center gap-12 px-16">
        {/* checklist */}
        <div className="w-[330px] shrink-0"
          style={{ opacity: zoomed ? 0.12 : 1, filter: zoomed ? 'blur(3px)' : 'none', transition: 'opacity 0.6s ease, filter 0.6s ease' }}>
          <Stamp show={localMs >= 100}>
            <KickerPill>And that&apos;s one thread</KickerPill>
          </Stamp>
          <WordReveal show={localMs >= 250} text="A lot more inside." stagger={70}
            className="mt-4 text-[44px] font-black tracking-tight leading-[1.05]" style={{ color: INK }} />
          <div className="mt-6 space-y-1.5">
            {MORE_FEATURES.map((f, i) => {
              const active = localMs >= MORE_START && i === idx;
              const seen = localMs >= MORE_START + i * MORE_EACH;
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-xl px-3.5 py-2 transition-all duration-300"
                  style={active
                    ? { background: '#fff', border: '2px solid #000', boxShadow: '4px 4px 0 0 #000', transform: 'translateX(6px)' }
                    : { border: '2px solid transparent', opacity: seen ? 0.55 : 0.3 }}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: f.frame === NAVY ? NAVY : f.frame }}>
                    <Ic d={f.icon} size={15} />
                  </span>
                  <div>
                    <div className="text-[15px] font-extrabold tracking-tight" style={{ color: INK }}>{f.label}</div>
                    {active && <div className="text-[11px] font-medium" style={{ color: '#525252' }}>{f.sub}</div>}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-3 px-3.5 py-1.5" style={{ opacity: 0.55 }}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: '#F59E0B' }}>
                <Ic d={dGlobe} size={15} />
              </span>
              <div className="text-[15px] font-extrabold tracking-tight" style={{ color: INK }}>
                Shared browser <span className="text-[11px] font-semibold" style={{ color: '#525252' }}>— you just saw it</span>
              </div>
            </div>
          </div>
        </div>
        {/* swapping product panel — glides to the centre and scales up for each feature */}
        <div>
          <div ref={winRef} className="relative" style={{ transform: glide, transition: `transform 0.75s ${EASE}`, zIndex: zoomed ? 30 : 1, willChange: 'transform' }}>
            <div key={feature.key} style={{ animation: `panel-swap 0.55s ${EASE} backwards` }}>
              <MorePanel feature={feature} ms={panelMs} />
            </div>
          </div>
          {/* progress dots — where you are in the tour */}
          <div className="mt-4 flex items-center justify-center gap-2" style={{ opacity: zoomed ? 0 : 1, transition: 'opacity 0.4s ease' }}>
            {MORE_FEATURES.map((f, i) => (
              <span key={f.key} className="rounded-full transition-all duration-300" style={{
                width: i === idx ? 22 : 7, height: 7,
                background: i === idx ? INK : i < idx ? '#a3a3a3' : '#d4d4d8',
              }} />
            ))}
            <span className="ml-2 font-mono text-[11px]" style={{ color: MUTED }}>{idx + 1}/{MORE_FEATURES.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scene 7: 03 Humans + agents — dedicated pillar (45.5–52s) ──

function Scene7_Team({ localMs }: { localMs: number }) {
  return (
    <div className="h-full relative" style={{ background: HERO_WASH }}>
      <div className="h-full flex items-center justify-center gap-14 px-16">
        <div className="w-[360px] shrink-0">
          <Stamp show={localMs >= 100}>
            <KickerPill bg={BLUE} color="#fff">03 · Humans + agents</KickerPill>
          </Stamp>
          <WordReveal show={localMs >= 300} text="You're on the" stagger={80}
            className="mt-5 text-[54px] font-black tracking-tight leading-[1.05]" style={{ color: INK }} />
          <div className="text-[54px] font-black tracking-tight leading-[1.05]" style={{ color: INK }}>
            <WordReveal show={localMs >= 600} text="team," stagger={80} className="inline-block" />{' '}
            <WordReveal show={localMs >= 800} text="too." stagger={80} className="inline-block" style={{ color: BLUE }} />
          </div>
          <Stamp show={localMs >= 1300}>
            <div className="mt-5 text-[16px] font-medium leading-relaxed" style={{ color: '#525252' }}>
              Invite your team by email.<br />
              People and agents share the same threads —<br />
              you ask, they dig in, and hand back.
            </div>
          </Stamp>
          <Stamp show={localMs >= 2600}>
            <div className="mt-5 flex items-center gap-2.5">
              <div className="flex -space-x-2">
                <div className="rounded-full" style={{ border: '2.5px solid #fff' }}><PhotoAvatar src={HUMANS.you.src} size={30} /></div>
                <div className="rounded-full" style={{ border: '2.5px solid #fff' }}><PhotoAvatar src={HUMANS.maya.src} size={30} /></div>
                <div className="rounded-full" style={{ border: '2.5px solid #fff' }}><BeamAvatar name="posthog-analyst" size={30} /></div>
                <div className="rounded-full" style={{ border: '2.5px solid #fff' }}><BeamAvatar name="claude-dev" size={30} /></div>
                <div className="rounded-full" style={{ border: '2.5px solid #fff' }}><BeamAvatar name="pi-agent" size={30} /></div>
              </div>
              <span className="text-[13px] font-semibold" style={{ color: INK }}>One team, one chat.</span>
            </div>
          </Stamp>
        </div>
        <div style={{ visibility: localMs >= 200 ? undefined : 'hidden', animation: localMs >= 200 ? `card-up 0.55s ${EASE} backwards` : undefined }}>
          <BrowserWindow url="openagents.org/acme-team" width={640} height={500} frame={BLUE}>
            <div className="relative flex h-full">
              <NavRail onlineCount={5} expanded={false} height={500 - 34} />
              <div className="min-w-0 flex-1">
                <TeamPanel ms={localMs} />
              </div>
              {localMs >= 200 && localMs < 2800 && <InviteModal ms={localMs} />}
            </div>
          </BrowserWindow>
        </div>
      </div>
    </div>
  );
}

// ── Scene 8: 04 Anywhere (50–54s) ──

const PHONE_W = 320;
const PHONE_H = 640;

function PhoneRow({ avatar, name, tag, tagKind, time, children, step, at, ms }: {
  avatar: React.ReactNode; name: string; tag?: string; tagKind?: 'human' | 'leader'; time: string;
  children: React.ReactNode; step?: { icon: React.ReactNode; tool: string; arg: string }; at: number; ms: number;
}) {
  const on = ms >= at;
  return (
    <div style={{ visibility: on ? undefined : 'hidden', animation: on ? `msg-in 0.4s ${EASE} backwards` : undefined }}>
      <div className="flex items-start gap-2 py-1.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="text-[11px] font-semibold" style={{ color: TXT }}>{name}</span>
            {tag && (
              <span className="rounded px-1 py-px text-[8px] font-semibold"
                style={tagKind === 'leader' ? { background: AMBER_BG, color: AMBER_TX } : { background: '#f4f4f5', color: MUTED }}>{tag}</span>
            )}
            <span className="text-[9px]" style={{ color: '#a1a1aa' }}>{time}</span>
          </div>
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: TXT }}>{children}</div>
          {step && (
            <div className="mt-1 flex items-center gap-1 pl-2 text-[9.5px]" style={{ borderLeft: '2px solid #e4e4e7', color: MUTED }}>
              <span style={{ color: 'rgba(9,9,11,0.75)' }}>{step.icon}</span>
              <span className="font-mono font-medium" style={{ color: 'rgba(9,9,11,0.7)' }}>{step.tool}</span>
              <span style={{ color: 'rgba(113,113,122,0.4)' }}>›</span>
              <span className="truncate">{step.arg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Scene6_Anywhere({ localMs }: { localMs: number }) {
  return (
    <div className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      <div className="h-full flex items-center justify-center gap-20">
        <div>
          <Stamp show={localMs >= 100}>
            <KickerPill bg={TEAL} color="#fff">04 · Anywhere</KickerPill>
          </Stamp>
          <WordReveal show={localMs >= 300} text="Step away." stagger={90}
            className="mt-5 text-[62px] font-black tracking-tight leading-[1.05]" style={{ color: INK }} />
          <div className="text-[62px] font-black tracking-tight leading-[1.05]" style={{ color: INK }}>
            <WordReveal show={localMs >= 650} text="They keep" stagger={90} className="inline-block" />{' '}
            <WordReveal show={localMs >= 850} text="working." stagger={90} className="inline-block" style={{ color: BLUE }} />
          </div>
          <Stamp show={localMs >= 1400}>
            <div className="mt-5 text-[17px] font-medium" style={{ color: '#525252' }}>
              Agents keep going — you approve from your pocket.
            </div>
          </Stamp>
        </div>
        <div style={{ visibility: localMs >= 450 ? undefined : 'hidden', animation: localMs >= 450 ? `phone-in 0.7s ${EASE} backwards` : undefined }}>
          <div className="relative overflow-hidden rounded-[40px] bg-white"
            style={{ width: PHONE_W, height: PHONE_H, border: '3.5px solid #000', boxShadow: '12px 12px 0 0 #000', animation: 'float-soft 3.6s ease-in-out infinite' }}>
            {/* status bar */}
            <div className="flex items-center justify-between px-6 pt-3 text-[12px] font-semibold" style={{ color: TXT }}>
              <span>18:45</span>
              <span className="h-5 w-20 rounded-full" style={{ background: '#0a0a0a' }} />
              <span>5G</span>
            </div>
            {/* workspace header */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <img src="/images/oa-logo-black.png" alt="" className="size-6" />
              <span className="text-[14px] font-semibold" style={{ color: TXT }}>acme-team</span>
              <span className="ml-auto text-[10px]" style={{ color: GREEN }}>● 5/5 online</span>
            </div>
            {/* thread header */}
            <div className="flex items-center gap-1.5 px-4 py-2" style={{ background: '#fafafa', borderBottom: `1px solid ${BORDER}` }}>
              <Ic d={dUsers} size={12} style={{ color: TXT }} />
              <span className="text-[11.5px] font-semibold" style={{ color: TXT }}>posthog-data-analysis</span>
              <div className="ml-auto flex -space-x-1">
                <div className="rounded-full" style={{ border: '1.5px solid #fff' }}><PhotoAvatar src={HUMANS.you.src} size={14} /></div>
                <div className="rounded-full" style={{ border: '1.5px solid #fff' }}><PhotoAvatar src={HUMANS.maya.src} size={14} /></div>
                <div className="rounded-full" style={{ border: '1.5px solid #fff' }}><BeamAvatar name="posthog-analyst" size={14} /></div>
                <div className="rounded-full" style={{ border: '1.5px solid #fff' }}><BeamAvatar name="claude-dev" size={14} /></div>
                <div className="rounded-full" style={{ border: '1.5px solid #fff' }}><BeamAvatar name="pi-agent" size={14} /></div>
              </div>
              <span className="text-[9px] font-medium" style={{ color: GREEN }}>2 · 3</span>
            </div>
            {/* thread — picks up where 03 left off: two hours later, agents report back */}
            <div className="px-4 pt-1">
              <div className="flex items-center gap-2 py-1 text-[9px]" style={{ color: '#a1a1aa' }}>
                <span className="h-px flex-1" style={{ background: BORDER }} />
                <span>2 hours later</span>
                <span className="h-px flex-1" style={{ background: BORDER }} />
              </div>
              <PhoneRow ms={localMs} at={650} avatar={<BeamAvatar name="pi-agent" size={24} />} name="pi-agent" time="18:40"
                step={{ icon: <Ic d={dClock} size={10} />, tool: 'Routine', arg: 'daily data-quality check · 12/12 events ✓' }}>
                Check ran — all events firing, mobile Safari back to baseline.
              </PhoneRow>
              <PhoneRow ms={localMs} at={1000} avatar={<BeamAvatar name="posthog-analyst" size={24} />} name="posthog-analyst" tag="leader" tagKind="leader" time="18:41"
                step={{ icon: <Ic d={dFile} size={10} />, tool: 'File', arg: 'activation-weekly.pdf' }}>
                Activation back to 41% (+9 pts since the fix). Weekly report drafted.
              </PhoneRow>
              <PhoneRow ms={localMs} at={1350} avatar={<BeamAvatar name="claude-dev" size={24} />} name="claude-dev" time="18:42">
                Added an e2e test for onboarding tracking. <Mention>@You</Mention> approve the prod deploy?
                <div className="mt-1.5 flex gap-1.5">
                  <span className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-all duration-300"
                    style={localMs >= 2000 ? { background: GREEN, color: '#fff' } : { border: '1.5px solid #000', color: TXT, background: '#fff' }}>
                    {localMs >= 2000 && <Ic d={dCheck} size={10} sw={3} />}{localMs >= 2000 ? 'Approved' : 'Approve'}
                  </span>
                  <span className="rounded-md px-2 py-1 text-[10px] font-semibold" style={{ background: '#f4f4f5', color: MUTED }}>Request changes</span>
                </div>
              </PhoneRow>
              <PhoneRow ms={localMs} at={2300} avatar={<PhotoAvatar src={HUMANS.you.src} size={24} />} name="You" tag="PM" tagKind="human" time="18:45">
                Approved — ship it.
              </PhoneRow>
              <PhoneRow ms={localMs} at={2650} avatar={<BeamAvatar name="claude-dev" size={24} />} name="claude-dev" time="18:45"
                step={{ icon: <Ic d={dTerminal} size={10} />, tool: 'Bash', arg: 'git push prod main' }}>
                {localMs >= 3300 ? <>Live on prod ✓ — tests green. Dashboard is tracking again.</> : <>Deploying to prod…</>}
              </PhoneRow>
            </div>
            <Stamp show={localMs >= 500}>
              <div className="absolute bottom-5 left-4 right-4">
                <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-[12px]" style={{ border: `1px solid ${INPUTB}`, color: '#a1a1aa' }}>
                  <Ic d={dPlus} size={14} />
                  <span className="flex-1">Reply to your agents…</span>
                  <span className="flex size-6 items-center justify-center rounded-full" style={{ background: '#f4f4f5' }}><Ic d={dArrowUp} size={12} sw={2.2} /></span>
                </div>
              </div>
            </Stamp>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scene 7: Outro (38–43s) ──

function Scene7_Outro({ localMs }: { localMs: number }) {
  return (
    <div className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      <div className="h-full flex flex-col items-center justify-center">
        <Stamp show={localMs >= 150}>
          <img src="/images/oa-logo-black.png" alt="OpenAgents" className="w-16 h-16 mb-6"
            style={{ animation: localMs >= 150 ? `logo-in 0.8s ${EASE} backwards` : undefined }} />
        </Stamp>
        <Stamp show={localMs >= 320}>
          <div className="text-center leading-none">
            <Wordmark size={64} />
            <span className="font-black tracking-tighter leading-none" style={{ fontSize: 64, color: INK }}> Workspace</span>
          </div>
        </Stamp>
        <div className="mt-4 text-[30px] font-extrabold tracking-tight" style={{ color: INK }}>
          <WordReveal show={localMs >= 700} text="Your agents," stagger={80} className="inline-block" />{' '}
          <WordReveal show={localMs >= 950} text="finally a team." stagger={80} className="inline-block" style={{ color: BLUE }} />
        </div>
        {/* in-product CTA: the viewer is already in their workspace, so the
            outro sells the very next click — connect an agent — not the site */}
        <Stamp show={localMs >= 1500}>
          <div className="mt-7 text-[26px] font-extrabold tracking-tight" style={{ color: '#525252' }}>
            Connect your first agent 👇
          </div>
        </Stamp>
        <Stamp show={localMs >= 2000}>
          <div className="mt-7 rounded-2xl bg-white px-9 py-4"
            style={{ border: '3px solid #000', boxShadow: `7px 7px 0 0 ${BLUE}` }}>
            <span className="font-black tracking-tight" style={{ fontSize: 40, lineHeight: 1.05, color: INK }}>
              It takes <span style={{ color: BLUE }}>~2 minutes</span> · free
            </span>
          </div>
        </Stamp>
      </div>
      {/* mascot peeks in, like on the website */}
      <img src="/images/oa-mascot.png" alt="" className="absolute -right-4 -bottom-6 w-44 drop-shadow-xl"
        style={{
          transition: `transform 0.7s ${EASE}`,
          transform: localMs >= 1200 ? 'translateY(0) rotate(-6deg)' : 'translateY(220px) rotate(-6deg)',
        }} />
    </div>
  );
}

// ── Scrubber ──

const SCENE_BOUNDARIES = [
  { id: 1, startMs: 0, label: 'Hook' },
  { id: 2, startMs: 2_500, label: 'Hub' },
  { id: 3, startMs: 8_000, label: '02' },
  { id: 4, startMs: 10_000, label: 'Demo' },
  { id: 5, startMs: 19_000, label: 'Team' },
  { id: 6, startMs: 24_000, label: 'CTA' },
];

function ControlsBar({ elapsedMs, paused, onSeek, onTogglePause }: {
  elapsedMs: number; paused: boolean; onSeek: (ms: number) => void; onTogglePause: () => void;
}) {
  const pct = clamp((elapsedMs / TOTAL_DURATION_MS) * 100, 0, 100);
  const scene = getScene(elapsedMs);
  const seconds = Math.floor(elapsedMs / 1000);
  const totalSeconds = Math.floor(TOTAL_DURATION_MS / 1000);
  const currentLabel = SCENE_BOUNDARIES.find(s => s.id === scene.id)?.label || '';

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * TOTAL_DURATION_MS);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 overflow-x-auto">
        <button onClick={onTogglePause}
          className="size-7 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white text-xs transition-colors mr-2 shrink-0">
          {paused ? '▶' : '⏸'}
        </button>
        {SCENE_BOUNDARIES.map((s) => (
          <button key={s.id} onClick={() => onSeek(s.startMs)}
            className={`px-2.5 py-1 rounded text-xs transition-all shrink-0 ${
              scene.id === s.id ? 'text-white font-medium' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
            style={scene.id === s.id ? { background: BLUE } : undefined}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="h-10 bg-zinc-900/95 backdrop-blur flex items-center px-4 gap-3">
        <span className="text-xs font-mono text-zinc-400 w-20 shrink-0">{seconds}s / {totalSeconds}s</span>
        <div className="flex-1 h-2 bg-zinc-800 rounded-full cursor-pointer relative group" onClick={handleBarClick}>
          {SCENE_BOUNDARIES.map((s) => (
            <div key={s.id} className="absolute top-0 bottom-0 w-px bg-zinc-700"
              style={{ left: `${(s.startMs / TOTAL_DURATION_MS) * 100}%` }} />
          ))}
          <div className="h-full rounded-full transition-all duration-100 relative" style={{ width: `${pct}%`, background: BLUE }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 size-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <span className="text-xs text-zinc-500 w-24 text-right shrink-0 hidden sm:block">{currentLabel}</span>
      </div>
    </div>
  );
}

// ── Main ──

// ── Slide deck ──
// Three pillar slides, one per numbered section. Each plays its animation
// once and freezes on its closing frame; the user pages with prev/next.
// `scale` fast-forwards the source choreography; `freeze` pins the clamp a
// hair before any `ms < to` caption bound so closing captions stay visible.

type SlideSegment = { dur: number; scale: number; freeze?: number; render: (ms: number) => React.ReactNode };

// Pillar slide layout: the big title stays on screen the whole time, with
// the product animation playing in a framed panel beneath it and freezing
// on its closing illustration. One visual per slide — no card-then-cut.
const PILLAR_SCENE_SCALE = 0.7;
const PILLAR_SCENE_DELAY = 500; // title reveals first, then the panel animates

function PillarFrame({ ms, kicker, kickerBg, title, scene }: {
  ms: number; kicker: string; kickerBg: string; title: string; scene: React.ReactNode;
}) {
  return (
    <div className="h-full relative overflow-hidden" style={{ background: HERO_WASH }}>
      <div className="flex flex-col items-center pt-12 text-center">
        <Stamp show={ms >= 100}>
          <KickerPill bg={kickerBg} color="#fff">{kicker}</KickerPill>
        </Stamp>
        <div className="mt-4">
          <WordReveal show={ms >= 300} text={title} stagger={90}
            className="text-[54px] font-black tracking-tight leading-none" style={{ color: INK }} />
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-2xl"
        style={{
          top: 200, width: STAGE_W * PILLAR_SCENE_SCALE, height: STAGE_H * PILLAR_SCENE_SCALE,
          border: '1px solid #e4e4e7', boxShadow: '0 18px 50px rgba(11,17,33,0.14)',
          visibility: ms >= PILLAR_SCENE_DELAY ? undefined : 'hidden',
          animation: ms >= PILLAR_SCENE_DELAY ? `card-up 0.5s ${EASE} backwards` : undefined,
        }}>
        <div style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${PILLAR_SCENE_SCALE})`, transformOrigin: 'top left' }}>
          {scene}
        </div>
      </div>
    </div>
  );
}

// Source-time for a scene inside PillarFrame: starts after the title beat,
// fast-forwarded by `scale`, clamped to `freeze` so the closing frame holds.
function pillarSceneMs(ms: number, scale: number, freeze: number) {
  return Math.min(Math.max(0, ms - PILLAR_SCENE_DELAY) * scale, freeze);
}

const SLIDES: { key: string; segments: SlideSegment[] }[] = [
  {
    // A first-time visitor doesn't know what the product is — open on the
    // name itself: logo, "OpenAgents Workspace", tagline. Holds until paged.
    key: 'title',
    segments: [{ dur: 3_000, scale: 1, render: (ms) => <Scene2_Title localMs={ms} /> }],
  },
  {
    key: 'hub',
    segments: [{
      dur: 6_500, scale: 1,
      render: (ms) => (
        <PillarFrame ms={ms} kicker="01" kickerBg={BLUE} title="One Hub"
          scene={<Scene3_Hub localMs={pillarSceneMs(ms, 1.1, 6_400)} />} />
      ),
    }],
  },
  {
    key: 'collab',
    segments: [{
      dur: 9_500, scale: 1,
      render: (ms) => (
        // freeze just short of SHOWCASE_AT (20s): ends on "Built · drawn ·
        // tested", the full-screen finished-game reveal never plays
        <PillarFrame ms={ms} kicker="02" kickerBg={TEAL} title="Multi-Agent Collaboration"
          scene={<Scene5_Demo localMs={pillarSceneMs(ms, 2.2, 19_700)} />} />
      ),
    }],
  },
  {
    key: 'team',
    segments: [{
      dur: 5_500, scale: 1,
      render: (ms) => (
        <PillarFrame ms={ms} kicker="03" kickerBg={BLUE} title="Humans + Agents"
          scene={<Scene7_Team localMs={pillarSceneMs(ms, 2, 9_880)} />} />
      ),
    }],
  },
];

const dChevronL = <path d="m15 18-6-6 6-6" />;
const dChevronR = <path d="m9 18 6-6-6-6" />;

export default function WelcomeFilm({
  embedded = false,
  onEnded,
  onSkip,
  skipLabel = 'Skip intro',
  ctaLabel = 'Get started',
  initialSlide = 0,
}: {
  embedded?: boolean;
  onEnded?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  ctaLabel?: string;
  /** Start on a later slide (deep-link/testing). */
  initialSlide?: number;
} = {}) {
  const [idx, setIdx] = useState(() => clamp(initialSlide, 0, SLIDES.length - 1));
  const [slideMs, setSlideMs] = useState(0);
  const [stageScale, setStageScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const fit = () => {
      if (embedded && el) {
        const r = el.getBoundingClientRect();
        setStageScale(Math.min(r.width / STAGE_W, r.height / STAGE_H));
      } else {
        setStageScale(Math.min(window.innerWidth / STAGE_W, (window.innerHeight - 72) / STAGE_H));
      }
    };
    fit();
    if (embedded && el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [embedded]);

  // (Re)play the current slide's animation, then stop — the last frame holds.
  useEffect(() => {
    const total = SLIDES[idx].segments.reduce((a, s) => a + s.dur, 0);
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const ms = now - t0;
      setSlideMs(Math.min(ms, total));
      if (ms < total) raf = requestAnimationFrame(tick);
    };
    setSlideMs(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  const last = idx === SLIDES.length - 1;
  const goNext = useCallback(() => {
    if (last) onEnded?.();
    else setIdx((i) => i + 1);
  }, [last, onEnded]);
  const goPrev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'ArrowRight' || e.code === 'Enter') { e.preventDefault(); goNext(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  // Resolve the active segment and its (possibly frozen) source-time.
  const slide = SLIDES[idx];
  let segIdx = slide.segments.length - 1;
  let seg = slide.segments[segIdx];
  let local = seg.dur;
  let acc = 0;
  for (let i = 0; i < slide.segments.length; i++) {
    const s = slide.segments[i];
    if (slideMs < acc + s.dur) { seg = s; segIdx = i; local = slideMs - acc; break; }
    acc += s.dur;
  }
  const sourceMs = Math.min(local * seg.scale, seg.freeze ?? seg.dur * seg.scale - 120);

  return (
    <div
      ref={containerRef}
      className={embedded ? 'relative h-full w-full overflow-hidden' : 'h-screen w-screen overflow-hidden relative'}
      style={{ background: '#fff' }}
    >
      <div className="absolute left-1/2" style={{
        width: STAGE_W, height: STAGE_H,
        top: embedded
          ? `calc((100% - ${STAGE_H * stageScale}px) / 2)`
          : `calc((100vh - 72px - ${STAGE_H * stageScale}px) / 2)`,
        transform: `translateX(-50%) scale(${stageScale})`,
        transformOrigin: 'top center',
      }}>
        <div className="h-full w-full relative overflow-hidden" style={{ background: '#fff', fontFamily: FONT, letterSpacing: '-0.01em' }}>
          <div key={`${idx}-${segIdx}`} className="h-full w-full" style={{ animation: 'flash-in 0.35s ease-out both' }}>
            {seg.render(sourceMs)}
          </div>
          <div className="absolute inset-0 z-[44] pointer-events-none" style={{
            backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: 'multiply',
          }} />
        </div>
      </div>

      {/* Control bar: skip · dots · prev/next — sized for touch */}
      <div className="absolute inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 px-4 pb-4 sm:px-6 sm:pb-5">
        {onSkip ? (
          <button
            onClick={onSkip}
            className="rounded-full px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
          >
            {skipLabel}
          </button>
        ) : <span />}

        <div className="flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setIdx(i)}
              aria-label={`Slide ${i + 1}`}
              className="flex size-8 items-center justify-center"
            >
              <span className="rounded-full transition-all duration-300" style={{
                width: i === idx ? 22 : 8, height: 8,
                background: i === idx ? BLUE : '#d4d4d8',
              }} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={idx === 0}
            aria-label="Previous"
            className="flex size-10 items-center justify-center rounded-full border border-zinc-300 bg-white/80 text-zinc-600 shadow-sm backdrop-blur transition-colors hover:text-zinc-900 disabled:opacity-35 disabled:hover:text-zinc-600"
          >
            <Ic d={dChevronL} size={18} />
          </button>
          {last ? (
            <button
              onClick={goNext}
              className="flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: BLUE }}
            >
              {ctaLabel}
              <Ic d={dChevronR} size={16} />
            </button>
          ) : (
            <button
              onClick={goNext}
              aria-label="Next"
              className="flex size-10 items-center justify-center rounded-full border border-zinc-300 bg-white/80 text-zinc-600 shadow-sm backdrop-blur transition-colors hover:text-zinc-900"
            >
              <Ic d={dChevronR} size={18} />
            </button>
          )}
        </div>
      </div>

      {/* plain <style>: global keyframes, no styled-jsx dependency */}
      <style>{`
        @keyframes stamp {
          0% { opacity: 0; transform: scale(1.12); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes rise {
          0% { transform: translateY(115%); }
          100% { transform: translateY(0); }
        }
        @keyframes msg-in {
          0% { opacity: 0; transform: translateY(10px) scale(0.99); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes card-up {
          0% { opacity: 0; transform: translateY(36px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes panel-swap {
          0% { opacity: 0; transform: translateY(18px) scale(0.985); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes phone-in {
          0% { opacity: 0; transform: translateX(48px) rotate(5deg); }
          100% { opacity: 1; transform: translateX(0) rotate(0deg); }
        }
        @keyframes notif-in {
          0% { opacity: 0; transform: translateY(-18px) scale(0.95); }
          60% { transform: translateY(3px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes drop-in {
          0% { opacity: 0; transform: translateY(-26px) scale(1.15); }
          70% { transform: translateY(2px) scale(0.99); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes logo-in {
          0% { opacity: 0; transform: rotate(-100deg) scale(0.5); }
          100% { opacity: 1; transform: rotate(0deg) scale(1); }
        }
        @keyframes jitter {
          0%, 100% { margin-left: 0px; }
          25% { margin-left: 3px; }
          75% { margin-left: -3px; }
        }
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-4px, 2px); }
          40% { transform: translate(4px, -2px); }
          60% { transform: translate(-3px, -2px); }
          80% { transform: translate(3px, 2px); }
        }
        @keyframes hero-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes tree-sway {
          0%, 100% { transform: rotate(-1.5deg); }
          50% { transform: rotate(1.5deg); }
        }
        @keyframes float-soft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes cloud-drift {
          0% { left: -200px; }
          100% { left: 110%; }
        }
        @keyframes reveal-in {
          0% { opacity: 0; transform: scale(0.9) translateY(24px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes dot-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes workbar {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes flash {
          0% { opacity: 0.85; }
          100% { opacity: 0; }
        }
        @keyframes dmg-pop {
          0% { opacity: 0; transform: translateY(6px) scale(0.6); }
          25% { opacity: 1; transform: translateY(-6px) scale(1.25); }
          100% { opacity: 0; transform: translateY(-26px) scale(1); }
        }
        @keyframes burst {
          0% { opacity: 1; transform: translate(0, 0); }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
        }
        @keyframes ripple {
          0%, 100% { opacity: 0.15; transform: translateX(0); }
          50% { opacity: 0.5; transform: translateX(4px); }
        }
        @keyframes flash-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes confetti-fall {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          85% { opacity: 1; }
          100% { opacity: 0; transform: translateY(280px) rotate(520deg); }
        }
      `}</style>
    </div>
  );
}
