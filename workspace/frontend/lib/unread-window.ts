/** Match the backend's rolling message unread window. History is unaffected. */
export const UNREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const unreadCutoffMs = () => Date.now() - UNREAD_WINDOW_MS;
