'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, ArrowUp, Check, CheckCheck, FileText, MessageSquare, ArrowDown, Lock, ShieldCheck, X, Users, PanelRight, Share2, Layers, Plus, Mouse, CircleCheck } from 'lucide-react';
import styles from './welcome-scroll.module.css';
import { useOnboardingLanguage } from './onboarding-language';
type Example = {
    request: string;
    claude: string;
    codex: string;
    file: string;
    feedback: string;
};
type StoryStep = {
    who: string;
    role: string;
    image: string;
    message: string;
    caption: string;
    file?: string;
    handoff?: boolean;
    approval?: boolean;
};
/** A pinned illustration whose story advances only as the reader scrolls. */
export function CollaborationStory({ example, withPeople = false, scrollRoot }: {
    example: Example;
    withPeople?: boolean;
    scrollRoot: RefObject<HTMLDivElement | null>;
}) {
    const { t, locale } = useOnboardingLanguage();
    const trackRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const [progress, setProgress] = useState(0);
    const [messageOffset, setMessageOffset] = useState(0);
    const steps: StoryStep[] = withPeople ? [
        { who: t("you"), role: t("startingPoint"), image: '/images/avatars/you.png', message: example.request, caption: t("captionDirection") },
        { who: 'Claude', role: t("yourAgent"), image: '/icons/agents/claude.svg', message: t("storyAskMaya"), caption: t("captionDraft") },
        { who: 'Maya', role: t("teammate"), image: '/images/avatars/maya.png', message: example.feedback, caption: t("captionFeedback"), handoff: true },
        { who: 'Codex', role: t("yourAgent"), image: '/icons/agents/openai.svg', message: t("storyWait"), file: example.file, approval: true, caption: t("captionWait") },
        { who: t("you"), role: t("reviewer"), image: '/images/avatars/you.png', message: t("storyApprove"), caption: t("captionApprove") },
        { who: 'Codex', role: t("yourAgent"), image: '/icons/agents/openai.svg', message: t("storyPublished"), caption: t("captionContinue") },
    ] : [
        { who: t("you"), role: t("startingPoint"), image: '/images/avatars/you.png', message: example.request, caption: t("captionStart") },
        { who: 'Claude', role: t("yourAgent"), image: '/icons/agents/claude.svg', message: example.claude, caption: t("captionHandoff"), handoff: true },
        { who: 'Codex', role: t("yourAgent"), image: '/icons/agents/openai.svg', message: example.codex, file: example.file, caption: t("captionBuild") },
        { who: t("you"), role: t("readyReview"), image: '/images/avatars/you.png', message: t("storyResult"), caption: t("captionResult") },
    ];
    const stageNames = withPeople
        ? [t("stageDirection"), t("stageStart"), t("stageShape"), t("stageWait"), t("stageApprove"), t("stageContinue")]
        : [t("stageDirection"), t("stageDevelop"), t("stageBuild"), t("stageReady")];
    const last = steps.length - 1;
    const position = progress * last;
    const phase = Math.min(last, Math.floor(position + .15));
    useEffect(() => {
        const root = scrollRoot.current;
        const track = trackRef.current;
        const scene = sceneRef.current;
        if (!root || !track || !scene)
            return;
        let frame = 0;
        const update = () => {
            const pinTop = Number.parseFloat(getComputedStyle(scene).top) || 0;
            const distance = root.getBoundingClientRect().top + pinTop - track.getBoundingClientRect().top;
            const travel = track.offsetHeight - scene.offsetHeight;
            const next = travel > 0 ? Math.min(1, Math.max(0, distance / travel)) : 0;
            setProgress(next);
        };
        const schedule = () => {
            if (frame)
                return;
            frame = window.requestAnimationFrame(() => { frame = 0; update(); });
        };
        const resize = new ResizeObserver(schedule);
        resize.observe(root);
        resize.observe(track);
        resize.observe(scene);
        root.addEventListener('scroll', schedule, { passive: true });
        update();
        return () => {
            root.removeEventListener('scroll', schedule);
            resize.disconnect();
            window.cancelAnimationFrame(frame);
        };
    }, [scrollRoot]);
    useEffect(() => {
        const viewport = viewportRef.current;
        const messages = messagesRef.current;
        if (!viewport || !messages)
            return;
        const adjust = () => {
            const row = messages.children[phase] as HTMLElement | undefined;
            if (row)
                setMessageOffset(Math.max(0, row.offsetTop + row.offsetHeight - viewport.clientHeight + 20));
        };
        const resize = new ResizeObserver(adjust);
        resize.observe(viewport);
        adjust();
        return () => resize.disconnect();
    }, [phase, locale]);
    return <div ref={trackRef} className={styles.scrollStoryTrack} style={{ '--story-count': steps.length } as React.CSSProperties}>
    <ol className={styles.storyTranscript} aria-label={withPeople ? t('peopleAgents') : t('agentsTogether')}>{steps.map((step, index) => <li key={index}>{step.who}: {step.message} {step.file ? t('resultFile', { file: step.file }) : ''} {step.approval ? t("approvalTranscript") : ''}</li>)}</ol>
    <div ref={sceneRef} className={`${styles.chatStage} ${styles.storyScene} ${styles.scrollStoryScene}`} aria-hidden="true">
      <div className={`${styles.storyProgressHeader} ${withPeople && phase === 3 ? styles.approvalProgress : ''} ${phase === last ? styles.finishedProgress : ''}`}>
        <div><span className={styles.storyStepCount}>{t("step")}<b>{String(phase + 1).padStart(2, '0')}</b> / {String(steps.length).padStart(2, '0')}</span><h3 key={phase}>{withPeople && phase === 3 ? <Lock size={19}/> : phase === last ? <CircleCheck size={19}/> : null}{stageNames[phase]}</h3></div>
        <span className={styles.storyScrollCue}><Mouse size={16}/><span>{phase === last ? t("nextChapter") : t("scrollNext")}<ArrowDown size={13}/></span></span>
      </div>
      <div className={styles.storySegments}>{steps.map((step, index) => <span key={index} className={index <= phase ? styles.storySegmentReached : ''}><i style={{ transform: `scaleX(${Math.min(1, Math.max(0, position - index + 1))})` }}/></span>)}</div>
      <div className={styles.storyRail}>
        {steps.map((step, index) => {
            const packet = Math.min(1, Math.max(0, position - (index - 1)));
            return <div key={`${step.who}:${index}`} className={styles.storyRailItem}>
            {index > 0 && <span className={`${styles.storyConnector} ${phase >= index ? styles.passedConnector : ''}`} style={{ '--handoff-progress': packet } as React.CSSProperties}><i className={styles.contextPacket} style={{ left: `${packet * 100}%`, opacity: packet > .02 && packet < .98 ? 1 : 0 }}><FileText size={17}/></i></span>}
            <div className={`${styles.storyActor} ${phase === index ? styles.activeActor : ''} ${phase > index ? styles.completedActor : ''}`}><span><img src={step.image} width="34" height="34" alt=""/>{phase > index && <i><Check size={9}/></i>}</span><b>{step.who}</b></div>
          </div>;
        })}
      </div>
      <div className={styles.chatWindow}>
        <div className={styles.chatWindowHeader}><span><MessageSquare size={16}/>{t("websiteLaunch")}<span className={styles.productParticipantCount}><Users size={12}/>{withPeople ? 2 : 1}</span></span><span className={styles.productThreadTools}><Share2 size={14}/><PanelRight size={14}/></span></div>
        <div className={styles.productArtifactBar}><span><Layers size={12}/>{t("artifacts")}<b>{phase >= (withPeople ? 3 : 2) ? 1 : 0}</b></span><span>{t("agents")}<b>2</b></span><small>{t("illustration")}</small></div>
        <div ref={viewportRef} className={`${styles.demoConversation} ${styles.animatedConversation}`}>
          <div ref={messagesRef} className={styles.storyMessages} style={{ transform: `translateY(-${messageOffset}px)` }}>
            {steps.map((step, index) => <div key={`${step.who}:${index}`} className={`${styles.chatRow} ${styles.storyRow} ${index <= phase ? styles.revealedRow : ''} ${index === phase ? styles.currentStoryRow : ''}`}>
              <img src={step.image} width="32" height="32" alt=""/><div><b>{step.who} <small className={step.role === t("yourAgent") ? styles.productAgentBadge : undefined}>{step.role}</small><time>10:{String(30 + index).padStart(2, '0')}</time></b><p>{step.message}</p>{step.handoff && <span className={styles.handoff}><ArrowRight size={12}/> {withPeople ? t("feedbackShared") : t("contextShared")}</span>}{step.file && <span className={styles.filePill}><FileText size={18}/>{step.file}<CheckCheck size={14}/></span>}{step.approval && <div className={`${styles.demoApproval} ${phase >= 4 ? styles.demoApproved : ''}`}><Lock size={16}/><div><b>{t("approvalTitle")}</b><p><ShieldCheck size={12}/>{t("needsApproval")}<span>{t("publish")}</span></p>{phase >= 4 ? <strong><Check size={13}/>{t("approvedBy")}</strong> : <div className={styles.demoApprovalActions}><span><X size={12}/>{t("reject")}</span><span><Check size={12}/>{t("approve")}</span></div>}</div></div>}</div>
            </div>)}
          </div>
        </div>
        <div className={styles.demoComposer}><p>{t("message")}<small>{t("mentionHint")}</small></p><div><Plus size={15}/><span><ArrowUp size={14}/></span></div></div>
      </div>
      <div className={styles.storyCaption}><p>{steps[phase].caption}</p></div>
    </div>
  </div>;
}
