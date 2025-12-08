/**
 * Progress indicator for onboarding wizard
 */

import React from 'react';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps?: number;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps = 5,
}) => {
  const steps = [
    { number: 1, label: 'Welcome' },
    { number: 2, label: 'Network' },
    { number: 3, label: 'Studio' },
    { number: 4, label: 'Agent' },
    { number: 5, label: 'Complete' },
  ];

  return (
    <div className="w-full px-4 py-6">
      <div className="flex items-center justify-between max-w-3xl mx-auto">
        {steps.map((step, index) => (
          <React.Fragment key={step.number}>
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center font-semibold
                  transition-all duration-300
                  ${
                    step.number < currentStep
                      ? 'bg-green-500 text-white'
                      : step.number === currentStep
                      ? 'bg-blue-500 text-white ring-4 ring-blue-200'
                      : 'bg-gray-200 text-gray-500'
                  }
                `}
              >
                {step.number < currentStep ? (
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  step.number
                )}
              </div>
              <span
                className={`
                  mt-2 text-xs font-medium
                  ${
                    step.number <= currentStep
                      ? 'text-gray-900'
                      : 'text-gray-400'
                  }
                `}
              >
                {step.label}
              </span>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={`
                  flex-1 h-1 mx-2 rounded transition-all duration-300
                  ${
                    step.number < currentStep
                      ? 'bg-green-500'
                      : 'bg-gray-200'
                  }
                `}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ProgressIndicator;
