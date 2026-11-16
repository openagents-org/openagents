'use client';

import * as React from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * One group of settings, the pattern every settings section uses: a title and
 * a line of description, the controls, and an optional footer bar with a hint
 * on the left and the group's actions (usually Save) on the right.
 */
export function SettingsCard({
  title,
  description,
  action,
  footer,
  footerHint,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small control in the header's top-right corner (e.g. "Add"). */
  action?: React.ReactNode;
  /** Actions on the right of the footer bar. */
  footer?: React.ReactNode;
  /** Muted text on the left of the footer bar. */
  footerHint?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('[--card-spacing:--spacing(6)]', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children && (
        <CardContent>
          <FieldGroup>{children}</FieldGroup>
        </CardContent>
      )}
      {(footer || footerHint) && (
        <CardFooter className="justify-between gap-4 py-3">
          <p className="text-sm text-muted-foreground">{footerHint}</p>
          {footer && <div className="flex shrink-0 items-center gap-2">{footer}</div>}
        </CardFooter>
      )}
    </Card>
  );
}

/**
 * A setting whose control sits beside its label: name and description on the
 * left, the control on the right (stacked on narrow screens).
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  );
}
