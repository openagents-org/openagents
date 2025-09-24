import React, { useMemo } from 'react';
import { diffLines, Change } from 'diff';

interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  oldTitle?: string;
  newTitle?: string;
  viewType?: 'unified' | 'split';
  className?: string;
  showLineNumbers?: boolean;
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  oldValue = '',
  newValue = '',
  oldTitle = 'Original',
  newTitle = 'Modified',
  className = '',
  showLineNumbers = true
}) => {

  // 计算差异
  const changes = useMemo(() => {
    return diffLines(oldValue, newValue);
  }, [oldValue, newValue]);

  // 渲染差异行
  const renderChanges = () => {
    let oldLineNumber = 1;
    let newLineNumber = 1;

    return changes.map((change: Change, index: number) => {
      const lines = change.value.split('\n');
      // 移除最后一个空行
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }

      return lines.map((line: string, lineIndex: number) => {
        const key = `${index}-${lineIndex}`;
        let changeType = 'normal';
        let displayOldLine = oldLineNumber;
        let displayNewLine = newLineNumber;

        if (change.added) {
          changeType = 'insert';
          displayOldLine = 0; // 不显示旧行号
        } else if (change.removed) {
          changeType = 'delete';
          displayNewLine = 0; // 不显示新行号
        }

        // 更新行号
        if (!change.added) {
          oldLineNumber++;
        }
        if (!change.removed) {
          newLineNumber++;
        }

        return (
          <div
            key={key}
            className={`flex text-sm font-mono leading-relaxed border-l-4 ${
              changeType === 'insert'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600'
                : changeType === 'delete'
                ? 'bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-600'
                : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600'
            }`}
          >
            {showLineNumbers && (
              <div className="flex text-xs text-gray-500 dark:text-gray-400 select-none">
                <span className="w-10 text-right pr-2 py-1">
                  {displayOldLine > 0 ? displayOldLine : ''}
                </span>
                <span className="w-10 text-right pr-2 py-1">
                  {displayNewLine > 0 ? displayNewLine : ''}
                </span>
              </div>
            )}
            <div className="flex-1 px-2 py-1">
              <span
                className={`${
                  changeType === 'insert'
                    ? 'text-green-800 dark:text-green-200'
                    : changeType === 'delete'
                    ? 'text-red-800 dark:text-red-200'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {changeType === 'insert' && '+ '}
                {changeType === 'delete' && '- '}
                {changeType === 'normal' && '  '}
                {line || ' '}
              </span>
            </div>
          </div>
        );
      });
    }).flat();
  };

  if (!oldValue && !newValue) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No content to compare
      </div>
    );
  }

  if (oldValue === newValue) {
    return (
      <div className="text-center py-8 text-green-600 dark:text-green-400">
        No changes detected
      </div>
    );
  }

  return (
    <div className={`diff-viewer ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Comparing: <span className="text-red-600 dark:text-red-400">{oldTitle}</span> vs <span className="text-green-600 dark:text-green-400">{newTitle}</span>
        </div>
      </div>

      {/* Diff Content */}
      <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          {renderChanges()}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;