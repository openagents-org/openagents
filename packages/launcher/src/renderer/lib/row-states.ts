/**
 * Hover and selected treatment for a choosable row, shared by every surface
 * that presents a list of them: the rail's nav (via `--sidebar-*`, which alias
 * the same tokens), the dropdown menu, the select popup and the command
 * palette. Picking a theme in the ⋯ menu used to look nothing like picking a
 * page in the rail two centimetres to its left, even though both are "choose
 * one of these" — these constants are what keeps the two in step.
 *
 * The colours live in `--row-*` (globals.css); only the state plumbing is here,
 * and it is plumbing worth centralising:
 *
 * - The svg rules undo the resting `text-muted-foreground` that the shadcn
 *   items put on their icons, so a highlighted row colours as one object
 *   instead of accent text beside a grey glyph. They repeat the
 *   `:not([class*='text-'])` filter deliberately: without it the two rules tie
 *   on specificity and the winner is decided by stylesheet order.
 * - `ROW_CHECKED` restates itself under `focus:` for the same reason — hovering
 *   the row that is already selected must not drop it back to the lighter wash.
 *
 * Radix routes both pointer highlight and keyboard focus through `:focus` on
 * menu items, so `ROW_HOVER` covers both. cmdk does not: it marks its active
 * row with `data-selected`, which is why `ROW_SELECTED_ATTR` exists.
 */
export const ROW_HOVER =
  "focus:bg-row-hover focus:text-row-hover-foreground focus:[&_svg:not([class*='text-'])]:text-inherit"

/** cmdk's equivalent of `:focus` — the row the arrow keys are currently on. */
export const ROW_SELECTED_ATTR =
  "data-[selected=true]:bg-row-hover data-[selected=true]:text-row-hover-foreground data-[selected=true]:[&_svg:not([class*='text-'])]:text-inherit"

/** A submenu trigger whose panel is open: the path you are currently down. */
export const ROW_OPEN =
  "data-[state=open]:bg-row-hover data-[state=open]:text-row-hover-foreground data-[state=open]:[&_svg:not([class*='text-'])]:text-inherit"

/** The current value of a radio group / checkbox item — the stronger tint. */
export const ROW_CHECKED =
  "data-[state=checked]:bg-row-active data-[state=checked]:font-medium data-[state=checked]:text-row-active-foreground data-[state=checked]:[&_svg:not([class*='text-'])]:text-inherit data-[state=checked]:focus:bg-row-active data-[state=checked]:focus:text-row-active-foreground"
