/**
 * Avatar component with placeholder support
 */

import React, { useState } from "react";

interface AvatarProps {
  src: string | null;
  fallback: string;
  alt: string;
  size?: number;
  className?: string;
}

const Avatar: React.FC<AvatarProps> = ({ 
  src, 
  fallback, 
  alt, 
  size = 40,
  className = "" 
}) => {
  const [error, setError] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Show placeholder if no src or error occurred
  if (!src || error || imageError) {
    return (
      <div
        className={`avatar-placeholder ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "bold",
          fontSize: `${Math.max(12, size * 0.4)}px`,
          flexShrink: 0,
        }}
        title={alt}
      >
        {fallback.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`avatar ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
      }}
      onError={() => {
        setImageError(true);
        setError(true);
      }}
      title={alt}
    />
  );
};

export default Avatar;

