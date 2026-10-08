'use client';
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { IssueAvatar } from './issue-ui';
import {
  insertIssueMention,
  mentionQuery,
  type IssueMention,
} from './issue-mentions';

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  mentions: IssueMention[];
  inlineSuggestions?: boolean;
};

export function IssueMentionInput({
  value,
  onValueChange,
  mentions,
  inlineSuggestions = false,
  onKeyDown,
  onSelect,
  onBlur,
  ...props
}: Props) {
  const t = useT();
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [range, setRange] = useState<ReturnType<typeof mentionQuery>>(null);
  const [index, setIndex] = useState(0);
  const items = range
    ? mentions
        .filter((m) =>
          `${m.name} ${m.token}`
            .toLocaleLowerCase()
            .includes(range.query.toLocaleLowerCase()),
        )
        .slice(0, 30)
    : [];
  const active = Math.min(index, Math.max(0, items.length - 1));
  const open = !!range && !props.disabled && !props.readOnly;
  function detect(element: HTMLTextAreaElement) {
    setRange(
      element.selectionStart === element.selectionEnd
        ? mentionQuery(element.value, element.selectionStart)
        : null,
    );
    setIndex(0);
  }
  useEffect(() => {
    if (!value) setRange(null);
  }, [value]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  function insert(option: IssueMention) {
    if (!range) return;
    const result = insertIssueMention(value, range, option);
    if (props.maxLength && result.value.length > props.maxLength) return;
    onValueChange(result.value);
    setRange(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(result.cursor, result.cursor);
      setRange(null);
    });
  }
  return (
    <div className="relative min-w-0">
      <Textarea
        {...props}
        ref={input}
        value={value}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && items.length ? `${listId}-${active}` : undefined
        }
        onChange={(e) => {
          onValueChange(e.target.value);
          detect(e.target);
        }}
        onSelect={(e) => {
          detect(e.currentTarget);
          onSelect?.(e);
        }}
        onBlur={(e) => {
          setRange(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setRange(null);
              return;
            }
            if (
              items.length &&
              (e.key === 'ArrowDown' || e.key === 'ArrowUp')
            ) {
              e.preventDefault();
              setIndex(
                (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) %
                  items.length,
              );
              return;
            }
            if (items.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              insert(items[active]);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <div
          className={cn(
            'z-50 w-full max-w-sm overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
            inlineSuggestions
              ? 'relative mt-2'
              : 'absolute bottom-full left-0 mb-2',
          )}
        >
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground">
            {t('issues.mentionPeopleAndAgents')}
          </div>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={t('issues.mentionPeopleAndAgents')}
            className="max-h-52 overflow-y-auto p-1"
          >
            {items.map((option, i) => (
              <button
                key={option.source}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs',
                  i === active && 'bg-accent',
                )}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insert(option)}
                onMouseEnter={() => setIndex(i)}
              >
                <IssueAvatar
                  name={option.name}
                  source={option.source}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {option.name}
                  </span>
                  {(option.kind === 'agent' || option.token.includes('@')) && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.token}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t(
                    option.kind === 'human'
                      ? 'issues.mentionPerson'
                      : 'issues.mentionAgent',
                  )}
                </span>
              </button>
            ))}
            {!items.length && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {t('issues.noMentionMatches')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
