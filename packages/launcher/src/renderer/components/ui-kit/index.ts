/**
 * Thin project-specific controls built on top of shadcn primitives — the few
 * things the registry does not ship. Anything shadcn already provides should
 * be imported from `components/ui` directly instead of re-wrapped here.
 */
export { StatusDot, statusClass, displayState } from "./status-dot"
export type { StatusDotProps, StatusTone } from "./status-dot"

export { PasswordInput } from "./password-input"
export type { PasswordInputProps } from "./password-input"

export { SearchInput } from "./search-input"
export type { SearchInputProps } from "./search-input"

export { ConfirmDialog } from "./confirm-dialog"
export type { ConfirmDialogProps } from "./confirm-dialog"
