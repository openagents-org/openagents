"use client";

import { useState } from 'react';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { HumanAvatarFace } from './human-avatar-face';

export function HumanAvatar({ email, className }: { email: string; className?: string }) {
  const team = useTeamRoster();
  const url = team.find(person => person.email.toLowerCase() === email.toLowerCase())?.avatarUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <HumanAvatarFace seed={email} url={url && failedUrl !== url ? url : null} onError={() => setFailedUrl(url ?? null)} className={className} />;
}
