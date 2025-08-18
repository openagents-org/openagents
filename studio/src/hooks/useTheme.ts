import { useState, useEffect, useCallback } from 'react';

type ThemeType = 'light' | 'dark';

// 获取保存的主题或系统偏好
const getInitialTheme = (): ThemeType => {
    const savedTheme = localStorage.getItem('openagents_theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
};

export default function useTheme() {
  // 使用函数初始化 state，确保只在首次渲染时计算
  const [theme, setThemeState] = useState<ThemeType>(getInitialTheme);

  // 更新 HTML 类和 localStorage 的函数
  const applyTheme = useCallback((newTheme: ThemeType) => {
      // 设置状态
      setThemeState(newTheme);
      
      // 更新DOM类
      document.documentElement.classList.remove('light', 'dark'); // 先移除旧类
      document.documentElement.classList.add(newTheme);
      
      // 保存到localStorage
      try {
          localStorage.setItem('openagents_theme', newTheme);
          console.log(`Theme set to: ${newTheme} and saved to localStorage.`);
      } catch (e) {
          console.error("Failed to save theme to localStorage", e);
      }
  }, []);

  // 在组件挂载时检查主题是否正确应用
  // 使用替代方案避免重复添加和移除类导致的闪烁
  useEffect(() => {
    // 检查当前HTML元素上的主题类是否与状态匹配
    const htmlElement = document.documentElement;
    const hasLightClass = htmlElement.classList.contains('light');
    const hasDarkClass = htmlElement.classList.contains('dark');
    
    // 如果主题类不匹配或者没有设置，才更新DOM
    if ((theme === 'light' && !hasLightClass) || (theme === 'dark' && !hasDarkClass)) {
      // 只移除不匹配的类，避免闪烁
      if (theme === 'light' && hasDarkClass) {
        htmlElement.classList.remove('dark');
        htmlElement.classList.add('light');
      } else if (theme === 'dark' && hasLightClass) {
        htmlElement.classList.remove('light'); 
        htmlElement.classList.add('dark');
      } else if (!hasLightClass && !hasDarkClass) {
        // 两个类都没有的情况，添加正确的类
        htmlElement.classList.add(theme);
      }
      console.log(`Theme class corrected: ${theme}`);
    }
  }, [theme]); 

  // 切换主题的函数
  const toggleTheme = useCallback((): void => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
  }, [theme, applyTheme]);

  return { theme, toggleTheme };
} 