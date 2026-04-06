'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, Variants } from 'motion/react';
import { cn } from '@/lib/utils';

type RevealVariant =
  | 'fade'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scale'
  | 'blur'
  | 'typewriter'
  | 'wave'
  | 'stagger'
  | 'rotate'
  | 'elastic';

interface TextRevealProps {
  children: string;
  variant?: RevealVariant;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  duration?: number;
  staggerDelay?: number;
  once?: boolean;
  startOnView?: boolean;
  wordLevel?: boolean;
  onComplete?: () => void;
}

const containerVariants: Record<RevealVariant, Variants> = {
  fade: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.02 },
    },
  },
  slideUp: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.04 },
    },
  },
  slideDown: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.04 },
    },
  },
  slideLeft: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.04 },
    },
  },
  slideRight: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.04 },
    },
  },
  scale: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.06 },
    },
  },
  blur: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.03 },
    },
  },
  typewriter: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.15 },
    },
  },
  wave: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.12 },
    },
  },
  stagger: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.08 },
    },
  },
  rotate: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.05 },
    },
  },
  elastic: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.07 },
    },
  },
};

const itemVariants: Record<RevealVariant, Variants> = {
  fade: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.6, ease: 'easeOut' },
    },
  },
  slideUp: {
    hidden: { opacity: 0, y: 50, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
    },
  },
  slideDown: {
    hidden: { opacity: 0, y: -30, scale: 0.98 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    },
  },
  slideLeft: {
    hidden: { opacity: 0, x: 60, rotateY: 15 },
    visible: {
      opacity: 1,
      x: 0,
      rotateY: 0,
      transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
    },
  },
  slideRight: {
    hidden: { opacity: 0, x: -60, rotateY: -15 },
    visible: {
      opacity: 1,
      x: 0,
      rotateY: 0,
      transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
    },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.8 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] },
    },
  },
  blur: {
    hidden: { opacity: 0, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      filter: 'blur(0px)',
      transition: { duration: 0.6, ease: 'easeOut' },
    },
  },
  typewriter: {
    hidden: { width: 0 },
    visible: {
      width: 'auto',
      transition: { duration: 0.3, ease: 'easeInOut' },
    },
  },
  wave: {
    hidden: { opacity: 0, y: 20, rotateZ: -5 },
    visible: {
      opacity: 1,
      y: [20, -10, 0],
      rotateZ: [-5, 5, 0],
      transition: {
        duration: 0.8,
        ease: [0.34, 1.56, 0.64, 1],
        times: [0, 0.5, 1],
      },
    },
  },
  stagger: {
    hidden: { opacity: 0, y: 30, scale: 0.9 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
    },
  },
  rotate: {
    hidden: { opacity: 0, rotateY: -90 },
    visible: {
      opacity: 1,
      rotateY: 0,
      transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
    },
  },
  elastic: {
    hidden: { opacity: 0, scale: 0 },
    visible: {
      opacity: 1,
      scale: [0, 1.2, 1],
      transition: {
        duration: 0.8,
        ease: [0.68, -0.55, 0.265, 1.55],
        times: [0, 0.6, 1],
      },
    },
  },
};

export function TextReveal({
  children,
  variant = 'fade',
  className,
  style,
  delay = 0,
  duration = 0.6,
  staggerDelay = 0.03,
  once = true,
  startOnView = true,
  wordLevel = false,
}: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once, margin: '-10%' });
  const [hasAnimated, setHasAnimated] = useState(false);

  const shouldAnimate = startOnView ? isInView : true;

  // Split text into words or characters
  const elements = wordLevel
    ? children.split(' ').map((word, i, arr) => (i < arr.length - 1 ? `${word} ` : word))
    : children.split('');

  // Update container variants with custom stagger delay
  const customContainerVariants = {
    ...containerVariants[variant],
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: delay,
      },
    },
  };

  // Use original item variants - only override duration if explicitly different from default
  const originalVariant = itemVariants[variant];
  const customItemVariants =
    duration === 0.6
      ? originalVariant // Use original variant unchanged if default duration
      : {
          hidden: originalVariant.hidden,
          visible: {
            ...originalVariant.visible,
            transition: {
              ...((originalVariant.visible as Record<string, unknown>).transition as Record<string, unknown>),
              duration,
            },
          },
        };

  useEffect(() => {
    if (shouldAnimate && !hasAnimated) {
      setHasAnimated(true);
    }
  }, [shouldAnimate, hasAnimated]);

  const MotionComponent = variant === 'typewriter' ? motion.div : motion.span;

  return (
    <motion.div
      ref={ref}
      className={cn('inline-block', className)}
      variants={customContainerVariants}
      initial="hidden"
      animate={shouldAnimate ? 'visible' : 'hidden'}
      style={{
        willChange: 'transform, opacity',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        WebkitTransform: 'translate3d(0,0,0)',
        transform: 'translate3d(0,0,0)',
        isolation: 'isolate',
        contain: 'layout style paint',
        ...style,
      }}
    >
      {variant === 'typewriter' ? (
        <motion.span
          className="inline-block overflow-hidden whitespace-nowrap"
          variants={customItemVariants}
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
          }}
        >
          {children}
        </motion.span>
      ) : (
        elements.map((element, index) => (
          <MotionComponent
            key={index}
            className={cn('inline-block', {
              'whitespace-pre': !wordLevel,
            })}
            variants={customItemVariants}
            style={{
              display: 'inline-block',
              transformOrigin: variant === 'rotate' ? 'center center' : undefined,
              willChange: 'transform, opacity',
              WebkitBackfaceVisibility: 'hidden',
              backfaceVisibility: 'hidden',
              WebkitTransform: 'translate3d(0,0,0)',
              transform: 'translate3d(0,0,0)',
              isolation: 'isolate',
            }}
          >
            {element === ' ' ? '\u00A0' : element}
          </MotionComponent>
        ))
      )}
    </motion.div>
  );
}
