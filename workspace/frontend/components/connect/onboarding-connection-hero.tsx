'use client';

import { ArrowLeft, ArrowRight, PlusSquare } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** A slim illustrated banner above the setup form. */
export function OnboardingConnectionHero({ workspaceName, onBack, onSetup }: { workspaceName: string; onBack?: () => void; onSetup?: () => void }) {
  const t = useT();
  const openSetup = () => {
    onSetup?.();
    const scroll = () => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('onboarding-device-setup')?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
    };
    // Switching from Cloud Agents mounts the local setup before the next frame.
    if (document.getElementById('onboarding-device-setup')) scroll();
    else window.requestAnimationFrame(scroll);
  };
  return (
    <section className="oa-connection-scene relative isolate overflow-hidden border-b border-[#dce6f6] bg-[#f3f7ff] px-6 pb-7 pt-10 text-[#262626] sm:px-10" aria-labelledby="onboarding-connection-title">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_55%,#2f6bff12,transparent_55%),radial-gradient(ellipse_at_15%_15%,#14b8a60d,transparent_50%)]" />
      {onBack && <button type="button" onClick={onBack} className="absolute left-5 top-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-blue-100/60 hover:text-slate-900 sm:left-8 sm:top-2"><ArrowLeft className="size-3.5" />{t('connect.nodeBack')}</button>}

      <div className="relative z-10 w-full sm:w-[56%]">
        <p className="mb-2 inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#2f6bff]"><PlusSquare className="size-3.5" />{t('nav.connectAgent')}</p>
        <h1 id="onboarding-connection-title" className="oa-scene-title max-w-lg text-2xl font-medium leading-[1.15] tracking-[-0.035em] text-balance sm:text-[28px]">{t('onboarding.connectionTitle')}</h1>
        <p className="oa-scene-intro mt-3 max-w-md text-xs leading-5 text-slate-600">{t('onboarding.visualIntro')}</p>
        <button type="button" onClick={openSetup} className="group mt-3 inline-flex items-center gap-2 text-xs font-medium text-[#2f6bff] transition hover:text-[#2455cc] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2f6bff]">
          {t('onboarding.visualSetupCta')}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
        </button>
      </div>

      <div className="pointer-events-none absolute -right-24 top-1/2 h-[240px] w-[420px] -translate-y-1/2 opacity-20 sm:right-4 sm:w-[43%] sm:opacity-100" aria-hidden="true">
        <svg viewBox="0 0 1000 510" fill="none" className="oa-scene-art block h-full w-full overflow-visible">
          <defs>
            <radialGradient id="oa-hub-glow"><stop stopColor="#2f6bff" stopOpacity=".25" /><stop offset="1" stopColor="#2f6bff" stopOpacity="0" /></radialGradient>
            <linearGradient id="oa-connection-line" x1="200" y1="260" x2="755" y2="260" gradientUnits="userSpaceOnUse"><stop stopColor="#93b4f5" stopOpacity=".12" /><stop offset=".65" stopColor="#2f6bff" stopOpacity=".7" /><stop offset="1" stopColor="#14b8a6" stopOpacity=".2" /></linearGradient>
            <linearGradient id="oa-screen" x1="120" y1="180" x2="420" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#e2ebfc" /><stop offset="1" stopColor="#f8fbff" /></linearGradient>
            <linearGradient id="oa-hub" x1="666" y1="165" x2="800" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#e4efff" /><stop offset="1" stopColor="#bfdbfe" /></linearGradient>
            <filter id="oa-device-shadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dy="20" stdDeviation="20" floodColor="#2f4770" floodOpacity=".12" /></filter>
            <filter id="oa-hub-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow stdDeviation="18" floodColor="#2f6bff" floodOpacity=".25" /></filter>
          </defs>

          {/* A quiet star field gives the illustration depth without a frame. */}
          {[[75,170],[320,80],[545,60],[910,150],[930,340],[580,445],[75,385],[450,300],[600,160],[860,420],[210,460],[520,235]].map(([x,y], i) => <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2 : 1} fill="#8da6ce" opacity=".25" />)}
          <circle cx="742" cy="246" r="220" fill="url(#oa-hub-glow)" />
          <ellipse cx="742" cy="246" rx="170" ry="130" stroke="#2f6bff" strokeOpacity=".09" transform="rotate(-25 742 246)" />
          <ellipse cx="742" cy="246" rx="208" ry="163" stroke="#2f6bff" strokeOpacity=".06" transform="rotate(-25 742 246)" />

          {/* Agent connections converge on the shared workspace. */}
          {['M175 127 C400 30 490 135 700 219','M413 114 C540 100 550 180 701 225','M366 400 C510 445 564 300 705 265','M309 276 C460 230 555 280 700 247'].map((d, i) => <g key={d}>
            <path d={d} stroke="url(#oa-connection-line)" strokeWidth={i === 3 ? 2 : 1} />
            <path d={d} stroke="#2f6bff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 120" className="oa-scene-flow" style={{ animationDelay: `${-i * 1.7}s` }} />
          </g>)}

          {/* An illustrated machine, rather than another UI card. */}
          <g transform="translate(96 184) rotate(-7 150 100)" filter="url(#oa-device-shadow)">
            <rect x="36" width="252" height="166" rx="13" fill="url(#oa-screen)" stroke="#526b91" strokeOpacity=".35" />
            <rect x="45" y="9" width="234" height="147" rx="6" fill="#ffffff" stroke="#6682ac" strokeOpacity=".1" />
            <circle cx="162" cy="5" r="1.5" fill="#526b91" opacity=".5" />
            <path d="M69 44 L82 54 L69 64 M92 65 H107" stroke="#2f6bff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M68 88 H181 M68 103 H226 M68 118 H146" stroke="#52698e" strokeOpacity=".24" strokeWidth="5" strokeLinecap="round" />
            <path d="M36 167 H288 L321 188 Q325 194 311 196 H12 Q0 194 6 188 Z" fill="#dae4f5" stroke="#526b91" strokeOpacity=".3" />
            <path d="M137 168 H186 L194 178 H129 Z" fill="#8298b8" fillOpacity=".3" />
            <path d="M16 191 H312" stroke="#49648b" strokeOpacity=".15" />
          </g>
          <text x="245" y="426" textAnchor="middle" fill="#475569" fontSize="13" fontFamily="inherit">{t('onboarding.diagramDevice')}</text>

          {/* Agent marks float freely through the scene. */}
          <g className="oa-scene-float">
            <circle cx="166" cy="122" r="36" fill="#ffffff" />
            <image href="/icons/agents/claude.svg" x="144" y="100" width="44" height="44" />
            <text x="166" y="181" textAnchor="middle" fill="#475569" fontSize="12" fontFamily="inherit">Claude Code</text>
          </g>
          <g className="oa-scene-float oa-scene-float-late">
            <circle cx="413" cy="114" r="29" fill="#ffffff" />
            <image href="/icons/agents/codex.svg" x="395" y="96" width="36" height="36" />
            <text x="413" y="164" textAnchor="middle" fill="#475569" fontSize="12" fontFamily="inherit">Codex</text>
          </g>
          <g className="oa-scene-float oa-scene-float-late">
            <circle cx="386" cy="391" r="25" fill="#c9d7ed" />
            <image href="/icons/agents/gemini.svg" x="370" y="375" width="32" height="32" />
            <text x="386" y="437" textAnchor="middle" fill="#475569" fontSize="12" fontFamily="inherit">Gemini</text>
          </g>

          {/* A luminous workspace hub anchors the connection. */}
          <circle cx="742" cy="246" r="94" stroke="#2f6bff" strokeOpacity=".12" strokeDasharray="2 8" />
          <circle cx="742" cy="246" r="72" fill="url(#oa-hub)" filter="url(#oa-hub-shadow)" />
          <circle cx="742" cy="246" r="60" stroke="white" strokeOpacity=".4" />
          <image href="/logo-color.png" x="708" y="212" width="68" height="68" />
          <circle cx="830" cy="197" r="5" fill="#14b8a6" />
          <circle cx="657" cy="284" r="3" fill="#14b8a6" opacity=".6" />
          <foreignObject x="612" y="350" width="260" height="64"><div className="text-center"><p className="truncate text-base font-medium text-slate-800" title={workspaceName}>{workspaceName}</p><p className="mt-1 text-[11px] text-slate-500">{t('onboarding.diagramWorkspace')}</p></div></foreignObject>
        </svg>
      </div>

      <style>{`
        .oa-scene-flow { animation: oa-scene-flow 12s linear infinite; }
        .oa-scene-float { animation: oa-scene-float 7s ease-in-out infinite; }
        .oa-scene-float-late { animation-delay: -3s; }
        @keyframes oa-scene-flow { to { stroke-dashoffset: -488; } }
        @keyframes oa-scene-float { 50% { transform: translateY(-7px); } }
        @media (prefers-reduced-motion: reduce) {
          .oa-scene-flow, .oa-scene-float { animation: none; }
        }
      `}</style>
    </section>
  );
}
