'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Cloud, Laptop, X } from 'lucide-react';
import styles from './welcome-scroll.module.css';
import { CollaborationStory } from './collaboration-story';
import { ContextPreview } from './context-preview';
import { onboardingAgents } from './onboarding-agents';
import { OnboardingLanguageProvider, OnboardingLanguageSwitcher, useOnboardingLanguage } from './onboarding-language';
function AgentMark({ icon, name = '', size = 32 }: {
    icon: string;
    name?: string;
    size?: number;
}) {
    return <img src={`/icons/agents/${icon}.svg`} alt={name} width={size} height={size}/>;
}
function ChapterLabel({ number, children }: {
    number: string;
    children: React.ReactNode;
}) {
    return <p className={styles.chapterLabel}><span>{number}</span><i />{children}</p>;
}
function PathBetween() {
    return <div className={styles.pathBetween} aria-hidden="true"><svg viewBox="0 0 100 160"><path d="M45 2C155 48-55 110 55 158" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 9" strokeLinecap="round"/></svg></div>;
}
export function WelcomeScroll({ onContinue, embedded = false }: {
    onContinue: () => void;
    embedded?: boolean;
}) {
    return <OnboardingLanguageProvider><WelcomeScrollContent onContinue={onContinue} embedded={embedded}/></OnboardingLanguageProvider>;
}
function WelcomeScrollContent({ onContinue, embedded }: {
    onContinue: () => void;
    embedded: boolean;
}) {
    const { t, locale } = useOnboardingLanguage();
    const agents = [
        { name: 'Claude', icon: 'claude', note: t("noteClaude") },
        { name: 'Codex', icon: 'openai', note: t("noteCodex") },
        { name: 'OpenCode', icon: 'opencode', note: t("noteOpenCode") },
        { name: 'Hermes', icon: 'hermes', note: t("noteHermes") },
        { name: 'Cursor', icon: 'cursor', note: t("noteCursor") },
        { name: 'DeepSeek', icon: 'deepseek', note: t("noteDeepSeek") },
    ];
    const chapters = [
        { id: 'welcome', label: t("welcome") },
        { id: 'agents', label: t("yourAgents") },
        { id: 'together', label: t("agentsTogether") },
        { id: 'people', label: t("peopleAgents") },
        { id: 'context', label: t("sharedContext") },
    ];
    const scrollRef = useRef<HTMLDivElement>(null);
    const languagePosition = useRef<{ element: HTMLElement; ratio: number } | null>(null);
    const rememberLanguagePosition = () => {
        const root = scrollRef.current;
        if (!root) return;
        const anchor = root.getBoundingClientRect().top + 160;
        const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));
        const section = sections.reverse().find(element => element.getBoundingClientRect().top <= anchor);
        if (section) languagePosition.current = { element: section, ratio: (anchor - section.getBoundingClientRect().top) / section.offsetHeight };
    };
    useLayoutEffect(() => {
        const root = scrollRef.current;
        const position = languagePosition.current;
        if (!root || !position) return;
        const anchor = root.getBoundingClientRect().top + 160;
        root.scrollTop += position.element.getBoundingClientRect().top + position.element.offsetHeight * position.ratio - anchor;
        languagePosition.current = null;
    }, [locale]);
    const [tourProgress, setTourProgress] = useState(0);
    const [active, setActive] = useState('welcome');
    const demo = { request: t('storyRequest'), claude: t('storyDraft'), codex: t('storyBuilt'), feedback: t('storyFeedback'), file: 'launch-page.html' };
    useEffect(() => {
        const root = scrollRef.current;
        if (!root)
            return;
        let frame = 0;
        const updateProgress = () => {
            if (frame)
                return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const distance = root.scrollHeight - root.clientHeight;
                setTourProgress(distance > 0 ? root.scrollTop / distance : 0);
            });
        };
        root.addEventListener('scroll', updateProgress, { passive: true });
        updateProgress();
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries)
                if (entry.isIntersecting)
                    setActive(entry.target.id);
        }, { root, rootMargin: '-20% 0px -55% 0px', threshold: 0 });
        root.querySelectorAll('[data-chapter]').forEach(el => observer.observe(el));
        return () => { observer.disconnect(); root.removeEventListener('scroll', updateProgress); cancelAnimationFrame(frame); };
    }, []);
    const goTo = (id: string) => scrollRef.current?.querySelector(`#${id}`)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start',
    });
    return <div ref={scrollRef} className={`${styles.page} ${embedded ? styles.embedded : ''}`} lang={locale}>
    <header className={styles.nav}>
      <a href="#welcome" onClick={event => { event.preventDefault(); goTo('welcome'); }} className={styles.brand} aria-label={t("backIntro")}><img src="/logo-icon.png" width="25" height="25" alt=""/><span>OpenAgents</span></a>
      <div className={styles.tourProgress} aria-label={t('progress', { percent: Math.round(tourProgress * 100) })}><span><b>{String(chapters.findIndex(chapter => chapter.id === active) + 1).padStart(2, '0')} / 05</b>{chapters.find(chapter => chapter.id === active)?.label}</span><i><span style={{ transform: `scaleX(${tourProgress})` }}/></i></div>
      <div className={styles.navActions}><OnboardingLanguageSwitcher onBeforeChange={rememberLanguagePosition} /><button className={styles.skipButton} onClick={onContinue}>{t("skip")}<X size={15}/></button></div>
    </header>

    <nav className={styles.chapterNav} aria-label={t("chapters")}>{chapters.map(chapter => <button key={chapter.id} onClick={() => goTo(chapter.id)} aria-label={chapter.label} aria-current={active === chapter.id ? 'step' : undefined}><i /><span>{chapter.label}</span></button>)}</nav>

    <main>
      <section id="welcome" data-chapter className={styles.opening}>
        <div className={styles.hero}>
          <img className={styles.heroArt} src="/images/onboarding/water-lilies.webp" alt={t("artAlt")} fetchPriority="high"/>
          <div className={styles.heroShade}/>
          <div className={styles.heroWordmark}><img src="/logo-icon.png" width="80" height="80" alt=""/><span>OpenAgents</span><p>{t("heroTag")}</p></div>
          <span className={styles.heroFootnote}>{t("heroFoot")}</span>
        </div>
        <div className={styles.heroScrollCue}>
          <span>{t('scrollToExplore')}</span><ArrowDown size={18} aria-hidden="true" />
        </div>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{t("introEyebrow")}</p>
          <h1>{t("introTitle")}<br /><em>{t("introEm")}</em></h1>
          <p>{t("introBody1")}<br className={styles.desktopBreak}/>{' '}{t("introBody2")}</p>
          <button className={styles.explore} onClick={() => goTo('agents')}>{t("explore")}<ArrowDown size={15}/></button>
        </div>
      </section>

      <PathBetween />

      <section id="agents" data-chapter className={styles.chapter}>
        <ChapterLabel number="01">{t("bringFavorites")}</ChapterLabel>
        <h2>{t("agentsTitle")}<br /><em>{t("agentsEm")}</em></h2>
        <p className={styles.description}>{t("agentsBody1")}<br className={styles.desktopBreak}/>{' '}{t("agentsBody2")}</p>
        <div className={styles.agentStage}>
          <div className={styles.agentStageHeading}><span>{t("yourTeam")}</span><span>{t("manyMinds")}</span></div>
          <div className={styles.agentPortraits}>{agents.map((agent, index) => <div key={agent.name} className={styles.agentPortrait} style={{ '--portrait-index': index } as React.CSSProperties}>
            <div className={styles.portraitIcon}><AgentMark icon={agent.icon} size={50}/></div>
            <b>{agent.name}</b><p>{agent.note}</p>
          </div>)}</div>
          <div className={styles.agentStageFoot}><span /><img src="/logo-icon.png" width="26" height="26" alt=""/><span /></div>
        </div>
        <div className={styles.interactionCard}>
          <p>{t("bringAlong")}</p>
          <ul className={styles.agentChoices} aria-label={t("exploreAgents")}>{onboardingAgents.map(agent => <li key={agent.id}><AgentMark icon={agent.icon} size={21}/>{agent.name}</li>)}</ul>
          <div className={styles.cloudCallout}>
            <span className={styles.cloudIcon}><Cloud size={25} strokeWidth={1.4} aria-hidden="true"/></span>
            <h3>{t("cloudAgentsTitle")}</h3>
            <p>{t("cloudAgentsBody")}</p>
          </div>
        </div>
      </section>

      <PathBetween />

      <section id="together" data-chapter className={styles.chapter}>
        <ChapterLabel number="02">{t("agentsTogether")}</ChapterLabel>
        <h2>{t("togetherTitle")}<br /><em>{t("togetherEm")}</em></h2>
        <p className={styles.description}>{t("togetherBody1")}<br className={styles.desktopBreak}/>{' '}{t("togetherBody2")}</p>
        <CollaborationStory example={demo} scrollRoot={scrollRef}/>
      </section>

      <PathBetween />

      <section id="people" data-chapter className={styles.chapter}>
        <ChapterLabel number="03">{t("peopleAgents")}</ChapterLabel>
        <h2>{t("peopleTitle")}<br /><em>{t("peopleEm")}</em></h2>
        <p className={styles.description}>{t("peopleBody1")}<br className={styles.desktopBreak}/>{' '}{t("peopleBody2")}</p>
        <CollaborationStory example={demo} withPeople scrollRoot={scrollRef}/>
      </section>

      <PathBetween />

      <section id="context" data-chapter className={styles.chapter}>
        <ChapterLabel number="04">{t("keepGood")}</ChapterLabel>
        <h2>{t("contextTitle")}<br /><em>{t("contextEm")}</em></h2>
        <p className={styles.description}>{t("contextBody1")}<br className={styles.desktopBreak}/>{' '}{t("contextBody2")}</p>
        <ContextPreview />
        <p className={styles.contextCaption}>{t("contextCaption")}</p>
      </section>

      <PathBetween />

      <section className={styles.ending} aria-labelledby="welcome-next-step">
        <div className={styles.endingCard}>
          <div className={styles.endingConnection} aria-hidden="true">
            <div className={styles.endingAgents}>
              <span><AgentMark icon="claude" size={29}/></span>
              <span><AgentMark icon="openai" size={29}/></span>
              <span><AgentMark icon="hermes" size={29}/></span>
            </div>
            <span className={styles.endingConnector}><ArrowRight size={16}/></span>
            <span className={styles.endingWorkspace}><img src="/logo-icon.png" width="35" height="35" alt=""/></span>
          </div>
          <p className={styles.eyebrow}>{t("endingEyebrow")}</p>
          <h2 id="welcome-next-step">{t("endingTitle")}<br /><em>{t("endingEm")}</em></h2>
          <p className={styles.endingDescription}>{t("endingBody")}</p>
          <button className={styles.finalButton} onClick={onContinue}>{t("getStarted")}<span><ArrowRight size={18} aria-hidden="true"/></span></button>
          <div className={styles.endingOptions}><span><Laptop size={14} aria-hidden="true"/>{t("endingLocal")}</span><i aria-hidden="true"/><span><Cloud size={14} aria-hidden="true"/>{t("endingCloud")}</span></div>
        </div>
        <button className={styles.backToTop} onClick={() => goTo('welcome')}>{t("backBeginning")}<ArrowUp size={12}/></button>
      </section>
    </main>
    <footer className={styles.footer}><span>OpenAgents</span><a href="https://www.artic.edu/artworks/16568/water-lilies" target="_blank" rel="noreferrer">{t("artCredit")}</a></footer>
  </div>;
}
