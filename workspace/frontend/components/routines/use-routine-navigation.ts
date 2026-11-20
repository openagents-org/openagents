"use client";
import { useWorkspace } from "@/lib/workspace-context";
import { useLayout } from "@/components/layout/layout-context";
import { draftStore } from "@/components/chat/chat-message-cache";
import { prefillComposer } from "@/components/chat/composer-prefill";
import { useT } from "@/lib/i18n";
import type { RoutineItem } from "@/lib/types";

export function useRoutineNavigation() {
  const { setCurrentSessionId, currentSessionId } = useWorkspace();
  const { openView, openMobileDetail, setSelectedRoutineId } = useLayout();
  const t = useT();
  const openConversation = (channel: string, draft?: string) => {
    if (draft) {
      const existing = draftStore[channel] || "";
      const combined = existing ? `${existing}\n\n${draft}` : draft;
      draftStore[channel] = combined;
      if (currentSessionId === channel) prefillComposer(combined);
    }
    setCurrentSessionId(channel);
    openView("threads");
    openMobileDetail();
  };
  const openRoutineThread = (routine: RoutineItem, background = false) => {
    const channel = background
      ? routine.channelName
      : routine.sourceChannelName;
    if (!channel) return;
    openConversation(channel);
    setSelectedRoutineId(background ? null : routine.id);
  };
  const editInThread = (routine: RoutineItem) => {
    if (!routine.sourceChannelName) return;
    openConversation(
      routine.sourceChannelName,
      t("routineHub.editPrompt", {
        agent: routine.createdBy.replace(/^openagents:/, ""),
        name: routine.name,
        id: routine.id,
      }),
    );
    setSelectedRoutineId(null);
  };
  return { openConversation, openRoutineThread, editInThread };
}
