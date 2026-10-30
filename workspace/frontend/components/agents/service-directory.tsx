'use client';
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { DetailHeader } from '@/components/layout/app-header';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { AgentService, AgentServiceInput, TeamMember } from '@/lib/types';
import { AgentAvatar } from './agent-avatar';
import { AgentAccessSection } from '@/components/sharing/agent-access-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';

export function ServiceDirectory() {
  const t = useT();
  const { workspace, agents, setCurrentSessionId, refreshWorkspace } = useWorkspace();
  const { openView, isMobile, openMobileDetail } = useLayout();
  const me = useMe(workspace?.workspaceId);
  const owned = agents.filter(agent => me?.email && agent.ownerEmail?.toLowerCase() === me.email.toLowerCase());
  const [services, setServices] = useState<AgentService[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<AgentService | 'new' | null>(null);
  const [request, setRequest] = useState<AgentService | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setServices(await workspaceApi.listServices()); setError(false); }
    catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { let active = true; void workspaceApi.getTeam().then(value => { if (active) setTeam(value); }).catch(() => {}); return () => { active = false; }; }, []);
  const nameFor = (email: string) => team.find(person => person.email === email)?.displayName || email;
  const start = async () => {
    if (!request || busy || !content.trim()) return;
    setBusy(true);
    try {
      const result = await workspaceApi.startServiceRequest(request.id, content.trim());
      await refreshWorkspace(); setCurrentSessionId(result.channel); openView('threads');
      if (isMobile) openMobileDetail();
      setRequest(null); setContent('');
    } catch { toast.error(t('services.failed')); } finally { setBusy(false); }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <DetailHeader title={<h2 className="text-sm font-semibold">{t('services.title')}</h2>}>
      {owned.length > 0 && <Button size="sm" onClick={() => setEdit('new')}><Plus className="size-3.5" />{t('services.create')}</Button>}
    </DetailHeader>
    <div className="space-y-3 border-b px-5 py-3">
      <p className="text-sm text-muted-foreground">{t('services.subtitle')}</p>
      <p className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"><FlaskConical className="size-3.5" />{t('services.experimental')}</p>
      <div className="relative max-w-sm"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input className="pl-8" aria-label={t('services.search')} placeholder={t('services.search')} value={search} onChange={event => setSearch(event.target.value)} /></div>
    </div>
    <div className="overflow-y-auto p-5">
      {error && <Button variant="outline" onClick={() => void load()}>{t('common.retry')}</Button>}
      {!loading && !error && services.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{t('services.empty')}</p>}
      <div className="grid gap-4 xl:grid-cols-2">{services.filter(service => [service.name, service.description].some(value => value.toLowerCase().includes(search.toLowerCase()))).map(service => <article key={service.id} className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-3"><AgentAvatar name={service.agent_name} size={36} /><div><h3 className="font-semibold">{service.name}</h3><p className="text-xs text-muted-foreground">{t('services.owner')}: {nameFor(service.owner_email)}</p></div></div>
        <p className="whitespace-pre-wrap text-sm">{service.description}</p>
        <div className="flex flex-wrap gap-2">{service.example_requests.map((example, i) => <button key={i} className="rounded-full border px-2.5 py-1 text-left text-xs hover:bg-muted" onClick={() => { setRequest(service); setContent(example); }}>{example}</button>)}</div>
        {service.required_inputs && <p className="text-xs text-muted-foreground">{service.required_inputs}</p>}
        {service.request_approver_email && <p className="text-xs text-muted-foreground">{t('services.approver')}: {nameFor(service.request_approver_email)}</p>}
        <div className="mt-auto flex gap-2"><Button className="flex-1" size="sm" onClick={() => { setRequest(service); setContent(''); }}>{t('services.request')}</Button>{service.can_manage && <Button size="sm" variant="outline" onClick={() => setEdit(service)}>{t('services.edit')}</Button>}</div>
      </article>)}</div>
    </div>
    {edit && <ServiceEditor key={edit === 'new' ? 'new' : edit.id} service={edit === 'new' ? null : edit} agents={owned.map(agent => ({ name: agent.agentName, label: agent.displayName || agent.agentName }))} team={team} onClose={() => setEdit(null)} onSaved={service => { setEdit(service); void load(); }} />}
    <Dialog open={!!request} onOpenChange={value => { if (!busy && !value) setRequest(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{request?.name}</DialogTitle><DialogDescription>{request?.description}</DialogDescription></DialogHeader>
        <DialogBody><Textarea aria-label={t('services.request')} placeholder={t('services.requestPlaceholder')} value={content} onChange={event => setContent(event.target.value)} disabled={busy} /></DialogBody>
        <DialogFooter><Button onClick={() => void start()} disabled={busy || !content.trim()}>{t('services.request')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function ServiceEditor({ service, agents, team, onClose, onSaved }: {
  service: AgentService | null; agents: { name: string; label: string }[]; team: TeamMember[];
  onClose: () => void; onSaved: (service: AgentService) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<AgentServiceInput>({ agent_name: service?.agent_name || agents[0]?.name || '', name: service?.name || '', description: service?.description || '', instructions: service?.instructions || '', example_requests: service?.example_requests || [], required_inputs: service?.required_inputs || '', request_approver_email: service?.request_approver_email || null });
  const [examples, setExamples] = useState(draft.example_requests.join('\n'));
  const [busy, setBusy] = useState(false);
  const save = async () => { if (busy) return; setBusy(true); try { onSaved(await workspaceApi.saveService({ ...draft, example_requests: examples.split('\n').map(value => value.trim()).filter(Boolean) }, service?.id)); } catch { toast.error(t('services.failed')); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={value => { if (!busy && !value) onClose(); }}>
    <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{t(service ? 'services.edit' : 'services.create')}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="service-agent">{t('services.agent')}</Label><select id="service-agent" className="h-9 w-full rounded border bg-background px-2 text-sm" disabled={!!service || busy} value={draft.agent_name} onChange={e => setDraft({ ...draft, agent_name: e.target.value })}>{agents.map(agent => <option key={agent.name} value={agent.name}>{agent.label}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="service-name">{t('services.name')}</Label><Input id="service-name" value={draft.name} maxLength={120} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        {(['description', 'instructions', 'required_inputs'] as const).map(key => <div key={key} className="space-y-1.5"><Label htmlFor={`service-${key}`}>{t(key === 'required_inputs' ? 'services.inputs' : key === 'description' ? 'services.description' : 'services.instructions')}</Label><Textarea id={`service-${key}`} value={draft[key] || ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></div>)}
        <div className="space-y-1.5"><Label htmlFor="service-examples">{t('services.examples')}</Label><Textarea id="service-examples" value={examples} onChange={e => setExamples(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="service-reviewer">{t('services.approver')}</Label><select id="service-reviewer" className="h-9 w-full rounded border bg-background px-2 text-sm" value={draft.request_approver_email || ''} onChange={e => setDraft({ ...draft, request_approver_email: e.target.value || null })}><option value="">{t('services.noApproval')}</option>{team.map(person => <option key={person.email} value={person.email}>{person.displayName || person.email}</option>)}</select></div>
        {service && <div className="border-t pt-4"><AgentAccessSection resourceKind="service" agentName={service.id} displayName={service.name} /></div>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t('common.done')}</Button><Button disabled={busy || !draft.name.trim() || !draft.agent_name} onClick={() => void save()}>{t('services.save')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
