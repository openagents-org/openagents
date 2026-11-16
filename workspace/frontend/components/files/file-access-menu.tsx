'use client';

import { Globe, Lock, MessagesSquare, MoreHorizontal, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import type { ArtifactVisibility, WorkspaceFile } from '@/lib/types';

/* ── Sharing ─────────────────────────────────────────────────────────────────
 * Permission model v1.1: the hover "more" menu on a row or tile. Share… opens
 * the share dialog; the owner (can_manage) also gets the visibility flips
 * right here so the common case is one click. */
export function FileAccessMenu({
  file, displayName, onShare, onVisibility, className,
}: {
  file: WorkspaceFile;
  displayName: string;
  onShare: () => void;
  onVisibility: (visibility: ArtifactVisibility | null) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('artifactAccess.moreActions', { name: displayName })}
          className={className}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onShare}>
          <Share2 />
          {t('artifactAccess.share')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {file.canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
            {file.visibility !== 'public' && (
              <DropdownMenuItem onSelect={() => onVisibility('public')}>
                <Globe />
                {t('artifactAccess.makePublic')}
              </DropdownMenuItem>
            )}
            {file.visibility !== 'private' && (
              <DropdownMenuItem onSelect={() => onVisibility('private')}>
                <Lock />
                {t('artifactAccess.makePrivate')}
              </DropdownMenuItem>
            )}
            {file.channelName && file.visibility !== null && (
              <DropdownMenuItem onSelect={() => onVisibility(null)}>
                <MessagesSquare />
                {t('artifactAccess.inheritFromThread')}
              </DropdownMenuItem>
            )}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
