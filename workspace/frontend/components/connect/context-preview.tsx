import { BookOpen, Check, ChevronRight, FileText, Folder, Globe, MessageSquare, MoreHorizontal, PanelLeft, Pencil, Plus, Search, Share2, Users } from 'lucide-react';
import styles from './welcome-scroll.module.css';
import { useOnboardingLanguage } from './onboarding-language';
/** A self-contained product illustration; it never loads workspace data. */
export function ContextPreview() {
    const { t } = useOnboardingLanguage();
    return <div className={styles.contextStage}>
    <div className={styles.productPreviewLabel}><span>{t("workspaceLabel")}</span><span>{t("illustration")}</span></div>
    <div className={styles.contextWorkspace} role="img" aria-label={t("workspaceAlt")}>
      <div className={styles.productSidebar} aria-hidden="true">
        <div className={styles.productBrand}><img src="/logo-icon.png" width="19" height="19" alt=""/>{t("acme")}</div>
        <span className={styles.productManage}><Plus size={12}/>{t("manageAgents")}</span>
        <small>{t("collaboration")}</small>
        <span><MessageSquare size={14}/>{t("threads")}</span>
        <span><FileText size={14}/>{t("files")}</span>
        <span className={styles.productNavActive}><BookOpen size={14}/>{t("knowledge")}</span>
        <div className={styles.productAgentList}><small>{t("agents")}<span>{t("onlineTwo")}</span></small><span><img src="/icons/agents/claude.svg" width="18" height="18" alt=""/>Claude<i /></span><span><img src="/icons/agents/openai.svg" width="18" height="18" alt=""/>Codex<i /></span></div>
        <div className={styles.productMember}><img src="/images/avatars/you.png" width="21" height="21" alt=""/><span>{t("you")}<small>{t("owner")}</small></span></div>
      </div>
      <div className={styles.knowledgePreviewList} aria-hidden="true">
        <div className={styles.productPaneHeader}><span><PanelLeft size={13}/>{t("knowledge")}</span><Plus size={14}/></div>
        <div className={styles.productSearch}><Search size={12}/>{t("searchKnowledge")}</div>
        <div className={styles.productLibrary}><BookOpen size={13}/>{t("libraryOverview")}<ChevronRight size={12}/></div>
        <div className={styles.productFolder}><Folder size={13}/>{t("websiteLaunch")}<ChevronRight size={12}/></div>
        {[[t("launchBrief"), t("agreedDirection"), t("justUpdated")], [t("brandVoice"), t("brandDescription"), t("yesterday")], [t("teamDecisions"), t("decisionsDescription"), t("twoDaysAgo")]].map(([title, description, time], index) => <div key={title} className={`${styles.productKnowledgeRow} ${index === 0 ? styles.selectedKnowledgeRow : ''}`}><BookOpen size={13}/><div><b>{title}</b><p>{description}</p><small>{time}</small></div></div>)}
      </div>
      <div className={styles.productDocumentPane} aria-hidden="true">
        <div className={styles.productPaneHeader}><span>{t("launchBrief")}</span><span><Share2 size={13}/><Pencil size={13}/><MoreHorizontal size={15}/></span></div>
        <article className={styles.productDocument}>
          <div className={styles.productDocumentMeta}><span><Users size={11}/>{t("workspace")}</span><span>{t("updatedBy")}</span></div>
          <BookOpen size={25} className={styles.productBookIcon}/>
          <h3>{t("documentTitle")}</h3>
          <p>{t("documentIntro")}</p>
          <h4>{t("whatMaking")}</h4>
          <p>{t("documentBody")}</p>
          <div className={styles.productDecision}><Check size={15}/><div><b>{t("agreedDirection")}</b><p>{t("documentDecision")}</p></div></div>
          <h4>{t("everythingPlace")}</h4>
          <div className={styles.productLinkedFiles}><span><span className={styles.pdfFile}>PDF</span><b>{t("projectFile")}<small>128 KB · Maya</small></b></span><span><span className={styles.mdFile}><FileText size={19}/></span><b>{t("planFile")}<small>4 KB · Claude</small></b></span></div>
        </article>
        <div className={styles.productContextThread}>
          <div><MessageSquare size={12}/>{t("backConversation")}<span>{t("websiteLaunch")}<ChevronRight size={11}/></span></div>
          <p><img src="/images/avatars/you.png" width="22" height="22" alt=""/><span>{t("useBriefBefore")}{' '}<strong><BookOpen size={11}/>{t("launchBrief")}</strong>{' '}{t("useBriefAfter")}</span></p>
          <p><img src="/icons/agents/claude.svg" width="22" height="22" alt=""/><span>{t("gotBrief")}</span></p>
        </div>
      </div>
    </div>
    <div className={styles.contextTakeaways}><span><BookOpen size={14}/>{t("knowledgeTakeaway")}</span><i /><span><Folder size={14}/>{t("filesTakeaway")}</span><i /><span><Globe size={14}/>{t("contextTakeaway")}</span></div>
  </div>;
}
