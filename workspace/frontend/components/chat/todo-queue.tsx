'use client';

import type { ReactNode } from 'react';
import { Circle, CircleCheck, CircleDot, CircleSlash, ListChecks, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { useT } from '@/lib/i18n';

export type Todo = { content: string; status: string; assignee?: string };

const isDone = (todo: Todo) => todo.status === 'completed' || todo.status === 'cancelled';

function TodoIcon({ status }: { status: string }) {
  if (status === 'completed') return <CircleCheck />;
  if (status === 'cancelled') return <CircleSlash />;
  if (status === 'in_progress') return <CircleDot />;
  return <Circle />;
}

function TodoLine({ todo, active, className }: { todo: Todo; active: boolean; className?: string }) {
  return (
    <TraceLine
      className={className}
      status={todo.status === 'in_progress' && active ? 'running' : todo.status === 'cancelled' ? 'pending' : undefined}
    >
      <TraceIcon><TodoIcon status={todo.status} /></TraceIcon>
      <TraceTitle className={cn(todo.status === 'cancelled' && 'line-through')}>{todo.content}</TraceTitle>
      {todo.assignee && <TraceDescription>→ {todo.assignee}</TraceDescription>}
    </TraceLine>
  );
}

function TodoSection({ icon, title, todos, active, defaultOpen, className }: {
  icon: ReactNode;
  title: string;
  todos: Todo[];
  active: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine className={className}>
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {todos.map((todo, i) => <TodoLine key={i} todo={todo} active={active} className={className} />)}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/**
 * The agent's to-do list (shadcn AI Elements "Queue"): what is left, open by
 * default, and what is done, folded. The item in progress shimmers while the
 * agent is still working.
 */
export function TodoQueue({ todos, active, className }: { todos: Todo[]; active: boolean; className?: string }) {
  const t = useT();
  const left = todos.filter((todo) => !isDone(todo));
  const done = todos.filter(isDone);

  return (
    <Trace>
      {left.length > 0 && (
        <TodoSection
          icon={<ListTodo />}
          title={t('chat.todoLeft', { count: left.length })}
          todos={left}
          active={active}
          defaultOpen
          className={className}
        />
      )}
      {done.length > 0 && (
        <TodoSection
          icon={<ListChecks />}
          title={t('chat.todoDone', { count: done.length })}
          todos={done}
          active={active}
          className={className}
        />
      )}
    </Trace>
  );
}
