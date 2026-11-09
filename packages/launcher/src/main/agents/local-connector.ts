/**
 * The local connector is the daemon: it runs this device's agents and keeps the
 * device online in its workspaces. Switched off, the app is only a workspace
 * client — nothing runs here and the device shows as offline.
 *
 * Settings key holding the user's choice. Absent until the user (or the first
 * local agent) makes one.
 */
export const LOCAL_CONNECTOR_KEY = "localConnector"

/**
 * The error a start fails with while the connector is off. A code, not prose:
 * the renderer checks for it and offers to turn the connector on.
 */
export const LOCAL_CONNECTOR_OFF = "LOCAL_CONNECTOR_OFF"

/**
 * Whether the connector should run. An explicit choice wins. Before there is
 * one, it runs exactly when the device already has local agents: off for a new
 * install, which turns it on with its first local agent, and on for a device
 * upgraded from a release that always ran it, so its agents keep running.
 */
export function localConnectorEnabled(
  stored: unknown,
  localAgentCount: number,
): boolean {
  if (typeof stored === "boolean") return stored
  return localAgentCount > 0
}
