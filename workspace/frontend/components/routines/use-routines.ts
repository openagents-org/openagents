"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";

/** Refresh while a routines surface is mounted; failed requests keep existing data. */
export function useRoutines() {
  const { routines, refreshRoutines, workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await refreshRoutines();
        if (active) setError(false);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshRoutines, workspace?.workspaceId]);
  return {
    routines: routines.filter((r) => r.status !== "cancelled"),
    loading,
    error,
    refreshRoutines,
  };
}
