import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/layout/ui/button';

interface TourStep {
  target: string; // CSS selector or data attribute
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

interface DashboardTourProps {
  steps: TourStep[];
  isActive: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const DashboardTour: React.FC<DashboardTourProps> = ({
  steps,
  isActive,
  onClose,
  onComplete,
}) => {
  const { t } = useTranslation('admin');
  const [currentStep, setCurrentStep] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const updateTargetElement = useCallback(() => {
    if (!isActive || currentStep >= steps.length) {
      return;
    }

    const step = steps[currentStep];
    const element = document.querySelector(step.target) as HTMLElement;

    if (element) {
      setTargetElement(element);
      // Scroll element into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isActive, currentStep, steps]);

  useEffect(() => {
    updateTargetElement();
  }, [updateTargetElement]);

  // Update tooltip position on window resize
  useEffect(() => {
    if (!isActive || !targetElement) {
      return;
    }

    const updatePosition = () => {
      const rect = targetElement.getBoundingClientRect();
      const step = steps[currentStep];
      const position = step.position || 'bottom';
      const gap = 10;
      const tooltipWidth = 320;
      const tooltipHeight = 180;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = Math.max(gap, rect.top - tooltipHeight - gap);
          left = Math.max(
            gap,
            Math.min(
              rect.left + rect.width / 2 - tooltipWidth / 2,
              viewportWidth - tooltipWidth - gap
            )
          );
          break;
        case 'bottom':
          top = Math.min(
            rect.bottom + gap,
            viewportHeight - tooltipHeight - gap
          );
          left = Math.max(
            gap,
            Math.min(
              rect.left + rect.width / 2 - tooltipWidth / 2,
              viewportWidth - tooltipWidth - gap
            )
          );
          break;
        case 'left':
          top = Math.max(
            gap,
            Math.min(
              rect.top + rect.height / 2 - tooltipHeight / 2,
              viewportHeight - tooltipHeight - gap
            )
          );
          left = Math.max(gap, rect.left - tooltipWidth - gap);
          break;
        case 'right':
          top = Math.max(
            gap,
            Math.min(
              rect.top + rect.height / 2 - tooltipHeight / 2,
              viewportHeight - tooltipHeight - gap
            )
          );
          left = Math.min(
            rect.right + gap,
            viewportWidth - tooltipWidth - gap
          );
          break;
        default:
          top = Math.min(
            rect.bottom + gap,
            viewportHeight - tooltipHeight - gap
          );
          left = Math.max(
            gap,
            Math.min(
              rect.left + rect.width / 2 - tooltipWidth / 2,
              viewportWidth - tooltipWidth - gap
            )
          );
      }

      setTooltipPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isActive, targetElement, currentStep, steps]);

  if (!isActive || currentStep >= steps.length) {
    return null;
  }

  const step = steps[currentStep];
  const element = targetElement;

  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={handleSkip}
      >
        {/* Highlighted element */}
        <div
          className="absolute border-4 border-blue-500 rounded-lg pointer-events-none shadow-2xl"
          style={{
            top: `${rect.top - 4}px`,
            left: `${rect.left - 4}px`,
            width: `${rect.width + 8}px`,
            height: `${rect.height + 8}px`,
            zIndex: 51,
          }}
        />
      </div>

      {/* Tooltip */}
      <div
        className="fixed z-[60] bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 max-w-sm"
        style={{
          top: `${tooltipPosition.top}px`,
          left: `${tooltipPosition.left}px`,
        }}
      >
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {step.title}
            </h3>
            <Button
              onClick={handleSkip}
              variant="ghost"
              size="sm"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </Button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {step.content}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {currentStep + 1} / {steps.length}
          </div>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                onClick={() => setCurrentStep(currentStep - 1)}
                variant="secondary"
                size="sm"
              >
                {t('tour.previous')}
              </Button>
            )}
            <Button
              onClick={handleNext}
              variant="primary"
              size="sm"
            >
              {currentStep === steps.length - 1 ? t('tour.complete') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DashboardTour;

