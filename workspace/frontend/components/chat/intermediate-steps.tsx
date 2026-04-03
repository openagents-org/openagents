'use client';

import { memo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Brain,
  Wrench,
  Activity,
  Pencil,
  Eye,
  Terminal,
  Search,
  Clock,
  Users,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';

// ── Content Parsing ──

interface ParsedStep {
  type: 'thinking' | 'tool_call' | 'status' | 'compacting';
  tool?: string;
  toolDisplay?: string;
  args?: string;
  summary?: string;
  text?: string;
}

function parseStepContent(content: string): ParsedStep {
  // Thinking placeholder
  if (content === 'thinking...' || content.toLowerCase() === 'thinking') {
    return { type: 'thinking', text: content };
  }

  // Claude adapter: **Thinking:**\n{content}
  const thinkingMatch = content.match(/^\*\*Thinking:\*\*\n([\s\S]+)$/);
  if (thinkingMatch) {
    return { type: 'thinking', text: thinkingMatch[1].trim() };
  }

  // Claude adapter: **Using tool:** `ToolName`\n```\n{args}\n```
  const toolMatch = content.match(
    /\*\*Using tool:\*\*\s*`([^`]+)`\s*```([\s\S]*?)```/
  );
  if (toolMatch) {
    const rawTool = toolMatch[1];
    const args = toolMatch[2].trim();
    const toolDisplay = cleanToolName(rawTool);
    const summary = extractToolSummary(toolDisplay, args);
    return { type: 'tool_call', tool: rawTool, toolDisplay, args, summary };
  }

  // Codex adapter: **Running:** `command`
  const runMatch = content.match(/\*\*Running:\*\*\s*`([^`]+)`/);
  if (runMatch) {
    return {
      type: 'tool_call',
      tool: 'Bash',
      toolDisplay: 'Bash',
      summary: runMatch[1],
    };
  }

  // Codex adapter: **Editing:** `filename`
  const editMatch = content.match(/\*\*Editing:\*\*\s*`([^`]+)`/);
  if (editMatch) {
    return {
      type: 'tool_call',
      tool: 'Edit',
      toolDisplay: 'Edit',
      summary: editMatch[1],
    };
  }

  // Compaction / context management
  if (/compact/i.test(content)) {
    return { type: 'compacting', text: content };
  }

  // General status
  return { type: 'status', text: content };
}

function cleanToolName(name: string): string {
  // mcp__openagents-workspace__workspace_status → workspace_status
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];
  // mcp_openagents-workspace__workspace_status
  const mcpMatch2 = name.match(/^mcp_[^_]+--.+?__(.+)$/);
  if (mcpMatch2) return mcpMatch2[1];
  return name;
}

function extractToolSummary(tool: string, args: string): string {
  const fileMatch = args.match(/'file_path':\s*'([^']+)'/);
  if (fileMatch && ['Write', 'Read', 'Edit'].includes(tool)) {
    return fileMatch[1];
  }

  const commandMatch = args.match(/'command':\s*'([^']+)'/);
  if (commandMatch && tool === 'Bash') {
    return commandMatch[1].slice(0, 80);
  }

  const statusMatch = args.match(/'status':\s*'([^']+)'/);
  if (statusMatch) return statusMatch[1];

  const contentMatch = args.match(/'content':\s*'([^']{0,60})/);
  if (contentMatch) {
    return contentMatch[1] + (contentMatch[1].length >= 60 ? '...' : '');
  }

  const patternMatch = args.match(/'pattern':\s*'([^']+)'/);
  if (patternMatch) return patternMatch[1];

  return args.length > 60 ? args.slice(0, 60) + '...' : args;
}

// ── Icon Mapping ──

const TOOL_ICONS: Record<string, typeof Wrench> = {
  Write: Pencil,
  Edit: Pencil,
  Read: Eye,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  workspace_status: Activity,
  workspace_get_history: Clock,
  workspace_get_agents: Users,
};

function getStepIcon(parsed: ParsedStep) {
  if (parsed.type === 'thinking') return Brain;
  if (parsed.type === 'compacting') return RefreshCw;
  if (parsed.type === 'status') return Activity;
  return TOOL_ICONS[parsed.toolDisplay || ''] || Wrench;
}

// ── Step Item ──

const StepItem = memo(function StepItem({ message }: { message: WorkspaceMessage }) {
  const [expanded, setExpanded] = useState(false);
  // Messages with messageType 'thinking' are already typed — parse as thinking directly
  const parsed = message.messageType === 'thinking'
    ? { type: 'thinking' as const, text: message.content }
    : parseStepContent(message.content);
  const Icon = getStepIcon(parsed);
  const hasDetail = parsed.type === 'tool_call' && !!parsed.args;
  const isThinkingWithContent = parsed.type === 'thinking' && !!parsed.text && parsed.text !== 'thinking...' && parsed.text.toLowerCase() !== 'thinking';

  // Thinking with content renders directly inline (not behind a click)
  if (isThinkingWithContent) {
    return (
      <div className="py-0.5">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span className="italic text-[11px]">thinking</span>
        </div>
        <div className="text-xs leading-relaxed text-foreground/60 ml-[22px] mt-0.5 mb-1 whitespace-pre-wrap">
          {parsed.text}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 text-xs py-0.5 w-full text-left rounded transition-colors',
          hasDetail
            ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 -ml-1 pl-1 pr-1'
            : 'cursor-default',
          'text-muted-foreground'
        )}
        onClick={() => hasDetail && setExpanded(!expanded)}
        disabled={!hasDetail}
      >
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            parsed.type === 'thinking' && 'text-amber-500 animate-pulse',
            parsed.type === 'compacting' && 'text-violet-500 animate-spin',
            parsed.type === 'tool_call' && 'text-blue-500',
            parsed.type === 'status' && 'text-emerald-500'
          )}
        />

        {parsed.type === 'thinking' && (
          <span className="italic animate-pulse">thinking...</span>
        )}

        {parsed.type === 'compacting' && (
          <span className="italic text-violet-500/80 animate-pulse">Vibing ...</span>
        )}

        {parsed.type === 'tool_call' && (
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="font-mono font-medium text-foreground/70 shrink-0">
              {parsed.toolDisplay}
            </span>
            {parsed.summary && (
              <>
                <span className="text-muted-foreground/30 shrink-0">›</span>
                <span className="truncate text-muted-foreground/60">
                  {parsed.summary}
                </span>
              </>
            )}
          </span>
        )}

        {parsed.type === 'status' && <span>{parsed.text}</span>}

        {hasDetail && (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-200 text-muted-foreground/40',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      {expanded && parsed.args && (
        <pre className="text-[11px] leading-relaxed bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-md p-2.5 ml-[22px] mt-1 mb-1.5 overflow-x-auto max-h-48 text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">
          {parsed.args}
        </pre>
      )}
    </div>
  );
});

// ── Intermediate Steps Group ──

// ── Activity Indicator: Breathing Dots ──

function ActivityIndicator() {
  return (
    <div className="py-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/breathing-dots.gif" alt="" width={44} height={14} className="opacity-90" />
    </div>
  );
}

// ── Intermediate Steps Group ──

interface IntermediateStepsProps {
  steps: WorkspaceMessage[];
  agents?: WorkspaceAgent[];
  isActive?: boolean;
}

export const IntermediateSteps = memo(function IntermediateSteps({ steps, agents, isActive = false }: IntermediateStepsProps) {
  const agentNames = agents?.map((a) => a.agentName) ?? [];
  if (steps.length === 0) return null;

  // Group consecutive steps by sender
  const hasMultipleAgents = (agents?.length ?? 0) > 1;
  const senderGroups: { sender: string; steps: WorkspaceMessage[] }[] = [];
  for (const step of steps) {
    const last = senderGroups[senderGroups.length - 1];
    if (last && last.sender === step.senderName) {
      last.steps.push(step);
    } else {
      senderGroups.push({ sender: step.senderName, steps: [step] });
    }
  }

  return (
    <div className="flex items-start gap-3 py-1">
      {/* Spacer matching avatar width for alignment with chat messages */}
      <div className="size-8 shrink-0" />
      <div className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-3 py-0.5 min-w-0 flex-1">
        {senderGroups.map((group, gi) => (
          <div key={`${group.sender}-${gi}`}>
            {hasMultipleAgents && (
              <div className="flex items-center gap-1.5 mb-0.5 mt-1 first:mt-0">
                <div className={cn(
                  'size-3.5 rounded-full flex items-center justify-center text-white text-[6px] font-bold',
                  getAgentColor(group.sender, agentNames).initials
                )}>
                  {getAgentInitials(group.sender)}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground/70">
                  {group.sender}
                </span>
              </div>
            )}
            {group.steps.map((step) => (
              <StepItem key={step.messageId} message={step} />
            ))}
          </div>
        ))}
        {isActive && <ActivityIndicator />}
      </div>
    </div>
  );
});
