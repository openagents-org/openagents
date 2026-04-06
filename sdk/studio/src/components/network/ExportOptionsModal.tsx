import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExportOptions } from "@/types/networkManagement"
import { Button } from "@/components/layout/ui/button"
import { Label } from "@/components/layout/ui/label"
import { Textarea } from "@/components/layout/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/layout/ui/dialog"

interface ExportOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (options: ExportOptions) => void
  isExporting?: boolean
}

const ExportOptionsModal: React.FC<ExportOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isExporting = false,
}) => {
  const { t } = useTranslation("network")
  const [includePasswordHashes, setIncludePasswordHashes] = useState(false)
  const [includeSensitiveConfig, setIncludeSensitiveConfig] = useState(false)
  const [notes, setNotes] = useState("")

  const handleConfirm = () => {
    onConfirm({
      include_password_hashes: includePasswordHashes,
      include_sensitive_config: includeSensitiveConfig,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("importExport.exportOptions.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {/* Include Password Hashes */}
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="include-password-hashes"
                  type="checkbox"
                  checked={includePasswordHashes}
                  onChange={(e) => setIncludePasswordHashes(e.target.checked)}
                  disabled={isExporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label
                  htmlFor="include-password-hashes"
                  className="font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("importExport.exportOptions.includePasswordHashes")}
                </label>
                <p className="text-gray-500 dark:text-gray-400">
                  {t("importExport.exportOptions.includePasswordHashesDesc")}
                </p>
              </div>
            </div>

            {/* Include Sensitive Config */}
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="include-sensitive-config"
                  type="checkbox"
                  checked={includeSensitiveConfig}
                  onChange={(e) =>
                    setIncludeSensitiveConfig(e.target.checked)
                  }
                  disabled={isExporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label
                  htmlFor="include-sensitive-config"
                  className="font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("importExport.exportOptions.includeSensitiveConfig")}
                </label>
                <p className="text-gray-500 dark:text-gray-400">
                  {t("importExport.exportOptions.includeSensitiveConfigDesc")}
                </p>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="export-notes">
                {t("importExport.exportOptions.notes")}
              </Label>
              <Textarea
                id="export-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isExporting}
                placeholder={t("importExport.exportOptions.notesPlaceholder")}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} disabled={isExporting} variant="outline">
            {t("importExport.exportOptions.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isExporting}
            variant="primary"
          >
            {isExporting
              ? t("importExport.exportOptions.exporting")
              : t("importExport.exportOptions.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ExportOptionsModal

