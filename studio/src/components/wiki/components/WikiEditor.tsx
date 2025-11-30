import React, { useState, useEffect } from 'react';
import MDEditor from '@uiw/react-md-editor';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import DiffViewer from '@/components/common/DiffViewer';
import { useThemeStore } from '@/stores/themeStore';
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

type EditorMode = 'edit' | 'preview' | 'diff';

interface WikiEditorProps {
  value: string;
  onChange: (value: string) => void;
  modes: EditorMode[];
  oldValue?: string;
  oldTitle?: string;
  newTitle?: string;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  textareaProps?: any;
}

const WikiEditor: React.FC<WikiEditorProps> = ({
  value,
  onChange,
  modes,
  oldValue = '',
  oldTitle = 'Original',
  newTitle = 'Modified',
  className = '',
  style = { height: '400px' },
  placeholder = 'Enter content in Markdown format...',
  textareaProps
}) => {
  const [currentMode, setCurrentMode] = useState<EditorMode>(modes[0] || 'edit');
  const { theme } = useThemeStore();

  // Ensure current mode is in available modes list
  useEffect(() => {
    if (!modes.includes(currentMode)) {
      setCurrentMode(modes[0] || 'edit');
    }
  }, [modes, currentMode]);

  const getModeLabel = (mode: EditorMode): string => {
    switch (mode) {
      case 'edit':
        return 'Edit';
      case 'preview':
        return 'Preview';
      case 'diff':
        return 'Diff';
      default:
        return mode;
    }
  };

  const renderContent = () => {
    switch (currentMode) {
      case 'edit':
        return (
          <div data-color-mode={theme} className="flex-1">
            <MDEditor
              value={value}
              onChange={(val) => onChange(val || '')}
              preview="edit"
              hideToolbar={false}
              visibleDragbar={false}
              style={style}
              textareaProps={{
                placeholder,
                style: {
                  fontSize: 14,
                  lineHeight: 1.6,
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                },
                ...textareaProps,
              }}
            />
          </div>
        );

      case 'preview':
        return (
          <div className="flex-1 max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-white dark:bg-gray-800">
            <div className="max-w-none">
              <MarkdownRenderer
                content={value || 'Nothing to preview'}
                className="prose max-w-none dark:prose-invert text-gray-700 dark:text-gray-300"
              />
            </div>
          </div>
        );

      case 'diff':
        return (
          <div className="flex-1 overflow-auto">
            <DiffViewer
              oldValue={oldValue}
              newValue={value}
              oldTitle={oldTitle}
              newTitle={newTitle}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={`wiki-editor ${className}`}>
      {/* Mode Toggle Buttons */}
      {modes.length > 1 && (
        <div className="flex justify-between items-center mb-4">
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCurrentMode(mode)}
                className={`px-3 py-1 text-sm ${
                  currentMode === mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                {getModeLabel(mode)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col" style={style}>
        {renderContent()}
      </div>
    </div>
  );
};

export default WikiEditor;