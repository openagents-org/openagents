import { useInstallStore } from "../store/install"
import { useUpdateDismissals } from "./useUpdateDismissals"
import { isUpgradeAvailable } from "../../shared/version-compare"

/**
 * Number of agents with an upgrade the user has not dismissed — the badge on
 * the Install nav entry. Dismissals are per (agent, version), so a newer
 * release re-surfaces after an earlier one was hidden.
 */
export function useUpdateCount(): number {
  const updates = useInstallStore((s) => s.updates)
  const { isDismissed } = useUpdateDismissals()

  return updates.filter(
    (u) => isUpgradeAvailable(u.current, u.latest) && !isDismissed(u.name, u.latest!),
  ).length
}
