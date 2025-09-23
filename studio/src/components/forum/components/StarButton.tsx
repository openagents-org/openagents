import React from 'react';

interface StarButtonProps {
  starCount: number;
  isStarred: boolean;
  onStar: () => void;
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  showLabel?: boolean;
}

const StarButton: React.FC<StarButtonProps> = ({
  starCount,
  isStarred,
  onStar,
  size = 'medium',
  disabled = false,
  showLabel = false
}) => {
  // 根据尺寸配置
  const sizeConfig = {
    small: {
      iconSize: 'w-3.5 h-3.5',
      buttonPadding: 'p-1.5',
      textSize: 'text-xs',
      spacing: 'space-x-1'
    },
    medium: {
      iconSize: 'w-4 h-4',
      buttonPadding: 'p-2',
      textSize: 'text-sm',
      spacing: 'space-x-1.5'
    },
    large: {
      iconSize: 'w-5 h-5',
      buttonPadding: 'p-2.5',
      textSize: 'text-base',
      spacing: 'space-x-2'
    }
  };

  const config = sizeConfig[size];

  // Star SVG Icon
  const StarIcon = () => (
    <svg
      className={config.iconSize}
      fill={isStarred ? "currentColor" : "none"}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={isStarred ? 1 : 2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );

  // 按钮样式 - 使用 Tailwind CSS dark 模式类
  const getButtonClass = () => `
    ${config.buttonPadding}
    rounded-md
    transition-all
    duration-200
    transform
    flex
    items-center
    ${config.spacing}
    ${disabled
      ? 'opacity-50 cursor-not-allowed'
      : 'hover:scale-105 active:scale-95 cursor-pointer'
    }
    ${isStarred
      ? 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-400/10 hover:text-yellow-700 dark:hover:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-400/20'
      : 'text-gray-500 dark:text-gray-400 hover:text-yellow-600 dark:hover:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-400/10'
    }
  `;

  // 数字颜色 - 使用 Tailwind CSS dark 模式类
  const getCountColor = () => {
    if (isStarred) {
      return 'text-yellow-600 dark:text-yellow-400';
    }
    return 'text-gray-500 dark:text-gray-400';
  };

  return (
    <button
      onClick={onStar}
      disabled={disabled}
      className={getButtonClass()}
      title={showLabel ? (isStarred ? 'Unstar' : 'Star') : undefined}
    >
      <StarIcon />
      <span className={`${config.textSize} font-medium ${getCountColor()}`}>
        {starCount}
      </span>
      {showLabel && (
        <span className={`${config.textSize} ${getCountColor()}`}>
          {isStarred ? 'Starred' : 'Star'}
        </span>
      )}
    </button>
  );
};

export default React.memo(StarButton);