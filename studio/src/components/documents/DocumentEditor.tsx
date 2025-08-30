import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Typography from '@tiptap/extension-typography';
import Placeholder from '@tiptap/extension-placeholder';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentContent, DocumentComment, AgentPresence } from '../../types';
import { OpenAgentsGRPCConnection } from '../../services/grpcService';

interface DocumentEditorProps {
  documentId: string;
  connection: OpenAgentsGRPCConnection;
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

interface EditorState {
  content: string[];
  cursorPosition: { line: number; column: number };
  selection: { start: number; end: number } | null;
  isEditing: boolean;
}

interface CollaborativeUser {
  agentId: string;
  displayName: string;
  cursorPosition: { line: number; column: number };
  color: string;
  isActive: boolean;
}

const DocumentEditor: React.FC<DocumentEditorProps> = ({
  documentId,
  connection,
  currentTheme,
  onBack,
  readOnly = false
}) => {
  // Core state
  const [documentContent, setDocumentContent] = useState<DocumentContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false); // Prevent concurrent loads
  const [hasUserEdits, setHasUserEdits] = useState(false); // Track if user has made any edits
  
  // Editor state
  const [editorState, setEditorState] = useState<EditorState>({
    content: [],
    cursorPosition: { line: 1, column: 1 },
    selection: null,
    isEditing: false
  });
  
  // UI state
  const [title, setTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showComments, setShowComments] = useState(false);
  
  // Collaborative features
  const [collaborativeUsers, setCollaborativeUsers] = useState<CollaborativeUser[]>([]);
  
  // Refs
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Auto-save delay (ms)
  const AUTO_SAVE_DELAY = 2000;
  
  // User colors for collaborative editing
  const USER_COLORS = [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
  ];

  // Convert markdown to HTML for TipTap
  const markdownToHtml = useCallback((markdown: string) => {
    if (!markdown.trim()) return '<p></p>';
    
    console.log('🔍 Processing markdown:', markdown);
    
    // First, handle inline patterns that can appear anywhere
    let processed = markdown
      // Bold and italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Inline code (but not code blocks)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    
    // Then handle block-level patterns
    // Headers - look for ## at start of line or after whitespace
    processed = processed
      .replace(/(^|\n)### ([^\n]+)/g, '$1<h3>$2</h3>')
      .replace(/(^|\n)## ([^\n]+)/g, '$1<h2>$2</h2>')
      .replace(/(^|\n)# ([^\n]+)/g, '$1<h1>$2</h1>');
    
    console.log('🎯 After header processing:', processed);
    
    // Split into lines and group into paragraphs
    const lines = processed.split('\n');
    const result: string[] = [];
    let currentParagraph: string[] = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('<h') && trimmedLine.endsWith('>')) {
        // Finish current paragraph if any
        if (currentParagraph.length > 0) {
          result.push(`<p>${currentParagraph.join('<br>')}</p>`);
          currentParagraph = [];
        }
        // Add header
        result.push(trimmedLine);
      } else if (trimmedLine === '') {
        // Empty line - finish current paragraph
        if (currentParagraph.length > 0) {
          result.push(`<p>${currentParagraph.join('<br>')}</p>`);
          currentParagraph = [];
        }
      } else {
        // Regular content line
        currentParagraph.push(line);
      }
    }
    
    // Finish final paragraph if any
    if (currentParagraph.length > 0) {
      result.push(`<p>${currentParagraph.join('<br>')}</p>`);
    }
    
    const finalResult = result.join('') || '<p></p>';
    console.log('✅ Final HTML result:', finalResult);
    
    return finalResult;
  }, []);

  // Convert HTML back to markdown for saving
  const htmlToMarkdown = useCallback((html: string) => {
    if (!html.trim()) return '';
    
    let markdown = html
      // Headers
      .replace(/<h1>(.*?)<\/h1>/g, '# $1')
      .replace(/<h2>(.*?)<\/h2>/g, '## $1')
      .replace(/<h3>(.*?)<\/h3>/g, '### $1')
      // Bold and italic
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      // Code
      .replace(/<code>(.*?)<\/code>/g, '`$1`')
      // Links
      .replace(/<a href="([^"]+)">(.*?)<\/a>/g, '[$2]($1)')
      // Paragraphs and line breaks
      .replace(/<\/p><p>/g, '\n\n')
      .replace(/<p>/g, '')
      .replace(/<\/p>/g, '')
      .replace(/<br>/g, '\n')
      // Remove any remaining HTML tags
      .replace(/<[^>]*>/g, '');
    
    return markdown.trim();
  }, []);

