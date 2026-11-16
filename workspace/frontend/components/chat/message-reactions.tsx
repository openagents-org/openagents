'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { CopyMessageLink } from './copy-message-link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Reply, SmilePlus, Trash2 } from 'lucide-react';
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

export function MessageReactions({ messageId, onReply, onRecall }: {messageId:string; onReply?:()=>void; onRecall?:()=>Promise<void>}) {
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
  return <div className={cn((rows.length || open) && 'mt-1 flex flex-wrap items-center gap-1')} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}>
    {rows.map(row=><Button key={row.emoji} variant={row.mine ? 'secondary' : 'outline'} size="xs" disabled={busy} onClick={()=>void toggle(row.emoji)} aria-pressed={row.mine} aria-label={t('reactions.count',{emoji:row.emoji,count:row.count})} className={cn('rounded-full', row.mine && 'ring-1 ring-primary/30')}>{row.emoji} {row.count}</Button>)}
    <div className={cn('absolute top-1 right-0 z-10 flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm transition-opacity', open ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100')}>
    <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t('reactions.add')} title={t('reactions.add')} aria-expanded={open} disabled={busy} onClick={()=>setOpen(!open)}><SmilePlus /></Button>
    {onRecall && <RecallMessageButton disabled={busy} onRecall={onRecall} />}
    {onReply && <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t('reactions.reply')} title={t('reactions.reply')} onClick={onReply}><Reply /></Button>}
    <CopyMessageLink messageId={messageId} />
    </div>
    {open&&<div role="group" aria-label={t('reactions.choose')} className="flex flex-wrap gap-0.5 rounded-lg border bg-background p-1">{emojis.map(emoji=><Button key={emoji} variant="ghost" size="icon-sm" aria-label={emoji} disabled={busy} onClick={()=>void toggle(emoji)}>{emoji}</Button>)}</div>}
  </div>;
}

function RecallMessageButton({ disabled, onRecall }: { disabled: boolean; onRecall: () => Promise<void> }) {
  const t = useT();
  const confirm = useConfirm();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const recall = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const accepted = await confirm({
        title: t('messageReply.confirmTitle'),
        description: t('messageReply.confirmDescription'),
        confirmText: t('messageReply.recall'),
        cancelText: t('common.cancel'),
        destructive: true,
      });
      if (accepted) await onRecall();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('messageReply.recallFailed'));
    } finally { pending.current = false; setBusy(false); }
  };
  return <Button variant="ghost" size="icon-xs" aria-label={t('messageReply.recall')} title={t('messageReply.recall')} disabled={disabled || busy} onClick={() => void recall()} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 /></Button>;
}
