import * as React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonWithPatternProps extends React.ComponentProps<'div'> {
  patternColor?: string;
  patternOpacity?: number;
}

function SkeletonWithPattern({ 
  className, 
  patternColor = "#e5e7eb", 
  patternOpacity = 0.3,
  ...props 
}: SkeletonWithPatternProps) {
  const svgPattern = `
    <svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="bend-lines" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
          <!-- Bend lines pattern -->
          <path d="M0 10 Q15 5, 30 10 T60 10" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M0 20 Q15 15, 30 20 T60 20" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M0 30 Q15 25, 30 30 T60 30" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M0 40 Q15 35, 30 40 T60 40" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M0 50 Q15 45, 30 50 T60 50" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          
          <!-- Vertical bend lines -->
          <path d="M10 0 Q5 15, 10 30 T10 60" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M20 0 Q15 15, 20 30 T20 60" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M30 0 Q25 15, 30 30 T30 60" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M40 0 Q35 15, 40 30 T40 60" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          <path d="M50 0 Q45 15, 50 30 T50 60" stroke="${patternColor}" stroke-width="1" fill="none" opacity="${patternOpacity}"/>
          
          <!-- Diagonal bend lines -->
          <path d="M0 0 Q15 15, 30 30 T60 60" stroke="${patternColor}" stroke-width="0.5" fill="none" opacity="${patternOpacity * 0.7}"/>
          <path d="M60 0 Q45 15, 30 30 T0 60" stroke="${patternColor}" stroke-width="0.5" fill="none" opacity="${patternOpacity * 0.7}"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bend-lines)"/>
    </svg>
  `;

  const encodedSvg = encodeURIComponent(svgPattern);

  return (
    <div 
      data-slot="skeleton-with-pattern" 
      className={cn('animate-pulse rounded-md bg-accent', className)} 
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodedSvg}")`,
        backgroundSize: '60px 60px',
        backgroundRepeat: 'repeat'
      }}
      {...props} 
    />
  );
}

export { SkeletonWithPattern }; 