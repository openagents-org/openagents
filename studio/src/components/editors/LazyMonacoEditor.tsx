import React, { Suspense, lazy } from "react";
import type { EditorProps } from "@monaco-editor/react";

// Lazy load the Monaco Editor
const Editor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default }))
);

// Loading fallback component
const EditorLoadingFallback: React.FC<{ height?: string | number }> = ({
  height = "100%",
}) => (
  <div
    className="flex items-center justify-center bg-gray-50 dark:bg-gray-900"
    style={{ height }}
  >
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
      <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">
        Loading editor...
      </p>
    </div>
  </div>
);

// Lazy Monaco Editor wrapper
const LazyMonacoEditor: React.FC<EditorProps> = (props) => {
  return (
    <Suspense fallback={<EditorLoadingFallback height={props.height} />}>
      <Editor {...props} />
    </Suspense>
  );
};

export default LazyMonacoEditor;
export { EditorLoadingFallback };
