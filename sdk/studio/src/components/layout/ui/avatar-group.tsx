'use client';

import * as React from 'react';
import { AnimatePresence, Easing, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';

type AnimationVariantType = 'spring' | 'tween' | 'inertia' | 'decay' | 'keyframes';
type AnimationType = 'default' | 'flip' | 'reveal';

interface AvatarGroupContextValue {
  tooltipClassName?: string;
  animation?: 'default' | 'flip' | 'reveal';
}

const AvatarGroupContext = React.createContext<AvatarGroupContextValue | null>(null);

interface AvatarGroupProps {
  children: React.ReactNode;
  className?: string;
  tooltipClassName?: string;
  animation?: AnimationType;
}

interface AvatarGroupItemProps {
  children: React.ReactNode;
  className?: string;
  tooltipClassName?: string;
  animation?: AnimationType;
}

interface AvatarGroupTooltipProps {
  children: React.ReactNode;
  className?: string;
}

const StaggeredContent = ({ content }: { content: React.ReactNode }) => {
  const children = React.Children.toArray(content);
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={{
        animate: { transition: { staggerChildren: 0.08 } },
      }}
    >
      {children.map((child, i) => (
        <motion.div
          key={i}
          variants={{
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
            exit: { opacity: 0, y: -20, transition: { duration: 0.2, ease: 'easeIn' } },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
};

export function AvatarGroup({ children, className, tooltipClassName, animation = 'default' }: AvatarGroupProps) {
  const contextValue: AvatarGroupContextValue = {
    tooltipClassName,
    animation,
  };

  return (
    <AvatarGroupContext.Provider value={contextValue}>
      <div className={cn('flex -space-x-2.5', className)}>{children}</div>
    </AvatarGroupContext.Provider>
  );
}

export function AvatarGroupItem({
  children,
  className,
  tooltipClassName,
  animation: itemAnimation,
}: AvatarGroupItemProps) {
  const context = React.useContext(AvatarGroupContext);
  const [hoveredIndex, setHoveredIndex] = React.useState<boolean>(false);
  const springConfig = { stiffness: 100, damping: 5 };
  const x = useMotionValue(0);

  const animation = itemAnimation || context?.animation || 'default';
  const finalTooltipClassName = tooltipClassName || context?.tooltipClassName;

  // rotate the tooltip
  const rotate = useSpring(useTransform(x, [-100, 100], [-45, 45]), springConfig);
  // translate the tooltip
  const translateX = useSpring(useTransform(x, [-100, 100], [-50, 50]), springConfig);

  // Extract tooltip from children
  const tooltipChild = React.Children.toArray(children).find(
    (child) => React.isValidElement(child) && child.type === AvatarGroupTooltip,
  );

  const otherChildren = React.Children.toArray(children).filter(
    (child) => !(React.isValidElement(child) && child.type === AvatarGroupTooltip),
  );

  const tooltipContent =
    tooltipChild && React.isValidElement(tooltipChild)
      ? (tooltipChild.props as AvatarGroupTooltipProps).children
      : null;

  const handleMouseMove = (event: React.MouseEvent) => {
    const halfWidth = (event.target as HTMLElement).offsetWidth / 2;
    x.set((event.nativeEvent as MouseEvent).offsetX - halfWidth);
  };

  const animationVariants = {
    default: {
      initial: { opacity: 0, y: 20, scale: 0.6 },
      animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          type: 'spring' as AnimationVariantType,
          stiffness: 260,
          damping: 10,
        },
      },
      exit: {
        opacity: 0,
        y: 20,
        scale: 0.6,
        transition: {
          duration: 0.2,
          ease: 'easeInOut' as Easing,
        },
      },
    },
    flip: {
      initial: { opacity: 0, rotateX: -90 },
      animate: {
        opacity: 1,
        rotateX: 0,
        transition: {
          type: 'spring' as AnimationVariantType,
          stiffness: 180,
          damping: 25,
        },
      },
      exit: {
        opacity: 0,
        rotateX: -90,
        transition: {
          duration: 0.3,
          ease: 'easeInOut' as Easing,
        },
      },
    },
    reveal: {
      initial: { opacity: 0, scale: 0.95 },
      animate: { opacity: 1, scale: 1, transition: { duration: 0.15, ease: 'easeOut' as Easing } },
      exit: { opacity: 0, scale: 0.95, transition: { duration: 0.1, ease: 'easeIn' as Easing } },
    },
  };

  const selectedVariant = animationVariants[animation];

  return (
    <div
      className={cn('group relative', className)}
      onMouseEnter={() => setHoveredIndex(true)}
      onMouseLeave={() => setHoveredIndex(false)}
    >
      <AnimatePresence mode="wait">
        {hoveredIndex && tooltipContent && (
          <motion.div
            initial={selectedVariant.initial}
            animate={selectedVariant.animate}
            exit={selectedVariant.exit}
            style={{
              translateX: animation === 'reveal' ? 0 : translateX,
              rotate: animation === 'reveal' ? 0 : rotate,
              whiteSpace: 'nowrap',
              transformOrigin: 'center',
            }}
            className={cn(
              'absolute -top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center justify-center rounded-md bg-black px-4 py-2 text-xs font-medium text-white shadow-xl',
              finalTooltipClassName,
            )}
          >
            <motion.div
              className="absolute inset-x-10 -bottom-px z-30 h-px w-[20%] bg-gradient-to-r from-transparent via-emerald-500 dark:via-emerald-900 to-transparent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
            <motion.div
              className="absolute -bottom-px left-10 z-30 h-px w-[40%] bg-gradient-to-r from-transparent via-sky-500 dark:via-sky-900 to-transparent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
            {animation === 'reveal' ? <StaggeredContent content={tooltipContent} /> : tooltipContent}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="relative cursor-pointer"
        whileHover={{
          zIndex: 30,
        }}
        whileTap={{ scale: 0.95 }}
        transition={{
          duration: 0.5,
        }}
        onMouseMove={handleMouseMove}
      >
        {otherChildren}
      </motion.div>
    </div>
  );
}

export function AvatarGroupTooltip({ children, className }: AvatarGroupTooltipProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.6 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('hidden relative z-30', className)}
    >
      {children}
    </motion.div>
  );
}
