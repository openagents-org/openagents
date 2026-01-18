import React, { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wikiStore"
import { toast } from "sonner"
import WikiEditor from "./WikiEditor"
import { Label } from "@/components/layout/ui/label"
import { Input, InputGroup, InputAddon } from "@/components/layout/ui/input"
import { Button } from "@/components/layout/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/layout/ui/dialog"
import { FileText, Type } from "lucide-react"

interface WikiCreateModalProps {
  isOpen: boolean
  onClose: () => void
}

const WikiCreateModal: React.FC<WikiCreateModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation("wiki")
  const [pagePath, setPagePath] = useState("")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")

  const { createPage } = useWikiStore()

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPagePath("")
      setTitle("")
      setContent("")
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pagePath.trim() || !title.trim() || !content.trim()) return

    const success = await createPage(pagePath, title, content)
    if (success) {
      onClose()
    } else {
      // Show error toast
      toast.error(t("createModal.errors.createFailed"))
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("createModal.title")}</DialogTitle>
        </DialogHeader>

        <DialogBody className="overflow-y-auto">
          <form
            id="wiki-form"
            onSubmit={handleSubmit}
            className="flex flex-col space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="pagePath">{t("createModal.pagePath")} *</Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <FileText size={16} />
                </InputAddon>
                <Input
                  id="pagePath"
                  type="text"
                  value={pagePath}
                  onChange={(e) => setPagePath(e.target.value)}
                  placeholder={t("createModal.pagePathPlaceholder")}
                  required
                />
              </InputGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pageTitle">{t("createModal.pageTitle")} *</Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <Type size={16} />
                </InputAddon>
                <Input
                  id="pageTitle"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("createModal.pageTitlePlaceholder")}
                  required
                />
              </InputGroup>
            </div>

            <div className="space-y-2 flex-1 min-h-[300px] flex flex-col">
              <Label htmlFor="content">{t("createModal.content")} *</Label>
              <WikiEditor
                value={content}
                onChange={setContent}
                modes={["edit", "preview"]}
                style={{ flex: 1, minHeight: "250px" }}
                placeholder={t("createModal.contentPlaceholder")}
                textareaProps={{ required: true }}
              />
            </div>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button type="button" onClick={onClose} variant="outline">
            {t("createModal.cancel")}
          </Button>
          <Button
            type="submit"
            form="wiki-form"
            disabled={!pagePath.trim() || !title.trim() || !content.trim()}
            variant="primary"
          >
            {t("createModal.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default WikiCreateModal
