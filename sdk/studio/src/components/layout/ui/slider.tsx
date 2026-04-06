'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import * as SliderPrimitive from '@radix-ui/react-slider';

function Slider({ className, children, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex h-4 w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {children}
    </SliderPrimitive.Root>
  );
}

function SliderThumb({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Thumb>) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        'box-content block size-4 shrink-0 cursor-pointer rounded-full border-[2px] border-primary bg-primary-foreground shadow-xs shadow-black/5 outline-hidden focus:outline-hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Slider, SliderThumb };
