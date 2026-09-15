export interface AppearanceSnapshot {
  host: string | undefined;
  local: string | undefined;
  /** Identifies a host notification even when its value has not changed. */
  hostRevision?: unknown;
}

export type AppearanceUpdate =
  | { destination: 'local'; value: string }
  | { destination: 'host'; value: string }
  | null;

/**
 * Follow the side that changed, rather than sending two disagreeing snapshots
 * back at each other. The host owns the initial value and incoming host changes;
 * a later local change is a user preference to send to the host once.
 */
export function createAppearanceSync(): (current: AppearanceSnapshot) => AppearanceUpdate {
  let previous: AppearanceSnapshot | undefined;
  let pending: string | undefined;

  return (current) => {
    const before = previous;
    previous = current;
    const { host, local } = current;
    if (!host) {
      pending = undefined;
      return null;
    }

    const hostChanged = host !== before?.host;
    const notified = hostChanged || current.hostRevision !== before?.hostRevision;
    const acknowledged = notified && host === pending;
    if (acknowledged) pending = undefined;

    if (hostChanged && !acknowledged) {
      pending = undefined;
      return local === host ? null : { destination: 'local', value: host };
    }

    if (local && local !== host && !pending && (local !== before?.local || acknowledged)) {
      // Serialize reports so batched host notifications cannot confuse an old
      // acknowledgement with a new selection of the same value. Newer local
      // choices stay visible; once this report is acknowledged, send whichever
      // choice is current then (including a switch back to the original value).
      pending = local;
      return { destination: 'host', value: local };
    }

    return null;
  };
}
