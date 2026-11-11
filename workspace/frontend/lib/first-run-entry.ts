/** A workspace with only its built-in assistant still needs a first agent. */
export function shouldOpenFirstRunOnboarding({
  needsFirstDevice,
  hasAgents,
  hasUserSessions,
  isDirectMessage,
  isWorkspaceLanding,
  viewMode,
}: {
  needsFirstDevice: boolean;
  hasAgents: boolean;
  hasUserSessions: boolean;
  isDirectMessage: boolean;
  isWorkspaceLanding: boolean;
  viewMode: string;
}): boolean {
  return needsFirstDevice && !hasAgents && !hasUserSessions && !isDirectMessage &&
    isWorkspaceLanding && viewMode === 'threads';
}
