'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Check, ChevronDown, ChevronRight, Folder, FolderInput, FolderOpen, FolderPlus, Folders, Info, List, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ThreadProject, ThreadProjects } from './use-thread-projects';

const COLORS = ['text-indigo-500', 'text-emerald-500', 'text-amber-500', 'text-rose-500', 'text-sky-500'];
export const projectColor = (color: number) => COLORS[((color % COLORS.length) + COLORS.length) % COLORS.length];
const PROJECT_DRAG_TYPE = 'application/x-openagents-project';
const DRAG_TYPE = 'application/x-openagents-thread';
export const startThreadDrag = (event: React.DragEvent, id: string) => { event.dataTransfer.setData(DRAG_TYPE, id); event.dataTransfer.effectAllowed = 'move'; };

export function ThreadProjectBar({ model, counts, onCreate }: { model: ThreadProjects; counts: Record<string, number>; onCreate: () => void }) {
  const t = useT();
  const project = model.projects.find(p => p.id === model.selected);
  const label = project?.name || t(model.selected === 'unorganized' ? 'threadProjects.unorganized' : 'threadProjects.all');
  return <div className="min-w-0 flex-1">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="w-full min-w-0 justify-start gap-1.5 px-2 text-xs"><Folders className={cn('shrink-0', project ? projectColor(project.color) : 'text-muted-foreground')} /><span className="truncate">{label}</span><ChevronDown className="ml-0.5 size-3 shrink-0 text-muted-foreground" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => model.select('all')}><Folders />{t('threadProjects.all')}{model.selected === 'all' && <Check className="ml-auto" />}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {model.projects.map(p => <DropdownMenuItem key={p.id} onSelect={() => model.select(p.id)}><Folder className={projectColor(p.color)} /><span className="truncate">{p.name}</span><span className="ml-auto text-xs text-muted-foreground">{counts[p.id] || 0}</span>{model.selected === p.id && <Check />}</DropdownMenuItem>)}
        <DropdownMenuItem onSelect={() => model.select('unorganized')}><FolderOpen />{t('threadProjects.unorganized')}<span className="ml-auto text-xs text-muted-foreground">{counts.unorganized || 0}</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}><FolderPlus />{t('threadProjects.create')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

  </div>;
}

export function ThreadProjectLayoutToggle({ grouped, onChange }: { grouped: boolean; onChange: (grouped: boolean) => void }) {
  const t = useT();
  return <div role="group" aria-label={t('threadProjects.layout')} className="flex shrink-0 gap-0.5 rounded-lg bg-muted/70 p-0.5">
    <Button size="sm" variant="ghost" aria-pressed={grouped} title={t('threadProjects.grouped')} onClick={() => onChange(true)} className={cn('h-6 gap-1.5 rounded-md px-2 text-xs shadow-none', grouped ? 'bg-background text-foreground shadow-xs hover:bg-background' : 'text-muted-foreground')}><Folders className="size-3.5" />{t('threadProjects.projectsView')}</Button>
    <Button size="sm" variant="ghost" aria-pressed={!grouped} title={t('threadProjects.flat')} onClick={() => onChange(false)} className={cn('h-6 gap-1.5 rounded-md px-2 text-xs shadow-none', !grouped ? 'bg-background text-foreground shadow-xs hover:bg-background' : 'text-muted-foreground')}><List className="size-3.5" />{t('threads.title')}</Button>
  </div>;
}

