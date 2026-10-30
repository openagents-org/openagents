"use client";

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { User } from 'lucide-react';
import { humanColor } from '@/lib/human-color';
import { useTeamRoster } from '@/hooks/use-team-roster';

export function HumanAvatar({ email, className }: { email: string; className?: string }) {
  const team = useTeamRoster();
  const url = team.find(person => person.email.toLowerCase() === email.toLowerCase())?.avatarUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={cn("flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full", className)} style={{ backgroundColor: humanColor(email) }} aria-hidden="true">
    {url && failedUrl !== url ? <img src={url} alt="" className="size-full object-cover" onError={() => setFailedUrl(url)} /> : <User className="size-3.5 text-zinc-700" />}
  </span>;
}
