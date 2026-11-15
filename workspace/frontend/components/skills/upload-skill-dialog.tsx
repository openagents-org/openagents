'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { WorkspaceCustomSkill } from '@/lib/types';
import { CUSTOM_SKILL_ID_RE, deriveSkillId, extractErrorMessage } from './skill-utils';

export function UploadSkillDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (skill: WorkspaceCustomSkill) => void;
}) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null); setId(''); setName(''); setDescription('');
    setError(null); setSubmitting(false);
  }, []);

  const onPickFile = (f: File | null) => {
    setError(null);
    setFile(f);
    if (f) {
      setId(deriveSkillId(f.name));
      setName(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const ext = file ? file.name.toLowerCase().slice(file.name.lastIndexOf('.')) : '';
  const extOk = ext === '.md' || ext === '.zip';
  const idValid = CUSTOM_SKILL_ID_RE.test(id);
  const canSubmit = !!file && extOk && idValid && !submitting;
  const extInvalid = !!file && !extOk;
  const idInvalid = id !== '' && !idValid;

  const submit = async () => {
    if (!file) { setError(t('skills.uploadNoFile')); return; }
    if (!extOk) { setError(t('skills.uploadExtError')); return; }
    if (!idValid) { setError(t('skills.uploadIdErrorLong')); return; }
    setSubmitting(true);
    setError(null);
    try {
      const created = await workspaceApi.uploadCustomSkill(file, {
        id: id.trim(),
        name: name.trim() || id.trim(),
        description: description.trim(),
      });
      toast.success(t('skills.uploadSuccess', { name: created.name }));
      onUploaded(created);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('skills.uploadTitle')}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-4">
            {/* File picker: the whole dashed row is the label for the hidden input */}
            <Field data-invalid={extInvalid || undefined}>
              <FieldLabel htmlFor="skill-upload-file">{t('skills.uploadPackageLabel')}</FieldLabel>
              <label
                htmlFor="skill-upload-file"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <Upload className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs">
                  {file ? file.name : t('skills.uploadChooseFile')}
                </span>
                {file && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                )}
                <input
                  id="skill-upload-file"
                  type="file"
                  accept=".md,.zip"
                  className="sr-only"
                  aria-invalid={extInvalid || undefined}
                  onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                />
              </label>
              {extInvalid && <FieldError>{t('skills.uploadExtError')}</FieldError>}
              <FieldDescription>{t('skills.uploadZipHint')}</FieldDescription>
            </Field>

            <Field data-invalid={idInvalid || undefined}>
              <FieldLabel htmlFor="skill-upload-id">{t('skills.uploadIdLabel')}</FieldLabel>
              <Input
                id="skill-upload-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={t('skills.uploadIdPlaceholder')}
                aria-invalid={idInvalid || undefined}
              />
              {idInvalid && <FieldError>{t('skills.uploadIdError')}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="skill-upload-name">{t('skills.uploadNameLabel')}</FieldLabel>
              <Input
                id="skill-upload-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('skills.uploadNamePlaceholder')}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="skill-upload-description">{t('skills.uploadDescriptionLabel')}</FieldLabel>
              <Textarea
                id="skill-upload-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder={t('skills.uploadDescriptionPlaceholder')}
                className="resize-none"
              />
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            {submitting ? t('skills.uploading') : t('skills.uploadSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
