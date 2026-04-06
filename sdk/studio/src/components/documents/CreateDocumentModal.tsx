import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/layout/ui/label';
import { Input, InputGroup, InputAddon } from '@/components/layout/ui/input';
import { Button } from '@/components/layout/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/layout/ui/dialog';
import { FileText } from 'lucide-react';

interface CreateDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDocument: (name: string, content: string) => Promise<void>;
  currentTheme: 'light' | 'dark';
}

const CreateDocumentModal: React.FC<CreateDocumentModalProps> = ({
  isOpen,
  onClose,
  onCreateDocument,
  currentTheme
}) => {
  const { t } = useTranslation('documents');
  const [documentName, setDocumentName] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!documentName.trim()) {
      setError(t('createModal.errors.nameRequired'));
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      await onCreateDocument(documentName.trim(), initialContent);
      // Reset form
      setDocumentName('');
      setInitialContent('');
      onClose();
    } catch (err) {
      setError(t('createModal.errors.createFailed'));
      console.error('Failed to create document:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setDocumentName('');
      setInitialContent('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('createModal.title')}</DialogTitle>
        </DialogHeader>

        <form id="document-form" onSubmit={handleSubmit}>
          <DialogBody className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 border border-red-300 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Document Name */}
          <div className="space-y-2">
            <Label htmlFor="documentName">
              {t('createModal.documentName')} *
            </Label>
            <InputGroup>
              <InputAddon mode="icon">
                <FileText size={16} />
              </InputAddon>
              <Input
                id="documentName"
                type="text"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder={t('createModal.documentNamePlaceholder')}
                disabled={isCreating}
                required
              />
            </InputGroup>
          </div>

          {/* Initial Content */}
          <div className="space-y-2">
            <Label htmlFor="initialContent">
              {t('createModal.initialContent')}
            </Label>
            <textarea
              id="initialContent"
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              placeholder={t('createModal.initialContentPlaceholder')}
              disabled={isCreating}
              rows={8}
              className={`
                w-full p-3 border rounded-lg transition-colors font-mono text-sm resize-none
                ${currentTheme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400 focus:border-blue-500'
                  : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500 focus:border-blue-500'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
                disabled:opacity-50
              `}
            />
          </div>

          </DialogBody>
        </form>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleClose}
            disabled={isCreating}
            variant="outline"
          >
            {t('createModal.cancel')}
          </Button>
          <Button
            type="submit"
            form="document-form"
            disabled={!documentName.trim() || isCreating}
            variant="primary"
          >
            {isCreating ? t('createModal.creating') : t('createModal.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateDocumentModal;
