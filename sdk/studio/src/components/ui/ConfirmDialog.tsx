import React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/layout/ui/dialog"
import { Button } from "@/components/layout/ui/button"
import { AlertTriangle, Info } from "lucide-react"

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  type?: "danger" | "warning" | "info"
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  type = "warning",
}) => {
  // Determine the icon and button variant based on type
  let icon = null
  let confirmButtonVariant: "primary" | "destructive" = "primary"

  switch (type) {
    case "danger":
      confirmButtonVariant = "destructive"
      icon = <AlertTriangle className="h-6 w-6 text-red-500" />
      break
    case "info":
      confirmButtonVariant = "primary"
      icon = <Info className="h-6 w-6 text-blue-500" />
      break
    case "warning":
    default:
      confirmButtonVariant = "primary"
      icon = <AlertTriangle className="h-6 w-6 text-yellow-500" />
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-4 mb-2">
            <div className="flex-shrink-0">{icon}</div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" size="md" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={confirmButtonVariant} size="md" onClick={onConfirm}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialog 