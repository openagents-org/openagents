'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface NewSessionButtonProps {
  isCollapsed?: boolean;
  onNewSession: () => void;
}

export function NewSessionButton({ isCollapsed = false, onNewSession }: NewSessionButtonProps) {
  const t = useT();
  const buttonContent = (
    <Button
      onClick={onNewSession}
      className={cn(
        'h-10 bg-linear-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white shadow-lg text-sm transition-all rounded-full px-4 mb-5.5',
        'dark:from-purple-950 dark:to-purple-800',
        isCollapsed ? 'size-10 p-0 justify-center' : 'w-full justify-start gap-1.5 lg:gap-2'
      )}
      size="sm"
    >
      {!isCollapsed && <span className="font-semibold">{t('sessions.new')}</span>}
      <Plus className={cn('size-3 lg:size-4', isCollapsed ? 'size-4' : 'ms-auto size-3')} />
    </Button>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex justify-center">{buttonContent}</div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{t('sessions.new')}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return buttonContent;
}
