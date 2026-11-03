'use client';

import { ArrowDown, ArrowLeft, ArrowRight, PlusSquare } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** A compact opening illustration, followed directly by setup instructions. */
export function OnboardingConnectionHero({ workspaceName, onBack }: { workspaceName: string; onBack?: () => void }) {
  const t = useT();
  const openSetup = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('onboarding-device-setup')?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
  };
  return (
    <section className="oa-connection-scene relative isolate flex flex-col items-center justify-center overflow-hidden bg-[#071b1c] px-5 py-10 text-white sm:px-10 sm:py-12" aria-labelledby="onboarding-connection-title">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_55%,#145b514d,transparent_55%),radial-gradient(ellipse_at_15%_15%,#1b52584d,transparent_50%)]" />
      {onBack && <button type="button" onClick={onBack} className="absolute left-5 top-5 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/60 transition hover:bg-white/5 hover:text-white sm:left-8 sm:top-7"><ArrowLeft className="size-3.5" />{t('connect.nodeBack')}</button>}

      <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
        <p className="mb-5 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200/80"><PlusSquare className="size-3.5" />{t('nav.connectAgent')}</p>
        <h1 id="onboarding-connection-title" className="oa-scene-title text-[clamp(2rem,3.8vw,3rem)] font-medium leading-[1.08] tracking-[-0.045em] text-balance">{t('onboarding.connectionTitle')}</h1>
        <p className="oa-scene-intro mx-auto mt-5 max-w-xl text-sm leading-6 text-teal-50/60 sm:text-base sm:leading-7">{t('onboarding.visualIntro')}</p>
      </div>

      <div className="relative -my-2 w-full max-w-5xl sm:-my-5" aria-hidden="true">
        <svg viewBox="0 0 1000 510" fill="none" className="oa-scene-art block h-[clamp(180px,26svh,320px)] w-full overflow-visible">
          <defs>
            <radialGradient id="oa-hub-glow"><stop stopColor="#6cf5c0" stopOpacity=".25" /><stop offset="1" stopColor="#6cf5c0" stopOpacity="0" /></radialGradient>
            <linearGradient id="oa-connection-line" x1="200" y1="260" x2="755" y2="260" gradientUnits="userSpaceOnUse"><stop stopColor="#8ae2cf" stopOpacity=".12" /><stop offset=".65" stopColor="#98ffcf" stopOpacity=".7" /><stop offset="1" stopColor="#b8ffde" stopOpacity=".2" /></linearGradient>
            <linearGradient id="oa-screen" x1="120" y1="180" x2="420" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#17383c" /><stop offset="1" stopColor="#0a2226" /></linearGradient>
            <linearGradient id="oa-hub" x1="666" y1="165" x2="800" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#cdffe8" /><stop offset="1" stopColor="#5bd8ad" /></linearGradient>
            <filter id="oa-device-shadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dy="20" stdDeviation="20" floodColor="#000" floodOpacity=".3" /></filter>
            <filter id="oa-hub-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow stdDeviation="18" floodColor="#7cf4bd" floodOpacity=".25" /></filter>
          </defs>

          {/* A quiet star field gives the illustration depth without a frame. */}
          {[[75,170],[320,80],[545,60],[910,150],[930,340],[580,445],[75,385],[450,300],[600,160],[860,420],[210,460],[520,235]].map(([x,y], i) => <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2 : 1} fill="#b4e6d5" opacity=".25" />)}
          <circle cx="742" cy="246" r="220" fill="url(#oa-hub-glow)" />
          <ellipse cx="742" cy="246" rx="170" ry="130" stroke="#98e8c6" strokeOpacity=".09" transform="rotate(-25 742 246)" />
          <ellipse cx="742" cy="246" rx="208" ry="163" stroke="#98e8c6" strokeOpacity=".06" transform="rotate(-25 742 246)" />

          {/* Agent connections converge on the shared workspace. */}
          {['M175 127 C400 30 490 135 700 219','M413 114 C540 100 550 180 701 225','M366 400 C510 445 564 300 705 265','M309 276 C460 230 555 280 700 247'].map((d, i) => <g key={d}>
            <path d={d} stroke="url(#oa-connection-line)" strokeWidth={i === 3 ? 2 : 1} />
            <path d={d} stroke="#b3ffdf" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 120" className="oa-scene-flow" style={{ animationDelay: `${-i * 1.7}s` }} />
          </g>)}

          {/* An illustrated machine, rather than another UI card. */}
          <g transform="translate(96 184) rotate(-7 150 100)" filter="url(#oa-device-shadow)">
            <rect x="36" width="252" height="166" rx="13" fill="url(#oa-screen)" stroke="#b5e0d5" strokeOpacity=".35" />
            <rect x="45" y="9" width="234" height="147" rx="6" fill="#081f23" stroke="#88c7b9" strokeOpacity=".1" />
            <circle cx="162" cy="5" r="1.5" fill="#b3d8ce" opacity=".5" />
            <path d="M69 44 L82 54 L69 64 M92 65 H107" stroke="#8df0bd" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M68 88 H181 M68 103 H226 M68 118 H146" stroke="#80cbb5" strokeOpacity=".24" strokeWidth="5" strokeLinecap="round" />
            <path d="M36 167 H288 L321 188 Q325 194 311 196 H12 Q0 194 6 188 Z" fill="#1b383a" stroke="#a7d7c9" strokeOpacity=".3" />
            <path d="M137 168 H186 L194 178 H129 Z" fill="#577b76" fillOpacity=".3" />
            <path d="M16 191 H312" stroke="#c7eee2" strokeOpacity=".15" />
          </g>
          <text x="245" y="426" textAnchor="middle" fill="#c6e3da" fontSize="13" fontFamily="inherit">{t('onboarding.diagramDevice')}</text>

          {/* Agent marks float freely through the scene. */}
          <g className="oa-scene-float">
            <circle cx="166" cy="122" r="36" fill="#e8c4a6" />
            <image href="/icons/agents/claude.svg" x="144" y="100" width="44" height="44" />
            <text x="166" y="181" textAnchor="middle" fill="#d1e5dc" fontSize="12" fontFamily="inherit">Claude Code</text>
          </g>
          <g className="oa-scene-float oa-scene-float-late">
            <circle cx="413" cy="114" r="29" fill="#e4f0e9" />
            <image href="/icons/agents/codex.svg" x="395" y="96" width="36" height="36" />
            <text x="413" y="164" textAnchor="middle" fill="#d1e5dc" fontSize="12" fontFamily="inherit">Codex</text>
          </g>
          <g className="oa-scene-float oa-scene-float-late">
            <circle cx="386" cy="391" r="25" fill="#c9d7ed" />
            <image href="/icons/agents/gemini.svg" x="370" y="375" width="32" height="32" />
            <text x="386" y="437" textAnchor="middle" fill="#d1e5dc" fontSize="12" fontFamily="inherit">Gemini</text>
          </g>

          {/* A luminous workspace hub anchors the connection. */}
          <circle cx="742" cy="246" r="94" stroke="#abf8d2" strokeOpacity=".12" strokeDasharray="2 8" />
          <circle cx="742" cy="246" r="72" fill="url(#oa-hub)" filter="url(#oa-hub-shadow)" />
          <circle cx="742" cy="246" r="60" stroke="white" strokeOpacity=".4" />
          <image href="/logo-icon.png" x="708" y="212" width="68" height="68" />
          <circle cx="830" cy="197" r="5" fill="#8af1bd" />
          <circle cx="657" cy="284" r="3" fill="#8af1bd" opacity=".6" />
          <foreignObject x="612" y="350" width="260" height="64"><div className="text-center"><p className="truncate text-base font-medium text-white/90" title={workspaceName}>{workspaceName}</p><p className="mt-1 text-[11px] text-emerald-100/50">{t('onboarding.diagramWorkspace')}</p></div></foreignObject>
        </svg>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <button type="button" onClick={openSetup} className="group inline-flex items-center gap-3 rounded-full bg-[#b5f5d2] px-6 py-3.5 text-sm font-semibold text-[#10352b] shadow-[0_0_32px_#79e8b51a] transition hover:bg-[#ccffe3] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-200">
          {t('onboarding.visualSetupCta')}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
        </button>
        <p className="text-xs text-teal-50/40">{t('onboarding.visualSetupHint')}</p>
        <ArrowDown className="mt-1 size-4 text-emerald-100/30" aria-hidden="true" />
      </div>
      <style>{`
        .oa-scene-flow { animation: oa-scene-flow 12s linear infinite; }
        .oa-scene-float { animation: oa-scene-float 7s ease-in-out infinite; }
        .oa-scene-float-late { animation-delay: -3s; }
        @keyframes oa-scene-flow { to { stroke-dashoffset: -488; } }
        @keyframes oa-scene-float { 50% { transform: translateY(-7px); } }
        @media (max-height: 800px) and (min-width: 1024px) {
          .oa-connection-scene { padding-block: 24px; }
          .oa-scene-title { font-size: 36px; }
          .oa-scene-intro { margin-top: 12px; }
          .oa-scene-art { height: 28svh; }
        }
        @media (prefers-reduced-motion: reduce) {
          .oa-scene-flow, .oa-scene-float { animation: none; }
        }
      `}</style>
    </section>
  );
}