  // TipTap Editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
      }),
      Typography,
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // Get the HTML content and convert back to markdown-like format
      const htmlContent = editor.getHTML();
      const markdownContent = htmlToMarkdown(htmlContent);
      const lines = markdownContent.split('\n');
      
      console.log('📝 Editor updated - HTML:', htmlContent);
      console.log('📝 Editor updated - Markdown:', markdownContent);
      
      setEditorState(prev => ({
        ...prev,
        content: lines,
        isEditing: true
      }));
      
      // Mark that user has made edits
      setHasUserEdits(true);

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout for auto-save and stop editing state
      if (!readOnly) {
        saveTimeoutRef.current = setTimeout(() => {
          saveDocument();
          setEditorState(prev => ({ ...prev, isEditing: false }));
        }, AUTO_SAVE_DELAY);
      }
    },
    onFocus: () => {
      console.log('📝 Editor focused - user is editing');
      setEditorState(prev => ({ ...prev, isEditing: true }));
    },
    onBlur: () => {
      console.log('📝 Editor blurred - user stopped editing');
      // Don't immediately set isEditing to false, let the timeout handle it
      // This prevents issues when user clicks elsewhere briefly
    },
    editorProps: {
      attributes: {
        class: `prose prose-lg max-w-none focus:outline-none ${
          currentTheme === 'dark' 
            ? 'prose-invert prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-gray-100 prose-code:text-gray-200 prose-blockquote:text-gray-300'
            : 'prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-code:text-gray-800 prose-blockquote:text-gray-600'
        }`,
        style: `
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 16px;
          line-height: 1.6;
          color: ${currentTheme === 'dark' ? '#f3f4f6' : '#1f2937'};
        `,
      },
    },
  });

  // Load document content
  const loadDocumentContent = useCallback(async () => {
    // Prevent concurrent loads
    if (isLoadingDocument) {
      console.log('🔄 Document load already in progress, skipping...');
      return;
    }
    
    try {
      setIsLoadingDocument(true);
      setIsLoading(true);
      setError(null);
      
      console.log('📖 Loading document:', documentId);
      
      // Only use getDocumentContent - avoid dual loading that causes conflicts
      const content = await connection.getDocumentContent(documentId, true, true);
      console.log('📄 Loaded document content:', content);
      console.log('📄 Content array:', content.content);
      console.log('📄 Content length:', content.content ? content.content.length : 0);
      
      setDocumentContent(content);
      
      // Reset user edits flag for fresh document load
      setHasUserEdits(false);
      
      // Convert content array to string and set in editor
      const contentString = content.content ? content.content.join('\n') : '';
      console.log('📝 Raw content string:', contentString);
      console.log('📝 Content string length:', contentString.length);
      
      if (editor) {
        // Convert markdown to HTML for proper rendering
        const htmlContent = markdownToHtml(contentString);
        console.log('🎨 Converted HTML:', htmlContent);
        editor.commands.setContent(htmlContent);
      }
      
      setEditorState(prev => ({
        ...prev,
        content: content.content || ['']
      }));
      
      // Set title from document ID or metadata
      setTitle(content.document_id || documentId);
      
      // Initialize collaborative users from agent presence
      if (content.agent_presence) {
        const users = content.agent_presence.map((presence: AgentPresence, index: number) => ({
          agentId: presence.agent_id,
          displayName: presence.agent_id,
          cursorPosition: presence.cursor_position || { line: 1, column: 1 },
          color: USER_COLORS[index % USER_COLORS.length],
          isActive: presence.is_active
        }));
        setCollaborativeUsers(users);
      }
      
    } catch (err) {
      console.error('Failed to load document content:', err);
      setError('Failed to load document content');
    } finally {
      setIsLoading(false);
      setIsLoadingDocument(false);
    }
  }, [connection, documentId, editor]);

  useEffect(() => {
    if (editor) {
      loadDocumentContent();
    }
  }, [loadDocumentContent, editor]);

  // Update editor content when document content changes
  useEffect(() => {
    if (editor && documentContent && documentContent.content) {
      const contentString = documentContent.content.join('\n');
      const currentText = editor.getText();
      
      console.log('🔍 Editor update check:');
      console.log('  - Current editor text:', currentText);
      console.log('  - New content string:', contentString);
      console.log('  - Content different?', currentText !== contentString);
      console.log('  - Is editing?', editorState.isEditing);
      
      // Only update if content is different to avoid cursor jumping
      // Be very protective: don't update if user is editing OR has made any edits in this session
      const shouldSkipUpdate = editorState.isEditing || hasUserEdits;
      
      if (currentText !== contentString && !shouldSkipUpdate) {
        console.log('📝 Updating editor with new document content');
        const htmlContent = markdownToHtml(contentString);
        editor.commands.setContent(htmlContent);
      } else if (shouldSkipUpdate) {
        console.log('✋ Skipping editor update - protecting user edits (isEditing:', editorState.isEditing, ', hasUserEdits:', hasUserEdits, ')');
      } else {
        console.log('📋 Content is same, no update needed');
      }
    } else {
      console.log('🔍 Editor update skipped - missing requirements:');
      console.log('  - Editor exists?', !!editor);
      console.log('  - Document content exists?', !!documentContent);
      console.log('  - Content array exists?', !!(documentContent && documentContent.content));
    }
  }, [editor, documentContent, markdownToHtml, editorState.isEditing, hasUserEdits]);

  // Auto-save functionality
  // Manual reload function that bypasses user edit protection
  const reloadDocument = useCallback(async () => {
    console.log('🔄 Manual document reload requested');
    setHasUserEdits(false); // Reset protection
    await loadDocumentContent();
  }, [loadDocumentContent]);

  const saveDocument = useCallback(async () => {
    if (!documentContent || readOnly || !editorState.isEditing) return;

    try {
      setIsSaving(true);
      // Replace all lines with the current content
      connection.replaceLines(documentId, 1, documentContent.content?.length || 1, editorState.content.join('\n'));
      setEditorState(prev => ({ ...prev, isEditing: false }));
      console.log('📄 Document saved successfully');
    } catch (err) {
      console.error('Failed to save document:', err);
    } finally {
      setIsSaving(false);
    }
  }, [connection, documentId, documentContent, editorState.content, editorState.isEditing, readOnly]);

  // Handle title changes
  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    // TODO: Save title to document metadata
  }, []);

  // Handle title editing
  const handleTitleClick = useCallback(() => {
    if (!readOnly) {
      setIsEditingTitle(true);
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  }, [readOnly]);

  const handleTitleBlur = useCallback(() => {
    setIsEditingTitle(false);
  }, []);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsEditingTitle(false);
      editor?.commands.focus();
    }
  }, [editor]);

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${
        currentTheme === 'dark' ? 'bg-gray-900' : 'bg-white'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
            Loading document...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${
        currentTheme === 'dark' ? 'bg-gray-900' : 'bg-white'
      }`}>
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={loadDocumentContent}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`notion-editor flex flex-col h-full ${
      currentTheme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'
    }`}>
      {/* Minimal Header */}
      <div className={`px-6 py-4 border-b ${
        currentTheme === 'dark' ? 'border-gray-800' : 'border-gray-100'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className={`p-2 rounded-lg transition-colors ${
                currentTheme === 'dark'
                  ? 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
              }`}
            >
              ←
            </button>
          </div>

          <div className="flex items-center space-x-3">
            {/* Reload button */}
            <button
              onClick={reloadDocument}
              disabled={isLoading}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                isLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : currentTheme === 'dark'
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Reload document from server"
            >
              🔄 Reload
            </button>
            
            {/* Comments toggle */}
            <button
              onClick={() => setShowComments(!showComments)}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                showComments
                  ? 'bg-blue-600 text-white'
                  : currentTheme === 'dark'
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Comments ({documentContent?.comments?.length || 0})
            </button>

            {/* Save indicator */}
            {!readOnly && (
              <div className="flex items-center space-x-2">
                {isSaving ? (
                  <div className="flex items-center space-x-2 text-sm text-blue-600">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600"></div>
                    <span>Saving...</span>
                  </div>
                ) : editorState.isEditing ? (
                  <span className="text-sm text-orange-600">Unsaved changes</span>
                ) : (
                  <span className="text-sm text-green-600">Saved</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* Document Title */}
          <div className="px-16 pt-12 pb-4">
            {isEditingTitle ? (
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className={`w-full text-4xl font-bold bg-transparent border-none outline-none ${
                  currentTheme === 'dark' ? 'text-gray-100' : 'text-gray-900'
                }`}
                placeholder="Untitled"
              />
            ) : (
              <h1
                onClick={handleTitleClick}
                className={`text-4xl font-bold cursor-pointer hover:bg-opacity-10 hover:bg-gray-500 rounded px-2 py-1 -mx-2 -my-1 transition-colors ${
                  currentTheme === 'dark' ? 'text-gray-100' : 'text-gray-900'
                } ${title ? '' : 'text-gray-400'}`}
              >
                {title || 'Untitled'}
              </h1>
            )}
          </div>

          {/* WYSIWYG Editor */}
          <div className="flex-1 px-16 pb-16 overflow-auto">
            <div className="min-h-full">
              <EditorContent 
                editor={editor} 
                className="min-h-full focus-within:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Comments Sidebar */}
        {showComments && (
          <div className={`w-80 border-l overflow-y-auto ${
            currentTheme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="p-6">
              <h3 className={`font-medium mb-6 ${
                currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
              }`}>
                Comments
              </h3>

              {/* Comments content */}
              <div className={`text-center py-8 ${
                currentTheme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              }`}>
                <p>No comments yet</p>
                <p className="text-sm mt-2">Select text to add a comment</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className={`px-6 py-2 border-t text-sm ${
        currentTheme === 'dark' 
          ? 'bg-gray-900 border-gray-800 text-gray-500' 
          : 'bg-gray-50 border-gray-100 text-gray-500'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <span>
              {editorState.content.length} lines, {editor?.getText().length || 0} characters
            </span>
            {readOnly && <span className="text-orange-600">Read Only</span>}
          </div>
          <div className="flex items-center space-x-4">
            <span>
              {collaborativeUsers.filter(u => u.isActive).length} active users
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentEditor;