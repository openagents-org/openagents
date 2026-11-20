"use client";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Hash,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { useLayout } from "@/components/layout/layout-context";
import { useT, useFormatters } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { cn } from "@/lib/utils";
import { RoutineDetails } from "./routine-details";
import { RoutineStatus, routineNeedsAttention } from "./routine-status";
import { useRoutineFormat } from "./use-routine-format";
import { useRoutines } from "./use-routines";
import { useRoutineNavigation } from "./use-routine-navigation";
import type { RoutineItem } from "@/lib/types";

export function RoutineList() {
  const t = useT();
  const { formatDateTime } = useFormatters();
  const { sessions, agents, updateRoutine } = useWorkspace();
  const { routines, loading, error, refreshRoutines } = useRoutines();
  const { selectedRoutineId, setSelectedRoutineId, isMobile } = useLayout();
  const { openConversation, openRoutineThread, editInThread } =
    useRoutineNavigation();
  const { formatSchedule } = useRoutineFormat();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [linking, setLinking] = useState<RoutineItem | null>(null);
  const [channel, setChannel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const conversations = sessions.filter(
    (s) =>
      !s.sessionId.startsWith("dm:") &&
      !/^routines?:/.test(s.sessionId) &&
      s.status !== "deleted",
  );
  const matches = (r: RoutineItem, value: string) =>
    value === "all" ||
    (value === "paused"
      ? r.status === "paused"
      : value === "attention"
        ? routineNeedsAttention(r)
        : r.status === "active" && !routineNeedsAttention(r));
  const visible = routines.filter(
    (r) =>
      matches(r, filter) &&
      `${r.name} ${r.createdBy} ${sessions.find((s) => s.sessionId === r.sourceChannelName)?.title || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const groups = useMemo(() => {
    const result = new Map<string, RoutineItem[]>();
    for (const r of visible) {
      const key = r.sourceChannelName || "";
      result.set(key, [...(result.get(key) || []), r]);
    }
    return [...result].sort(([a], [b]) =>
      (
        sessions.find((s) => s.sessionId === a)?.title ||
        a ||
        "\uffff"
      ).localeCompare(
        sessions.find((s) => s.sessionId === b)?.title || b || "\uffff",
      ),
    );
  }, [visible, sessions]);
  const current = routines.find((r) => r.id === selectedRoutineId);
  const closeDialog = () => {
    setNewOpen(false);
    setLinking(null);
  };
  const submitDialog = async () => {
    if (!channel || saving) return;
    if (!linking) {
      openConversation(channel, prompt.trim() || t("routineHub.newPrompt"));
      setSelectedRoutineId(null);
      closeDialog();
      return;
    }
    setSaving(true);
    try {
      await updateRoutine(linking.id, { source_channel: channel });
      closeDialog();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("routines.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex h-full min-w-0 bg-background">
      <main
        className={cn(
          "min-w-0 flex-1 overflow-y-auto",
          current && isMobile && "hidden",
        )}
      >
        <div className="mx-auto max-w-6xl px-5 py-7 lg:px-9">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("routineHub.heading")}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("routineHub.description")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setChannel("");
                setPrompt("");
                setNewOpen(true);
              }}
            >
              <Plus />
              {t("routines.createShort")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
            <div className="flex flex-wrap gap-1">
              {(["all", "attention", "active", "paused"] as const).map(
                (value) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground",
                      filter === value &&
                        "border-border bg-muted text-foreground",
                    )}
                  >
                    {t(
                      value === "paused"
                        ? "routines.paused"
                        : `routineHub.${value}`,
                    )}
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {routines.filter((r) => matches(r, value)).length}
                    </span>
                  </button>
                ),
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  aria-label={t("routineHub.search")}
                  placeholder={t("routineHub.search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 w-44 pl-8 text-xs"
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.refresh")}
                onClick={() =>
                  void refreshRoutines().catch(() =>
                    toast.error(t("routineHub.loadFailed")),
                  )
                }
              >
                <RefreshCw />
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {t("routineHub.loadFailed")}
            </p>
          )}
          <div className="my-5 flex justify-between text-xs text-muted-foreground">
            <span className="text-[10px] tracking-wider">
              {t("routineHub.groupBy")}
            </span>
            <span>{t("routineHub.count", { count: visible.length })}</span>
          </div>
          {loading && !routines.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : !visible.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t(routines.length ? "routineHub.noMatches" : "routineHub.empty")}
            </p>
          ) : (
            groups.map(([id, rows]) => (
              <section key={id} className="mb-7">
                <header className="mb-2.5 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Hash className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {id
                        ? sessions.find((s) => s.sessionId === id)?.title || id
                        : t("routineHub.unlinked")}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {rows.length}
                    </span>
                  </span>
                  {id && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => openRoutineThread(rows[0])}
                    >
                      {t("routineHub.openThread")}
                      <ArrowRight />
                    </Button>
                  )}
                </header>
                <div className="overflow-hidden rounded-lg border">
                  {rows.map((r) => {
                    const owner = r.createdBy.replace(/^openagents:/, "");
                    return (
                      <article
                        key={r.id}
                        className={cn(
                          "border-b last:border-0 hover:bg-muted/40",
                          r.id === current?.id &&
                            "bg-muted/50 shadow-[inset_3px_0_0_var(--foreground)]",
                        )}
                      >
                        <button
                          className="flex w-full items-start gap-3 px-4 pt-4 pb-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          onClick={() => setSelectedRoutineId(r.id)}
                          aria-pressed={current?.id === r.id}
                        >
                          <span className="rounded-lg border p-2 text-muted-foreground">
                            <CalendarClock className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-sm font-medium">
                              {r.name}
                            </strong>
                            <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                              {r.latestRun
                                ? `${formatDateTime(r.latestRun.started_at)} · ${r.latestRun.summary || t(`routineHub.${r.latestRun.status}`)}`
                                : r.lastFiredAt
                                  ? formatDateTime(r.lastFiredAt)
                                  : t("routineHub.pending")}
                            </span>
                          </span>
                          <RoutineStatus routine={r} />
                          <ChevronRight className="mt-1 size-3 shrink-0 text-muted-foreground" />
                        </button>
                        <div className="flex flex-wrap items-center justify-between gap-2 pr-4 pb-3 pl-[60px]">
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <AgentAvatar name={owner} size={16} />
                            {agents.find((a) => a.agentName === owner)
                              ?.displayName || owner}
                            <span>·</span>
                            {formatSchedule(r)}
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="ml-auto text-muted-foreground"
                            onClick={() =>
                              r.sourceChannelName
                                ? openRoutineThread(r)
                                : (setLinking(r), setChannel(""))
                            }
                          >
                            <MessageSquare />
                            {t(
                              r.sourceChannelName
                                ? "routineHub.openThread"
                                : "routineHub.linkThread",
                            )}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
      {current && (
        <RoutineDetails
          key={current.id}
          routine={current}
          onClose={() => setSelectedRoutineId(null)}
          onOpenThread={openRoutineThread}
          onEditInThread={editInThread}
          onLinkThread={(r) => {
            setLinking(r);
            setChannel("");
          }}
        />
      )}
      <Dialog
        open={newOpen || !!linking}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(linking ? "routineHub.linkThread" : "routines.create")}
            </DialogTitle>
            <DialogDescription>
              {t(linking ? "routineHub.linkHint" : "routineHub.newDescription")}
            </DialogDescription>
          </DialogHeader>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger
              aria-label={t("routineHub.chooseThread")}
              className="w-full"
            >
              <SelectValue placeholder={t("routineHub.chooseThread")} />
            </SelectTrigger>
            <SelectContent>
              {conversations.map((s) => (
                <SelectItem key={s.sessionId} value={s.sessionId}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!conversations.length && (
            <p className="text-sm text-muted-foreground">
              {t("routineHub.noThreads")}
            </p>
          )}
          {!linking && (
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-label={t("routines.taskLabel")}
              placeholder={t("routineHub.newPrompt")}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!channel || saving}
              onClick={() => void submitDialog()}
            >
              {t(linking ? "common.save" : "routineHub.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
