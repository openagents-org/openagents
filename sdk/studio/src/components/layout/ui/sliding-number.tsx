'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, MotionValue, useInView, useSpring, useTransform } from 'framer-motion';

function Digit({
  place,
  value,
  digitHeight,
  duration,
}: {
  place: number;
  value: number;
  digitHeight: number;
  duration: number;
}) {
  const valueRoundedToPlace = Math.floor(value / place);
  const animatedValue = useSpring(valueRoundedToPlace, {
    duration: duration * 1000, // Convert to milliseconds
  });

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  return (
    <div style={{ height: digitHeight }} className="relative w-[1ch] tabular-nums overflow-hidden">
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} digitHeight={digitHeight} />
      ))}
    </div>
  );
}

function Number({ mv, number, digitHeight }: { mv: MotionValue<number>; number: number; digitHeight: number }) {
  const y = useTransform(mv, (latest: number) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;

    let memo = offset * digitHeight;

    if (offset > 5) {
      memo -= 10 * digitHeight;
    }

    return memo;
  });

  return (
    <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center">
      {number}
    </motion.span>
  );
}

interface SlidingNumberProps {
  from: number;
  to: number;
  duration?: number;
  delay?: number;
  startOnView?: boolean;
  once?: boolean;
  className?: string;
  onComplete?: () => void;
  digitHeight?: number;
}

export function SlidingNumber({
  from,
  to,
  duration = 2,
  delay = 0,
  startOnView = true,
  once = false,
  className = '',
  onComplete,
  digitHeight = 40,
}: SlidingNumberProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false }); // Always use false, manage once manually
  const [currentValue, setCurrentValue] = useState(from);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);

  // Reset animation state on component mount (route changes)
  useEffect(() => {
    setCurrentValue(from);
    setHasAnimated(false);
    setAnimationKey((prev) => prev + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - runs on every mount

  // Reset animation state when from/to values change
  useEffect(() => {
    setCurrentValue(from);
    setHasAnimated(false);
    setAnimationKey((prev) => prev + 1);
  }, [from, to]);

  // Manage animation triggering manually
  useEffect(() => {
    if (!startOnView || !isInView) return;

    // If once=true and already animated on this mount, don't animate again
    if (once && hasAnimated) return;

    // Trigger animation
    const timer = setTimeout(() => {
      setAnimationKey((prev) => prev + 1);
    }, 50);

    return () => clearTimeout(timer);
  }, [isInView, startOnView, once, hasAnimated]);

  const shouldStart = !startOnView || (isInView && (!once || !hasAnimated));

  useEffect(() => {
    if (!shouldStart) return;
    setHasAnimated(true);

    const timer = setTimeout(() => {
      const startTime = Date.now();
      const startValue = currentValue;
      const difference = to - startValue;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / (duration * 1000), 1);
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const newValue = startValue + difference * easeOutCubic;

        setCurrentValue(newValue);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setCurrentValue(to);
          onComplete?.();
        }
      };

      requestAnimationFrame(animate);
    }, delay * 1000);

    return () => clearTimeout(timer);
  }, [shouldStart, currentValue, to, duration, delay, onComplete]);

  // Round the current value to avoid showing decimals during animation
  const roundedValue = Math.round(currentValue);
  const absValue = Math.abs(roundedValue);

  // Determine the maximum number of digits needed
  const maxDigits = Math.max(Math.abs(from).toString().length, Math.abs(to).toString().length);

  // Create array of place values (1, 10, 100, 1000, etc.)
  const places = Array.from({ length: maxDigits }, (_, i) => Math.pow(10, maxDigits - i - 1));

  return (
    <div ref={ref} className={`flex items-center ${className}`}>
      {roundedValue < 0 && '-'}
      {places.map((place) => (
        <Digit
          key={`${place}-${animationKey}`}
          place={place}
          value={absValue}
          digitHeight={digitHeight}
          duration={duration}
        />
      ))}
    </div>
  );
}
