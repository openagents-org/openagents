'use client';

import { cn } from '@/lib/utils';
import { inputVariants } from '@/components/ui/input';
import type { VariantProps } from 'class-variance-authority';
import {
  composeRenderProps,
  DateFieldProps,
  DateField as DateFieldRa,
  DateInputProps as DateInputPropsRa,
  DateInput as DateInputRa,
  DateSegmentProps,
  DateSegment as DateSegmentRa,
  DateValue as DateValueRa,
  TimeFieldProps,
  TimeField as TimeFieldRa,
  TimeValue as TimeValueRa,
} from 'react-aria-components';

function DateField<T extends DateValueRa>({ className, children, ...props }: DateFieldProps<T>) {
  return (
    <DateFieldRa
      className={composeRenderProps(className, (className) => cn(className))}
      data-slot="datefield"
      {...props}
    >
      {children}
    </DateFieldRa>
  );
}

function TimeField<T extends TimeValueRa>({ className, children, ...props }: TimeFieldProps<T>) {
  return (
    <TimeFieldRa
      className={composeRenderProps(className, (className) => cn(className))}
      data-slot="datefield"
      {...props}
    >
      {children}
    </TimeFieldRa>
  );
}

function DateSegment({ className, ...props }: DateSegmentProps) {
  return (
    <DateSegmentRa
      className={composeRenderProps(className, (className) =>
        cn(
          `
            text-foreground inline-flex rounded px-0.5 caret-transparent outline-hidden data-[type=literal]:text-muted-foreground/70 data-[type=literal]:px-0
            data-placeholder:text-muted-foreground/70
            data-invalid:data-focused:bg-destructive data-invalid:data-placeholder:text-destructive data-invalid:text-destructive data-invalid:data-focused:data-placeholder:text-destructive-foreground data-invalid:data-focused:text-destructive-foreground 
            data-focused:bg-accent data-focused:data-placeholder:text-foreground data-focused:text-foreground             
            data-disabled:cursor-not-allowed data-disabled:opacity-50
          `,
          className,
        ),
      )}
      {...props}
      data-invalid
    />
  );
}

const dateInputStyles = `
  relative inline-flex items-center overflow-hidden whitespace-nowrap
  data-focus-within:ring-ring/30 data-focus-within:border-ring data-focus-within:outline-none data-focus-within:ring-[3px] 
  data-focus-within:has-aria-invalid:ring-destructive/20 dark:data-focus-within:has-aria-invalid:ring-destructive/40 data-focus-within:has-aria-invalid:border-destructive
`;

interface DateInputProps extends DateInputPropsRa, VariantProps<typeof inputVariants> {
  className?: string;
  variant?: VariantProps<typeof inputVariants>['variant'];
}

function DateInput({ className, variant = 'md', ...props }: Omit<DateInputProps, 'children'>) {
  return (
    <DateInputRa
      data-slot="input"
      className={composeRenderProps(className, (className) =>
        cn(inputVariants({ variant }), dateInputStyles, className),
      )}
      {...props}
    >
      {(segment) => <DateSegment segment={segment} />}
    </DateInputRa>
  );
}

export { DateField, DateInput, DateSegment, TimeField, dateInputStyles };
export type { DateInputProps };
