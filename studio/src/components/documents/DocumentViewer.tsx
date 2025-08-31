import React from 'react';
import { OpenAgentsGRPCConnection } from '../../services/grpcService';
import EtherpadDocumentEditor from './EtherpadDocumentEditor';

interface DocumentViewerProps {
  documentId: string;
  connection: OpenAgentsGRPCConnection;
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
  // Use the new Etherpad-based DocumentEditor component
  return (
    <EtherpadDocumentEditor
      documentId={documentId}
      connection={connection}
      currentTheme={currentTheme}
      onBack={onBack}
      readOnly={readOnly}
    />
  );
};

export default DocumentViewer;