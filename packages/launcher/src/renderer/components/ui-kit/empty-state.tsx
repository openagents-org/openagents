import * as React from "react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty"
import { Button } from "../ui/button"

export interface EmptyStateAction {
  label: string
  /** Lucide element, sized by the button. */
  icon?: React.ReactNode
  onClick: () => void
  testId?: string
}

export interface EmptyStateProps {
  /** Lucide element. Use the page's own nav icon when the list is empty, and a
   *  search/filter icon when something is merely hiding the rows. */
  icon: React.ReactNode
  title: string
  description?: React.ReactNode
  /** The one thing to do next. Omit where there is nothing to do. */
  action?: EmptyStateAction
  className?: string
}

/**
 * The house empty state: icon, title, a sentence, and at most one action.
 *
 * The shadcn `Empty` primitives allow any subset of that, and every page picked
 * a different one — Agents printed a bare grey sentence, Workspaces a sentence
 * and a button, GitHub and Logs the full arrangement. The screens users are
 * most likely to see first (an app with nothing in it yet) were the emptiest
 * looking ones. This fixes the shape in one place so they cannot drift again.
 *
 * A title AND a description on purpose: the title says what is missing, the
 * description says what to do about it. One line of grey text was doing both
 * jobs and neither well.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button onClick={action.onClick} data-testid={action.testId}>
            {action.icon}
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}
