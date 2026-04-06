import React from 'react';

interface OpenAgentsLogoProps {
  className?: string;
}

const OpenAgentsLogo: React.FC<OpenAgentsLogoProps> = ({ className = "w-6 h-6" }) => (
  <div className={`${className} flex items-center justify-center`}>
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  </div>
);

export default OpenAgentsLogo; 