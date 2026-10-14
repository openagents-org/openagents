'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyMessageLink } from './copy-message-link';
import { Reply, SmilePlus } from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useT } from '@/lib/i18n';
import type { WorkspaceMessage, MessageReaction as Reaction } from '@/lib/types';
const emojis = ['👍','❤️','😂','🎉','👀','✅','🙏','🚀'];
const Context = createContext<{ rows: Record<string,Reaction[]>; update: (id:string,emoji:string,active:boolean)=>Promise<void>; enabled:boolean } | null>(null);

export function MessageReactionsProvider({ messages, children }: { messages: WorkspaceMessage[]; children: ReactNode }) {
  const { workspace } = useWorkspace();
  const me = useMe(workspace?.workspaceId);
  const [data,setData] = useState<{ key:string; rows:Record<string,Reaction[]> }>({key:'',rows:{}});
  const key = `${workspace?.workspaceId}:${me?.email}:${messages[0]?.sessionId}`;
  const current = useRef(key); current.current = key;
  const revision = useRef(0);
  const ids = JSON.stringify(messages.filter(m => (m.senderType==='human'||m.senderType==='user') && m.messageType==='chat' && !m.messageId.startsWith('optimistic-')).map(m => m.messageId));
  const enabled = !!me?.email;
  useEffect(() => {
    let active=true;
    const load=async () => {
      if (!enabled) return;
      const version=revision.current;
      const names=JSON.parse(ids) as string[];
      try {
        const rows:Record<string,Reaction[]>={};
        for (let offset=0;offset<names.length;offset+=200) Object.assign(rows,await workspaceApi.getReactions(names.slice(offset,offset+200)));
        if(active && current.current===key && revision.current===version) setData({key,rows});
      } catch { /* Keep the last confirmed reactions if refreshing fails. */ }
    };
    void load(); const timer=setInterval(load,15000);
    return () => {active=false;clearInterval(timer);};
  },[key,ids,enabled]);
  const update=useCallback(async(id:string,emoji:string,active:boolean)=> {
    ++revision.current;
    const rows=await workspaceApi.setReaction(id,emoji,active);
    ++revision.current;
    if(current.current===key) setData(previous=>({key,rows:{...(previous.key===key?previous.rows:{}),[id]:rows}}));
  },[key]);
  return <Context.Provider value={{rows:data.key===key?data.rows:{},update,enabled}}>{children}</Context.Provider>;
}

export function MessageReactions({ messageId, onReply }: {messageId:string; onReply?:()=>void}) {
  const context=useContext(Context);
  const t=useT();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  if(!context?.enabled || messageId.startsWith('optimistic-')) return null;
  const rows=context.rows[messageId] || [];
  const toggle=async(emoji:string)=> {
    if(pending.current) return;
    pending.current=true;setBusy(true);
    try {await context.update(messageId,emoji,!rows.some(row=>row.emoji===emoji&&row.mine));setOpen(false);}
    catch {toast.error(t('reactions.failed'));}
    finally {pending.current=false;setBusy(false);}
  };
  return <div className={rows.length || open ? "mt-1 flex flex-wrap items-center gap-1" : ""} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}>
    {rows.map(row=><button key={row.emoji} disabled={busy} onClick={()=>void toggle(row.emoji)} aria-pressed={row.mine} aria-label={t('reactions.count',{emoji:row.emoji,count:row.count})} className={`rounded-full border px-2 py-0.5 text-xs ${row.mine?'border-primary/40 bg-primary/10':'bg-muted/30 hover:bg-muted'}`}>{row.emoji} {row.count}</button>)}
    <div className={`absolute right-0 top-1 z-10 flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm transition-opacity ${open ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
    <button type="button" aria-label={t('reactions.add')} title={t('reactions.add')} aria-expanded={open} disabled={busy} onClick={()=>setOpen(!open)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><SmilePlus className="size-3.5" /></button>
    {onReply && <button type="button" aria-label={t('reactions.reply')} title={t('reactions.reply')} onClick={onReply} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Reply className="size-3.5" /></button>}
    <CopyMessageLink messageId={messageId} />
    </div>
    {open&&<div role="group" aria-label={t('reactions.choose')} className="flex flex-wrap gap-0.5 rounded-lg border bg-background p-1">{emojis.map(emoji=><button key={emoji} aria-label={emoji} disabled={busy} onClick={()=>void toggle(emoji)} className="rounded px-1.5 py-1 hover:bg-muted">{emoji}</button>)}</div>}
  </div>;
}