export function ThreadProjectGroup({ project, count, unread, collapsed, onToggle, onDrop, onRename, onRemove, onReorder, onMoveUp, onMoveDown, children }: {
  project: ThreadProject; count: number; unread: number; collapsed: boolean;
  onToggle: () => void; onDrop: (thread: string) => void;
  onRename?: () => void; onRemove?: () => void;
  onReorder?: (id: string, placement: 'before' | 'after') => void;
  onMoveUp?: () => void; onMoveDown?: () => void; children: ReactNode;
}) {
  const t = useT();
  const header = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [placement, setPlacement] = useState<'before' | 'after' | null>(null);
  useEffect(() => {
    const clear = () => { setOver(false); setPlacement(null); };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  return <section className={cn('relative mb-2 rounded-xl pb-1', over && 'bg-primary/5 ring-1 ring-primary/30 ring-inset', placement && 'before:pointer-events-none before:absolute before:inset-x-1 before:z-10 before:h-0.5 before:rounded-full before:bg-primary', placement === 'before' ? 'before:top-0' : placement === 'after' ? 'before:bottom-0' : '')}
    onDragOver={event => {
      if (event.dataTransfer.types.includes(PROJECT_DRAG_TYPE) && onReorder) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
        const rect = header.current?.getBoundingClientRect();
        setPlacement(rect && event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
        setOver(false);
      } else if (event.dataTransfer.types.includes(DRAG_TYPE)) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(true); setPlacement(null);
      }
    }}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { setOver(false); setPlacement(null); } }}
    onDrop={event => {
      const draggedProject = event.dataTransfer.getData(PROJECT_DRAG_TYPE);
      const thread = event.dataTransfer.getData(DRAG_TYPE);
      if (draggedProject && onReorder) { event.preventDefault(); onReorder(draggedProject, placement || 'before'); }
      else if (thread) { event.preventDefault(); onDrop(thread); }
      setOver(false); setPlacement(null);
    }}>
    <div ref={header} className="flex items-center gap-1 px-1 pt-2 pb-1">
      {onReorder && <button type="button" draggable
        aria-label={t('threadProjects.drag', { name: project.name })} title={t('threadProjects.dragHint')}
        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
        onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id); event.dataTransfer.effectAllowed = 'move'; if (header.current) event.dataTransfer.setDragImage(header.current, 12, 12); }}
        onKeyDown={event => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); if (event.key === 'ArrowUp') onMoveUp?.(); else onMoveDown?.(); } }}
      ><GripVertical className="size-3.5" /></button>}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs font-semibold hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={!collapsed} onClick={onToggle}>
        {collapsed ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-3 shrink-0 text-muted-foreground" />}
        <Folder className={cn('size-4 shrink-0', projectColor(project.color))} /><span className="truncate">{project.name}</span><span className="font-normal tabular-nums text-muted-foreground">{count}</span>
        {unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground" aria-label={t('threadProjects.unread', { count: unread })}>{unread}</span>}
      </button>
      {onRename && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('threadProjects.actions')}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onMoveUp} disabled={!onMoveUp}><ArrowUp />{t('threadProjects.moveUp')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onMoveDown} disabled={!onMoveDown}><ArrowDown />{t('threadProjects.moveDown')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRename}><Pencil />{t('common.rename')}</DropdownMenuItem><DropdownMenuItem onSelect={onRemove}><Trash2 />{t('threadProjects.remove')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>}
    </div>
    {!collapsed && <div className="ml-2 border-l border-border/60 pl-1">{count ? children : <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">{t('threadProjects.empty')}</p>}</div>}
  </section>;
}

export function MoveToProjectMenu({ model, threadId, onCreate }: { model: ThreadProjects; threadId: string; onCreate: () => void }) {
  const t = useT();
  return <DropdownMenuSub><DropdownMenuSubTrigger onClick={event => event.stopPropagation()}><FolderInput />{t('threadProjects.move')}</DropdownMenuSubTrigger><DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto" onClick={event => event.stopPropagation()}>
    {model.projects.map(p => <DropdownMenuItem key={p.id} onSelect={() => model.move(threadId, p.id)}><Folder className={projectColor(p.color)} /><span className="truncate">{p.name}</span>{model.assignments[threadId] === p.id && <Check className="ml-auto" />}</DropdownMenuItem>)}
    <DropdownMenuItem onSelect={() => model.move(threadId, null)}><FolderOpen />{t('threadProjects.unorganized')}{!model.assignments[threadId] && <Check className="ml-auto" />}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={onCreate}><FolderPlus />{t('threadProjects.create')}</DropdownMenuItem>
  </DropdownMenuSubContent></DropdownMenuSub>;
}

export function ProjectPersonalHint() {
  const t = useT();
  return <div className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground" title={t('threadProjects.personalHint')}><Info className="size-3 shrink-0" />{t('threadProjects.personal')}</div>;
}
