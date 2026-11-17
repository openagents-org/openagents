'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { CodeBlock, CodeBlockContent } from '@/components/ui/code-block';
import type { WorkspaceMessage } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { ReasoningLine } from './reasoning-line';
import { TodoQueue, type Todo } from './todo-queue';
import { getStepIcon, isPlaceholderThinking, parseStepContent, type ParsedStep } from './step-parsing';

// Steps sit a level below chat messages, so their lines stay at the small size.
export const STEP_LINE = 'text-xs';

/** Icon + label for a tool call or status line. */
function StepLineContent({ parsed }: { parsed: ParsedStep }) {
  const t = useT();
  const Icon = getStepIcon(parsed);
  return (
    <>
      <TraceIcon className={cn(parsed.type === 'compacting' && 'animate-spin motion-reduce:animate-none')}>
        <Icon />
      </TraceIcon>
      {parsed.type === 'compacting' && <TraceTitle>{t('chat.vibing')}</TraceTitle>}
      {parsed.type === 'tool_call' && (
        <>
          <TraceTitle className="font-mono font-medium">{parsed.toolDisplay}</TraceTitle>
          {parsed.summary && (
            <TraceDescription className="min-w-0 shrink truncate">{parsed.summary}</TraceDescription>
          )}
        </>
      )}
      {parsed.type === 'status' && <TraceTitle title={parsed.text}>{parsed.text}</TraceTitle>}
    </>
  );
}

/**
 * One step inside a Chain of Thought: reasoning, a tool call (shadcn AI
 * Elements "Tool": its input folds out in a small Code Block) or a status line.
 * Todos render as a Queue.
 */
export const StepItem = memo(function StepItem({ message, running = false }: { message: WorkspaceMessage; running?: boolean }) {
  if (message.messageType === 'todos') {
    const todos = (message.metadata?.todos as Todo[]) || [];
    if (!todos.length) return null;
    return <TodoQueue todos={todos} active={running} className={STEP_LINE} />;
  }

  // Skip bare "thinking..." placeholders — the working indicator conveys this.
  if (isPlaceholderThinking(message)) return null;

  // Messages with messageType 'thinking' are already typed — parse as thinking directly
  const parsed: ParsedStep = message.messageType === 'thinking'
    ? { type: 'thinking', text: message.content }
    : parseStepContent(message.content);

  if (parsed.type === 'thinking') {
    return <ReasoningLine text={parsed.text || ''} running={running} className={STEP_LINE} />;
  }

  // Tool calls with arguments expand to show them.
  if (parsed.type === 'tool_call' && parsed.args) {
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine className={STEP_LINE}>
            <StepLineContent parsed={parsed} />
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">{parsed.args}</CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  return (
    <TraceLine className={STEP_LINE} status={parsed.type === 'compacting' ? 'running' : undefined}>
      <StepLineContent parsed={parsed} />
    </TraceLine>
  );
});
