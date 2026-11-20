import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import type { RoutineItem } from "@/lib/types";
import { cn } from "@/lib/utils";
export function routineNeedsAttention(r: RoutineItem) {
  return (
    r.status !== "paused" &&
    ["failed", "unanswered"].includes(r.latestRun?.status || "")
  );
}
export function RoutineStatus({ routine }: { routine: RoutineItem }) {
  const t = useT();
  const paused = routine.status === "paused";
  const attention = routineNeedsAttention(routine);
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 whitespace-nowrap text-[10px] font-normal",
        paused
          ? "text-muted-foreground"
          : attention
            ? "text-warning"
            : "text-success",
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {t(
        paused
          ? "routines.paused"
          : attention
            ? "routineHub.attention"
            : "routineHub.active",
      )}
    </Badge>
  );
}
