import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import OpenAgentsLogo from "@/assets/images/openagents_logo_color_280.png";
import "./OnboardingStep1.css";

interface OnboardingStep1Props {
  onNext: () => void;
}

const OnboardingStep1: React.FC<OnboardingStep1Props> = ({ onNext }) => {
  const { t } = useTranslation('onboarding');
  const [animationStage, setAnimationStage] = useState(0);
  const [logoLoaded, setLogoLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = OpenAgentsLogo;
    img.onload = () => setLogoLoaded(true);
  }, []);

  useEffect(() => {
    if (!logoLoaded) return;

    const timers = [
      setTimeout(() => setAnimationStage(1), 100),
      setTimeout(() => setAnimationStage(2), 1000),
      setTimeout(() => setAnimationStage(3), 1500),
    ];

    return () => timers.forEach(t => clearTimeout(t));
  }, [logoLoaded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-white" />

      <div className="relative z-10 text-center px-6">
        {/* Logo */}
        <div className="mb-10">
          <div
            className={`inline-block ${
              animationStage >= 1 ? "logo-radial-expand" : "opacity-0"
            }`}
          >
            <img
              src={OpenAgentsLogo}
              alt="OpenAgents Logo"
              className="w-40 h-40 object-contain"
            />
          </div>
        </div>

        {/* Title */}
        <h1
          className={`text-5xl md:text-6xl font-semibold mb-3 transition-all duration-700 ease-out ${
            animationStage >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          <span className="text-gray-900">OpenAgents</span>
        </h1>

        {/* Subtitle */}
        <p
          className={`text-lg text-gray-400 mb-14 font-normal transition-all duration-700 delay-100 ease-out ${
            animationStage >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          AI Agent Networks for Open Collaboration
        </p>

        {/* Button */}
        <div
          className={`transition-all duration-700 ease-out ${
            animationStage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          <button
            onClick={onNext}
            className="group inline-flex items-center justify-center px-8 py-3.5 text-base font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800 transition-all duration-300 hover:scale-105 active:scale-95"
          >
            <span>{t('step1.startButton')}</span>
            <svg
              className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform duration-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingStep1;
