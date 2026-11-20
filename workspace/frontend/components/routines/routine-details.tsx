"use client";
import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Hash,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { useT, useFormatters } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { RoutineDialog } from "./routine-dialog";
import { RoutineStatus } from "./routine-status";
import { useRoutineFormat } from "./use-routine-format";
import type { RoutineItem, RoutineRun } from "@/lib/types";
import { routineErrorMessage } from "./routine-error";

export function RoutineDetails({
  routine,
  onClose,
  onOpenThread,
  onEditInThread,
  onLinkThread,
}: {
  routine: RoutineItem;
  onClose: () => void;
  onOpenThread: (r: RoutineItem, background?: boolean) => void;
  onEditInThread: (r: RoutineItem) => void;
  onLinkThread: (r: RoutineItem) => void;
}) {
  const t = useT();
  const { formatSchedule, timeUntil } = useRoutineFormat();
  const { formatDateTime } = useFormatters();
  const {
    agents,
    sessions,
    workspace,
    updateRoutine,
    createRoutine,
    refreshRoutines,
  } = useWorkspace();
  const [tab, setTab] = useState("overview");
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RoutineItem | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const owner = routine.createdBy.replace(/^openagents:/, "");
  const source = sessions.find(
    (s) => s.sessionId === routine.sourceChannelName,
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await workspaceApi.routineRuns(routine.id);
        if (active) {
          setRuns(data.runs);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    setRuns([]);
    setLoading(true);
    setExpanded(null);
    setTab("overview");
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [routine.id, workspace?.workspaceId]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refreshRoutines();
    } catch (err) {
      toast.error(routineErrorMessage(err, t("routines.saveFailed")));
    } finally {
      setBusy(false);
    }
  };
  const showRun = (run: RoutineRun) => {
    setTab("activity");
    setExpanded(run.id);
  };
  return (
    <aside
      className="flex h-full w-full shrink-0 flex-col border-l bg-background md:w-80"
      aria-label={t("routines.title")}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4 text-muted-foreground" />
          {t("routines.title")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <span className="rounded-lg border bg-muted p-2 text-muted-foreground">
              <CalendarClock className="size-4" />
            </span>
            <RoutineStatus routine={routine} />
          </div>
          <h2 className="mt-4 text-lg leading-snug font-semibold tracking-tight">
            {routine.name}
          </h2>
          {routine.sourceChannelName ? (
            <button
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onOpenThread(routine)}
            >
              <Hash className="size-3" />
              {source?.title || routine.sourceChannelName}
              <ChevronRight className="size-3" />
            </button>
          ) : (
            <Button
              variant="link"
              size="sm"
              className="px-0 text-xs"
              onClick={() => onLinkThread(routine)}
            >
              {t("routineHub.linkThread")}
            </Button>
          )}
          <div className="my-5 flex gap-2">
            <Button
              className="flex-1"
              size="sm"
              disabled={busy || routine.status !== "active"}
              onClick={() =>
                void act(async () => {
                  await workspaceApi.runRoutine(routine.id);
                  toast.success(t("routineHub.queued"));
                })
              }
            >
              <Play />
              {t("routineHub.runNow")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  updateRoutine(routine.id, {
                    status: routine.status === "paused" ? "active" : "paused",
                  }),
                )
              }
            >
              {routine.status === "paused" ? <Play /> : <Pause />}
              {t(
                routine.status === "paused"
                  ? "routines.resume"
                  : "routines.pause",
              )}
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="border-b px-5 pb-2">
          <TabsList>
            <TabsTrigger value="overview">
              {t("routineHub.overview")}
            </TabsTrigger>
            <TabsTrigger value="activity">
              {t("routineHub.activity")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "overview" && (
          <div className="space-y-5 px-5 py-5">
            <dl className="space-y-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("routineHub.schedule")}
                </dt>
                <dd className="text-right">{formatSchedule(routine)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("routineHub.owner")}
                </dt>
                <dd className="flex items-center gap-1.5">
                  <AgentAvatar name={owner} size={18} />
                  {agents.find((a) => a.agentName === owner)?.displayName ||
                    owner}
                </dd>
              </div>
            </dl>
            {routine.status === "active" && (
              <p className="text-xs text-muted-foreground">
                {t("routines.nextRun", {
                  time: timeUntil(routine.nextFiresAt),
                })}
              </p>
            )}
            <section>
              <h3 className="mb-2 text-xs font-medium">
                {t("routineHub.instructions")}
              </h3>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {routine.context || routine.message}
              </p>
              {routine.sourceChannelName && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2 h-auto px-0 text-xs"
                  onClick={() => onEditInThread(routine)}
                >
                  {t("routineHub.editInThread")}
                  <ChevronRight />
                </Button>
              )}
            </section>
          </div>
        )}
        <section className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium">
              {t(
                tab === "overview"
                  ? "routineHub.recent"
                  : "routineHub.activity",
              )}
            </h3>
            {tab === "overview" && runs.length > 0 && (
              <Button
                variant="link"
                size="xs"
                onClick={() => setTab("activity")}
              >
                {t("routineHub.viewAll")}
              </Button>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {t("routineHub.runsFailed")}
            </p>
          ) : loading ? (
            <p className="text-xs text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : !runs.length ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("routineHub.noRuns")}
            </p>
          ) : (
            (tab === "overview" ? runs.slice(0, 3) : runs).map((run) => (
              <div key={run.id} className="border-b last:border-0">
                <button
                  className="flex w-full items-start gap-2 rounded-md py-3 text-left hover:bg-muted"
                  onClick={() =>
                    tab === "overview"
                      ? showRun(run)
                      : setExpanded(expanded === run.id ? null : run.id)
                  }
                  aria-expanded={tab === "activity" && expanded === run.id}
                >
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${run.status === "failed" || run.status === "unanswered" ? "bg-warning" : "bg-muted-foreground"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs font-medium">
                      {t(`routineHub.${run.status}`)}
                    </strong>
                    <time className="mt-1 block text-[11px] text-muted-foreground">
                      {formatDateTime(run.started_at)}
                    </time>
                  </span>
                  <ChevronRight className="size-3 text-muted-foreground" />
                </button>
                {tab === "activity" && expanded === run.id && (
                  <p className="pb-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {run.summary || t("routineHub.waiting")}
                  </p>
                )}
              </div>
            ))
          )}
          <Button
            variant="link"
            size="sm"
            className="mt-3 h-auto px-0 text-xs"
            onClick={() => onOpenThread(routine, true)}
          >
            {t("routineHub.background")}
            <ChevronRight />
          </Button>
        </section>
        <div className="flex gap-2 border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setEditing(routine)}
          >
            <Pencil />
            {t("routines.edit")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            aria-label={t("routines.cancel")}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("routineHub.deleteConfirm")))
                void act(async () => {
                  await workspaceApi.cancelRoutine(routine.id);
                  onClose();
                });
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {editing && (
        <RoutineDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          agents={agents}
          routine={editing}
          onCreateRoutine={createRoutine}
          onUpdateRoutine={updateRoutine}
        />
      )}
    </aside>
  );
}
