/**
 * Tiny bridge from anywhere in the thread (e.g. an artifact card's "Request
 * revision") to the composer in ChatView, which owns the per-thread draft.
 * Avoids threading a callback through ChatMessages → ChatMessage → Attachments.
 */
type Listener = (text: string) => void;

const listeners = new Set<Listener>();

/** Replace the current thread's draft with `text` and focus the input. */
export function prefillComposer(text: string): void {
  for (const l of Array.from(listeners)) l(text);
}

export function subscribeComposerPrefill(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
