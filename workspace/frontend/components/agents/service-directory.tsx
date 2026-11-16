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
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel } from '@/components/ui/field';
import { Dialog, DialogContent, DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';

/** Radix rejects '' as an item value, so "no approval" needs a sentinel. */
const NO_APPROVER = '__none__';

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
    <DetailHeader titleInHeader title={<div className="flex min-w-0 items-center gap-2">
      <h2 className="truncate text-sm font-semibold">{t('services.title')}</h2>
      {owned.length > 0 && <Button size="sm" className="ml-1 shrink-0" onClick={() => setEdit('new')}><Plus data-icon="inline-start" />{t('services.create')}</Button>}
    </div>} />
    <div className="flex flex-col gap-3 border-b px-5 py-3">
      <p className="text-sm text-muted-foreground">{t('services.subtitle')}</p>
      <Badge variant="warning" className="self-start"><FlaskConical data-icon="inline-start" />{t('services.experimental')}</Badge>
      <InputGroup className="max-w-sm"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label={t('services.search')} placeholder={t('services.search')} value={search} onChange={event => setSearch(event.target.value)} /></InputGroup>
    </div>
    <div className="overflow-y-auto p-5">
      {error && <Button variant="outline" onClick={() => void load()}>{t('common.retry')}</Button>}
      {!loading && !error && services.length === 0 && <Empty><EmptyHeader><EmptyDescription>{t('services.empty')}</EmptyDescription></EmptyHeader></Empty>}
      <div className="grid gap-4 xl:grid-cols-2">{services.filter(service => [service.name, service.description].some(value => value.toLowerCase().includes(search.toLowerCase()))).map(service => <article key={service.id} className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-3"><AgentAvatar name={service.agent_name} size={36} /><div><h3 className="font-semibold">{service.name}</h3><p className="text-xs text-muted-foreground">{t('services.owner')}: {nameFor(service.owner_email)}</p></div></div>
        <p className="whitespace-pre-wrap text-sm">{service.description}</p>
        <div className="flex flex-wrap gap-2">{service.example_requests.map((example, i) => <Button key={i} variant="outline" size="xs" className="h-auto max-w-full rounded-full py-1 text-left whitespace-normal" onClick={() => { setRequest(service); setContent(example); }}>{example}</Button>)}</div>
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
      <DialogBody className="flex flex-col gap-4">
        <Field><FieldLabel htmlFor="service-agent">{t('services.agent')}</FieldLabel><Select disabled={!!service || busy} value={draft.agent_name || undefined} onValueChange={value => setDraft({ ...draft, agent_name: value })}><SelectTrigger id="service-agent" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{agents.map(agent => <SelectItem key={agent.name} value={agent.name}>{agent.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="service-name">{t('services.name')}</FieldLabel><Input id="service-name" value={draft.name} maxLength={120} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
        {(['description', 'instructions', 'required_inputs'] as const).map(key => <Field key={key}><FieldLabel htmlFor={`service-${key}`}>{t(key === 'required_inputs' ? 'services.inputs' : key === 'description' ? 'services.description' : 'services.instructions')}</FieldLabel><Textarea id={`service-${key}`} value={draft[key] || ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}
        <Field><FieldLabel htmlFor="service-examples">{t('services.examples')}</FieldLabel><Textarea id="service-examples" value={examples} onChange={e => setExamples(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="service-reviewer">{t('services.approver')}</FieldLabel><Select value={draft.request_approver_email || NO_APPROVER} onValueChange={value => setDraft({ ...draft, request_approver_email: value === NO_APPROVER ? null : value })}><SelectTrigger id="service-reviewer" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={NO_APPROVER}>{t('services.noApproval')}</SelectItem>{team.map(person => <SelectItem key={person.email} value={person.email}>{person.displayName || person.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        {service && <div className="border-t pt-4"><AgentAccessSection resourceKind="service" agentName={service.id} displayName={service.name} /></div>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t('common.done')}</Button><Button disabled={busy || !draft.name.trim() || !draft.agent_name} onClick={() => void save()}>{t('services.save')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
