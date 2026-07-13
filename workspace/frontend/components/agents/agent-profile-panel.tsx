'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Copy, Check, Plus, Globe, Folder, Monitor, UserRoundCog, Cloud, Trash2, KeyRound, RefreshCw, Sparkles, ExternalLink } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CloudAgentConfig } from '@/lib/types';

export function AgentProfilePanel() {
  const { selectedAgentName, setSelectedAgentName, isMobile, setViewMode } = useLayout();
  const { agents, refreshWorkspace, createSession } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const agent = agents.find((a) => a.agentName === selectedAgentName);

  const isCloud = agent?.agentType?.startsWith('cloud:') ?? false;

  // Cloud agent config
  const [cloudConfig, setCloudConfig] = useState<CloudAgentConfig | null>(null);
  useEffect(() => {
    if (!isCloud || !agent) { setCloudConfig(null); return; }
    workspaceApi.listCloudAgents().then((configs) => {
      setCloudConfig(configs.find((c) => c.agentName === agent.agentName) || null);
    }).catch(() => {});
  }, [isCloud, agent?.agentName]);

  const handleRemoveCloudAgent = useCallback(async () => {
    if (!agent) return;
    try {
      await workspaceApi.removeCloudAgent(agent.agentName);
      toast.success(`Removed cloud agent "${agent.agentName}"`);
      setSelectedAgentName(null);
      refreshWorkspace();
    } catch {
      toast.error('Failed to remove cloud agent');
    }
  }, [agent, setSelectedAgentName, refreshWorkspace]);

  // Inline API key update
  const [editingKey, setEditingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const handleUpdateApiKey = useCallback(async () => {
    if (!agent || !newApiKey) return;
    setSavingKey(true);
    try {
      await workspaceApi.updateCloudAgent(agent.agentName, { apiKey: newApiKey });
      toast.success('API key updated');
      setEditingKey(false);
      setNewApiKey('');
      workspaceApi.listCloudAgents().then((configs) => {
        setCloudConfig(configs.find((c) => c.agentName === agent.agentName) || null);
      }).catch(() => {});
    } catch {
      toast.error('Failed to update API key');
    } finally {
      setSavingKey(false);
    }
  }, [agent, newApiKey]);

  useEffect(() => { setEditingKey(false); setNewApiKey(''); }, [agent?.agentName]);

  // Description state — local draft + save
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [descDirty, setDescDirty] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  // Sync description when agent changes
  useEffect(() => {
    if (agent) {
      setDescription(agent.description || '');
      setDescDirty(false);
    }
  }, [agent?.agentName, agent?.description]);

  const handleSaveDescription = useCallback(async () => {
    if (!agent || !descDirty) return;
    setSaving(true);
    try {
      await workspaceApi.updateMember(agent.agentName, { description });
      await refreshWorkspace();
      setDescDirty(false);
      toast.success('Description saved');
    } catch {
      toast.error('Failed to save description');
    } finally {
      setSaving(false);
    }
  }, [agent, description, descDirty, refreshWorkspace]);

  const handleGenerateDescription = useCallback(async () => {
    if (!agent) return;
    setGeneratingDesc(true);
    try {
      const suggestion = await workspaceApi.generateMemberDescription(agent.agentName);
      if (suggestion) {
        setDescription(suggestion);
        setDescDirty(true);
        toast.success('Draft generated — review and save');
      } else {
        toast.error('Could not generate a description');
      }
    } catch {
      toast.error('Failed to generate description');
    } finally {
      setGeneratingDesc(false);
    }
  }, [agent]);

  const handleStartThread = useCallback(async () => {
    if (!agent) return;
    await createSession({ master: agent.agentName, participants: [agent.agentName] });
    setSelectedAgentName(null);
    setViewMode('threads');
  }, [agent, createSession, setSelectedAgentName, setViewMode]);

  if (!agent) return null;

  const isOnline = agent.status === 'online';

  // Capitalize agent type for display (e.g. "claude" → "Claude", "cloud:openai" → "Cloud: OpenAI")
  const displayType = isCloud
    ? `Cloud: ${(agent.agentType || '').replace('cloud:', '').charAt(0).toUpperCase()}${(agent.agentType || '').replace('cloud:', '').slice(1)}`
    : agent.agentType
      ? agent.agentType.charAt(0).toUpperCase() + agent.agentType.slice(1)
      : 'Unknown';

  const infoItems = isCloud
    ? [
        { icon: <Cloud className="size-3.5" />, label: 'Type', value: displayType },
        { icon: <Monitor className="size-3.5" />, label: 'Model', value: cloudConfig?.model || '—' },
        { icon: <Globe className="size-3.5" />, label: 'API Key', value: cloudConfig?.apiKeyMasked || '—' },
        { icon: <UserRoundCog className="size-3.5" />, label: 'Agent ID', value: `openagents:${agent.agentName}`, copyable: true },
      ]
    : [
        { icon: <Monitor className="size-3.5" />, label: 'Type', value: displayType },
        { icon: <Globe className="size-3.5" />, label: 'Server', value: agent.serverHost || '—' },
        { icon: <Folder className="size-3.5" />, label: 'Folder', value: agent.workingDir || '—' },
        { icon: <UserRoundCog className="size-3.5" />, label: 'Agent ID', value: `openagents:${agent.agentName}`, copyable: true },
      ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 z-10"
        onClick={() => setSelectedAgentName(null)}
      />

      {/* Panel — full-width on mobile, 320px sidebar on desktop */}
      <div className={cn(
        'absolute top-0 right-0 bottom-0 bg-background border-l shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200',
        isMobile ? 'left-0 w-full' : 'w-[320px]'
      )}>
        {/* Close button */}
        <div className="flex items-center justify-end px-3 pt-3">
          <button
            onClick={() => setSelectedAgentName(null)}
            className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Profile header */}
        <div className="px-5 pb-4">
          <div className="flex items-center gap-3">
            <AgentAvatar name={agent.agentName} size={40} status={agent.status} showStatus />
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight truncate">{agent.agentName}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={cn(
                  'inline-flex items-center gap-1 text-[11px] px-1.5 py-px rounded font-medium',
                  isOnline ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                )}>
                  <span className={cn('size-1.5 rounded-full', isOnline ? 'bg-green-500' : 'bg-zinc-400')} />
                  {agent.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3.5 space-y-3">
          {/* Description */}
          <div className="rounded-lg border overflow-hidden">
            <div className="px-3.5 py-2.5 border-b flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Description</span>
              <button
                onClick={handleGenerateDescription}
                disabled={generatingDesc}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors shrink-0"
                title="Auto-generate a description from this agent's activity and skills"
              >
                {generatingDesc
                  ? <RefreshCw className="size-3 animate-spin" />
                  : <Sparkles className="size-3 text-amber-500" />}
                {generatingDesc ? 'Generating…' : 'Auto-generate'}
              </button>
            </div>
            <div className="p-3">
              <textarea
                className="w-full text-[13px] leading-relaxed bg-transparent resize-none outline-none placeholder:text-muted-foreground/50 min-h-[60px]"
                placeholder={`Describe what ${agent.agentName} does so other agents know when to delegate work...`}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescDirty(true);
                }}
                onBlur={handleSaveDescription}
                rows={3}
              />
              {descDirty && (
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={handleSaveDescription}
                    disabled={saving}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Connection Details */}
          <div className="rounded-lg border overflow-hidden">
            <div className="px-3.5 py-2.5 border-b">
              <span className="text-xs font-medium">Connection Details</span>
            </div>
            <div className="divide-y">
              {infoItems.map((item) => (
                <div key={item.label} className="flex items-start gap-3 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 shrink-0 w-[80px] pt-px">
                    <span className="text-muted-foreground">{item.icon}</span>
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                  <div className="flex-1 min-w-0 flex items-start gap-1">
                    <span className={cn(
                      'text-[13px] break-all leading-snug',
                      item.label !== 'Type' ? 'font-mono' : 'font-medium capitalize'
                    )}>
                      {item.value}
                    </span>
                    {item.copyable && (
                      <button
                        className="size-6 shrink-0 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors mt-px"
                        title={`Copy ${item.label}`}
                        onClick={() => copyToClipboard(item.value)}
                      >
                        {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cloud config management */}
          {isCloud && cloudConfig && (
            <div className="rounded-lg border overflow-hidden">
              <div className="px-3.5 py-2.5 border-b">
                <span className="text-xs font-medium">Cloud Configuration</span>
              </div>
              <div className="p-3 space-y-3">
                {/* API Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-muted-foreground">API Key</span>
                    {!editingKey && (
                      <button
                        onClick={() => setEditingKey(true)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <KeyRound className="size-2.5" />
                        Update
                      </button>
                    )}
                  </div>
                  {editingKey ? (
                    <div className="flex gap-1.5">
                      <input
                        type="password"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        placeholder="New API key..."
                        className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono rounded border bg-transparent outline-none focus:ring-1 focus:ring-foreground/20"
                        autoFocus
                      />
                      <button
                        onClick={handleUpdateApiKey}
                        disabled={savingKey || !newApiKey}
                        className="px-2 py-1.5 text-[10px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {savingKey ? <RefreshCw className="size-2.5 animate-spin" /> : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingKey(false); setNewApiKey(''); }}
                        className="px-2 py-1.5 text-[10px] font-medium rounded border hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">{cloudConfig.apiKeyMasked}</span>
                  )}
                </div>

                {/* System prompt (if set) */}
                {cloudConfig.systemPrompt && (
                  <div>
                    <span className="text-[11px] text-muted-foreground">System Prompt</span>
                    <p className="text-xs text-foreground mt-1 whitespace-pre-wrap line-clamp-3">{cloudConfig.systemPrompt}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Installed Skills */}
          {(() => {
            const installed: string[] = (agent.enabledSkills as Record<string, unknown>)?.installed as string[] || [];
            if (installed.length === 0) return null;
            const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';
            const SKILL_LOGOS: Record<string, { name: string; logo: string }> = {
              'claude-api': { name: 'Claude API', logo: `${SI}/anthropic.svg` },
              'openai-sdk': { name: 'OpenAI SDK', logo: `${SI}/openai.svg` },
              'langchain': { name: 'LangChain', logo: `${SI}/langchain.svg` },
              'mcp-builder': { name: 'MCP Builder', logo: `${SI}/anthropic.svg` },
              'skill-creator': { name: 'Skill Creator', logo: `${SI}/anthropic.svg` },
              'ai-sdk': { name: 'Vercel AI SDK', logo: `${SI}/vercel.svg` },
              'nextjs': { name: 'Next.js', logo: `${SI}/nextdotjs.svg` },
              'angular': { name: 'Angular', logo: `${SI}/angular.svg` },
              'vue': { name: 'Vue.js', logo: `${SI}/vuedotjs.svg` },
              'svelte': { name: 'Svelte', logo: `${SI}/svelte.svg` },
              'tailwindcss': { name: 'Tailwind CSS', logo: `${SI}/tailwindcss.svg` },
              'frontend-design': { name: 'Frontend Design', logo: `${SI}/anthropic.svg` },
              'fastapi': { name: 'FastAPI', logo: `${SI}/fastapi.svg` },
              'django': { name: 'Django', logo: `${SI}/django.svg` },
              'graphql': { name: 'GraphQL', logo: `${SI}/graphql.svg` },
              'postgresql': { name: 'PostgreSQL', logo: `${SI}/postgresql.svg` },
              'mongodb': { name: 'MongoDB', logo: `${SI}/mongodb.svg` },
              'redis': { name: 'Redis', logo: `${SI}/redis.svg` },
              'prisma': { name: 'Prisma', logo: `${SI}/prisma.svg` },
              'supabase': { name: 'Supabase', logo: `${SI}/supabase.svg` },
              'firebase': { name: 'Firebase', logo: `${SI}/firebase.svg` },
              'github-actions': { name: 'GitHub Actions', logo: `${SI}/githubactions.svg` },
              'sentry': { name: 'Sentry', logo: `${SI}/sentry.svg` },
              'jest': { name: 'Jest', logo: `${SI}/jest.svg` },
              'pytest': { name: 'pytest', logo: `${SI}/pytest.svg` },
              'cypress': { name: 'Cypress', logo: `${SI}/cypress.svg` },
              'stripe': { name: 'Stripe', logo: `${SI}/stripe.svg` },
              'notion': { name: 'Notion', logo: `${SI}/notion.svg` },
              'jira': { name: 'Jira', logo: `${SI}/jira.svg` },
              'shopify': { name: 'Shopify', logo: `${SI}/shopify.svg` },
              'zapier': { name: 'Zapier', logo: `${SI}/zapier.svg` },
              'docx': { name: 'Word Documents', logo: `${SI}/microsoftword.svg` },
              'xlsx': { name: 'Spreadsheets', logo: `${SI}/microsoftexcel.svg` },
              'pptx': { name: 'Presentations', logo: `${SI}/microsoftpowerpoint.svg` },
              'pdf': { name: 'PDF Processing', logo: `${SI}/adobeacrobatreader.svg` },
              'sn-deep-research': { name: 'SenseNova Deep Research', logo: 'https://avatars.githubusercontent.com/u/215225587' },
              'sn-infographic': { name: 'SenseNova Infographic', logo: 'https://avatars.githubusercontent.com/u/215225587' },
              'sn-ppt-entry': { name: 'SenseNova PPT', logo: 'https://avatars.githubusercontent.com/u/215225587' },
              'sn-da-excel-workflow': { name: 'SenseNova Excel Analysis', logo: 'https://avatars.githubusercontent.com/u/215225587' },
              'sn-image-base': { name: 'SenseNova Image Gen', logo: 'https://avatars.githubusercontent.com/u/215225587' },
              'sn-md-to-html-report': { name: 'SenseNova HTML Report', logo: 'https://avatars.githubusercontent.com/u/215225587' },
            };
            return (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-3.5 py-2.5 border-b flex items-center gap-1.5">
                  <Sparkles className="size-3 text-amber-500" />
                  <span className="text-xs font-medium">Installed Skills</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{installed.length}</span>
                </div>
                <div className="divide-y">
                  {installed.map(skillId => {
                    const info = SKILL_LOGOS[skillId];
                    return (
                      <div key={skillId} className="flex items-center gap-2.5 px-3.5 py-2.5">
                        <div className="size-6 rounded bg-muted/60 flex items-center justify-center shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {info ? <img src={info.logo} alt="" className="h-3.5 w-3.5 object-contain dark:invert" /> : <Sparkles className="size-3 text-muted-foreground" />}
                        </div>
                        <span className="text-[13px] font-medium flex-1 truncate">{info?.name || skillId}</span>
                        <a
                          href={`https://github.com/${skillId.includes('-') ? 'TerminalSkills/skills/tree/main/skills/' : 'anthropics/skills/tree/main/skills/'}${skillId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        </div>

        {/* Footer actions */}
        <div className="px-3.5 py-3 border-t">
          <div className="flex gap-2">
            <button
              onClick={handleStartThread}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border bg-background hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <Plus className="size-3" />
              Start a Thread
            </button>
            {isCloud && (
              <button
                onClick={handleRemoveCloudAgent}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Remove cloud agent"
              >
                <Trash2 className="size-3" />
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
