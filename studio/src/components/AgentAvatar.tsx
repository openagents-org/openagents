/**
 * Agent Avatar Component with automatic fallback to placeholder
 */

import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAvatar } from '@/hooks/useAvatar';
import { getInitials, getPlaceholderColor } from '@/utils/avatarUtils';
import { cn } from '@/lib/utils';

interface AgentAvatarProps {
  agentId: string;
  baseUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTooltip?: boolean;
}

const sizeClasses = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-16 text-lg',
};

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  agentId,
  baseUrl,
  size = 'md',
  className,
  showTooltip = true,
}) => {
  const { avatarUrl } = useAvatar(agentId, baseUrl);
  const initials = getInitials(agentId);
  const placeholderColor = getPlaceholderColor(agentId);

  const title = showTooltip ? agentId : undefined;

  return (
    <Avatar className={cn(sizeClasses[size], className)} title={title}>
      {avatarUrl && (
        <AvatarImage
          src={avatarUrl}
          alt={agentId}
          className="rounded-full object-cover"
        />
      )}
      <AvatarFallback
        className="rounded-full font-semibold text-white border-0"
        style={{
          background: `linear-gradient(135deg, ${placeholderColor}, ${adjustColorBrightness(placeholderColor, -20)})`,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
};

/**
 * Adjust color brightness
 */
function adjustColorBrightness(hslColor: string, amount: number): string {
  const match = hslColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return hslColor;

  const [, h, s, l] = match;
  const newL = Math.max(0, Math.min(100, parseInt(l) + amount));

  return `hsl(${h}, ${s}%, ${newL}%)`;
}
