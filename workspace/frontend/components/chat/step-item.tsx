'use client';

import { memo } from 'react';
import { ListTodo } from 'lucide-react';
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
import type { WorkspaceMessage } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { getStepIcon, isPlaceholderThinking, parseStepContent, type ParsedStep } from './step-parsing';

// Steps sit a level below chat messages, so their lines stay at the small size.
const LINE = 'text-xs';

type Todo = { content: string; status: string; assignee?: string };

const TODO_MARK: Record<string, string> = { completed: '✅', in_progress: '🔄', cancelled: '⊘' };

function TodoStep({ todos }: { todos: Todo[] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <TraceLine className={LINE}>
        <TraceIcon><ListTodo /></TraceIcon>
        <TraceTitle className="font-medium">{t('chat.todoList')}</TraceTitle>
      </TraceLine>
      <ul className="flex flex-col gap-0.5 pl-6">
        {todos.map((todo, i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs">
            <span className="shrink-0">{TODO_MARK[todo.status] ?? '⬜'}</span>
            <span className={cn(
              (todo.status === 'completed' || todo.status === 'cancelled') && 'line-through text-muted-foreground'
            )}>{todo.content}</span>
            {todo.assignee && (
              <span className="text-muted-foreground/50">→ {todo.assignee}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Icon + label for a tool call or status line. */
function StepLineContent({ parsed }: { parsed: ParsedStep }) {
  const t = useT();
  const Icon = getStepIcon(parsed);
  return (
    <>
      <TraceIcon className={cn(
        parsed.type === 'status' && 'text-success',
        parsed.type === 'compacting' && 'animate-spin motion-reduce:animate-none',
      )}>
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

export const StepItem = memo(function StepItem({ message }: { message: WorkspaceMessage }) {
  const t = useT();

  // Todos render as a compact checklist
  if (message.messageType === 'todos') {
    const todos = (message.metadata?.todos as Todo[]) || [];
    if (!todos.length) return null;
    return <TodoStep todos={todos} />;
  }

  // Skip bare "thinking..." placeholders — the working indicator conveys this.
  if (isPlaceholderThinking(message)) return null;

  // Messages with messageType 'thinking' are already typed — parse as thinking directly
  const parsed: ParsedStep = message.messageType === 'thinking'
    ? { type: 'thinking', text: message.content }
    : parseStepContent(message.content);

  // Thinking with content renders directly inline (not behind a click).
  // Bare placeholders returned above, so any thinking left here has text.
  if (parsed.type === 'thinking') {
    const Icon = getStepIcon(parsed);
    return (
      <div className="flex flex-col gap-1">
        <TraceLine className={LINE}>
          <TraceIcon className="text-warning"><Icon /></TraceIcon>
          <TraceTitle className="italic">{t('chat.thinking')}</TraceTitle>
        </TraceLine>
        <p className="whitespace-pre-wrap pl-6 text-xs leading-relaxed text-muted-foreground">
          {parsed.text}
        </p>
      </div>
    );
  }

  // Tool calls with arguments expand to show them.
  if (parsed.type === 'tool_call' && parsed.args) {
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine className={LINE}>
            <StepLineContent parsed={parsed} />
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-2.5 text-xs leading-relaxed">
            {parsed.args}
          </pre>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  }

  return (
    <TraceLine className={LINE} status={parsed.type === 'compacting' ? 'running' : undefined}>
      <StepLineContent parsed={parsed} />
    </TraceLine>
  );
});
