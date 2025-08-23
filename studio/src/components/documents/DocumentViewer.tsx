import React from 'react';
import { OpenAgentsConnection } from '../../services/openagentsService';
import DocumentEditor from './DocumentEditor';

interface DocumentViewerProps {
  documentId: string;
  connection: OpenAgentsConnection;
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentId,
  connection,
  currentTheme,
  onBack,
  readOnly = false
}) => {
  // Use the new DocumentEditor component
  return (
    <DocumentEditor
      documentId={documentId}
      connection={connection}
      currentTheme={currentTheme}
      onBack={onBack}
      readOnly={readOnly}
    />
  );
};

export default DocumentViewer;