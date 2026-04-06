import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/hooks/useI18n';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '@/i18n/config';
import { getLanguageFlag } from '@/i18n/utils';
import { Button } from '@/components/layout/ui/button';

interface LanguageSwitcherProps {
    className?: string;
    showFlag?: boolean;
    showFullName?: boolean;
    variant?: 'default' | 'minimal'; // 新增: 样式变体
    align?: 'left' | 'right'; // 新增: 下拉菜单对齐方式
    size?: 'sm' | 'md' | 'lg'; // 新增: 尺寸大小
    direction?: 'up' | 'down'; // 新增: 下拉菜单展开方向
}

/**
 * Language switcher component with dropdown
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
    className = '',
    showFlag = true,
    showFullName = false,
    variant = 'default',
    align = 'left',
    size = 'sm',
    direction = 'down',
}) => {
    const { currentLanguage, switchLanguage } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleLanguageChange = async (lang: SupportedLanguage) => {
        await switchLanguage(lang);
        setIsOpen(false);
    };

    const getCurrentLanguageDisplay = () => {
        return showFlag ? getLanguageFlag(currentLanguage) + ' ' : '';
    };

    // 根据 size 决定尺寸相关的样式
    const sizeClasses = {
        sm: {
            button: 'px-2 py-1.5 text-xs gap-1.5',
            flag: 'text-sm',
        },
        md: {
            button: 'px-3 py-2 text-sm gap-2',
            flag: 'text-base',
        },
        lg: {
            button: 'px-4 py-2.5 text-base gap-2',
            flag: 'text-lg',
        },
    };

    // 根据 align 和 direction 决定下拉菜单位置
    const getDropdownClassName = () => {
        const baseClasses = "absolute w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-[100] overflow-hidden";
        const verticalPosition = direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2';
        const horizontalPosition = align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
        return `${baseClasses} ${verticalPosition} ${horizontalPosition}`;
    };

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            {/* Language selector button */}
            <Button
                onClick={() => setIsOpen(!isOpen)}
                variant={variant === 'minimal' ? 'ghost' : 'outline'}
                size={size}
                aria-label="Select language"
                title="Switch language"
            >
                <span className={sizeClasses[size].flag}>{getCurrentLanguageDisplay()}</span>
            </Button>

            {/* Dropdown menu */}
            {isOpen && (
                <div className={getDropdownClassName()}>
                    <div className="py-1">
                        {Object.entries(SUPPORTED_LANGUAGES).map(([code, lang]) => {
                            const langCode = code as SupportedLanguage;
                            const isActive = langCode === currentLanguage;

                            return (
                                <button
                                    key={code}
                                    onClick={() => handleLanguageChange(langCode)}
                                    className={`
                                        w-full px-4 py-2.5 flex items-center gap-3 text-left
                                        transition-colors duration-150
                                        ${isActive 
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' 
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                        }
                                    `}
                                >
                                    <span className="text-xl flex-shrink-0">{lang.flag}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm">{lang.nativeName}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                            {lang.name}
                                        </div>
                                    </div>
                                    {isActive && (
                                        <svg
                                            className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0"
                                            fill="currentColor"
                                            viewBox="0 0 20 20"
                                        >
                                            <path
                                                fillRule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clipRule="evenodd"
                                            />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LanguageSwitcher;
