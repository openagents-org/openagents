// ── v1.1 M6 — structured hand-off between agents ─────────────────────────────
// The connector's `workspace_handoff` tool posts an ordinary chat message that
// opens with "@<to>" and carries the same record twice: `payload.handoff` for
// thread readers and `metadata.handoff` for routing. The web client keeps only
// `metadata` on a Message, so that is read first; `payload` is accepted for
// callers that still have the raw event. Framework-free so it can be
// unit-tested (see handoff.test.ts).

export interface HandoffRecord {
  /** Bare agent name that handed the work over. */
  from: string;
  /** Bare agent name the work went to. */
  to: string;
  request: string;
  context: string | null;
  output: string | null;
  /** Who is responsible after this turn — usually `to`. */
  nextOwner: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optional(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

/** `openagents:jane` / `@jane` → `jane`. */
function bareAgent(value: unknown): string {
  return str(value).replace(/^openagents:/, '').replace(/^@/, '');
}

function pickRecord(source: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const raw = source?.handoff;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/**
 * The hand-off a message carries, or null when it is a plain message. A
 * record without both endpoints and a request is not a hand-off — the raw
 * text still reads fine, so the card must not claim structure it lacks.
 */
export function handoffFromMessage(
  metadata: Record<string, unknown> | null | undefined,
  payload?: Record<string, unknown> | null,
): HandoffRecord | null {
  const raw = pickRecord(metadata) ?? pickRecord(payload);
  if (!raw) return null;
  const from = bareAgent(raw.from);
  const to = bareAgent(raw.to);
  const request = str(raw.request);
  if (!from || !to || !request) return null;
  return {
    from,
    to,
    request,
    context: optional(raw.context),
    output: optional(raw.output),
    nextOwner: bareAgent(raw.next_owner ?? raw.nextOwner) || to,
  };
}
