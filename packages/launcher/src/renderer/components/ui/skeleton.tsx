import { cn } from "@renderer/lib/utils"

/**
 * Loading placeholder.
 *
 * `skeleton-shimmer` (globals.css) rather than stock shadcn's
 * `animate-pulse bg-accent`, for two reasons:
 *
 * - `bg-accent` is the neutral hover wash, which is one shade off the page
 *   background. On a white card that reads; on the page itself it does not,
 *   and a skeleton nobody can see is a section that looks broken. The
 *   `--skeleton-*` tokens exist precisely to be legible on both surfaces.
 * - A pulse fades the whole bar toward the background on every cycle, so at
 *   these contrasts it spends half its time invisible. A sweep keeps the bar
 *   at full strength and moves a highlight across it instead.
 *
 * The class sets `background` (shorthand), so it wins over any `bg-*` passed
 * in `className`. Size and shape are what callers are expected to override.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
