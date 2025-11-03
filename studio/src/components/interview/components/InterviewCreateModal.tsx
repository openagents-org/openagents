import React, { useState, useRef } from 'react';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { useInterviewStore } from '@/stores/interviewStore';
import { toast } from 'sonner';

interface InterviewCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InterviewCreateModal: React.FC<InterviewCreateModalProps> = ({
  isOpen,
  onClose
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [uploadingPdf, setUploadingPdf] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const createTopic = useInterviewStore(state => state.createTopic);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are allowed');
      return;
    }

    // Validate file size (e.g., max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setPdfFile(file);

    // TODO: Upload file to server and get URL
    // For now, create a temporary object URL for preview
    setUploadingPdf(true);
    try {
      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // In a real implementation, you would upload the file to your server here
      // const formData = new FormData();
      // formData.append('file', file);
      // const response = await fetch('/api/upload-resume', {
      //   method: 'POST',
      //   body: formData,
      // });
      // const data = await response.json();
      // setPdfUrl(data.url);

      // For now, use a temporary object URL
      const tempUrl = URL.createObjectURL(file);
      setPdfUrl(tempUrl);

      toast.success('Resume uploaded successfully');
    } catch (error) {
      console.error('Failed to upload file:', error);
      toast.error('Failed to upload resume');
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleRemovePdf = () => {
    if (pdfUrl && pdfUrl.startsWith('blob:')) {
      URL.revokeObjectURL(pdfUrl);
    }
    setPdfFile(null);
    setPdfUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Please fill in title and content');
      return;
    }

    if (!pdfUrl) {
      toast.error('Please upload your resume (PDF)');
      return;
    }

    setIsSubmitting(true);
    const success = await createTopic({
      title: title.trim(),
      content: content.trim(),
      resume_url: pdfUrl,
    });

    if (success) {
      setTitle('');
      setContent('');
      setShowPreview(false);
      handleRemovePdf();
      toast.success('Interview session created successfully');
      onClose();
    } else {
      toast.error('Failed to create interview session');
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setTitle('');
    setContent('');
    setShowPreview(false);
    handleRemovePdf();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
        />

        {/* Modal */}
        <div className="absolute inline-block w-full max-w-2xl left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-lg bg-white dark:bg-gray-800">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Create Interview Session
              </h3>
              <button
                onClick={handleClose}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Title input */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter interview session title..."
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>

            {/* Content input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Description (Markdown supported)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className={`text-xs px-3 py-1 rounded transition-colors ${
                    showPreview
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>

              {showPreview ? (
                <div className="w-full p-3 border rounded-md min-h-[200px] bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  {content.trim() ? (
                    <MarkdownRenderer
                      content={content}
                    />
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500">
                      Preview will appear here...
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter interview session description... (Markdown supported)"
                  rows={8}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                />
              )}
            </div>

            {/* PDF Resume Upload */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Resume (PDF) <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Upload your resume in PDF format (max 10MB)
              </p>

              {!pdfFile ? (
                <div className="relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={uploadingPdf || isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPdf || isSubmitting}
                    className="w-full px-4 py-3 border-2 border-dashed rounded-md transition-colors bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                  >
                    <div className="flex flex-col items-center space-y-2">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="text-sm">
                        {uploadingPdf ? 'Uploading...' : 'Click to upload PDF resume'}
                      </span>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 border rounded-md bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <div className="flex items-center space-x-3">
                    <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {pdfFile.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePdf}
                    disabled={isSubmitting}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Privacy Notice */}
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <div className="flex items-start space-x-2">
                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-xs text-yellow-800 dark:text-yellow-200">
                  <p className="font-medium mb-1">Private Session</p>
                  <p>This interview session is private. Only you, interviewers, and administrators can view it.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="px-6 py-4 border-t flex justify-end space-x-3 border-gray-200 dark:border-gray-700">
            <button
              onClick={handleClose}
              disabled={isSubmitting || uploadingPdf}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || !content.trim() || !pdfUrl || isSubmitting || uploadingPdf}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                !title.trim() || !content.trim() || !pdfUrl || isSubmitting || uploadingPdf
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Creating...' : 'Create Interview Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewCreateModal;
