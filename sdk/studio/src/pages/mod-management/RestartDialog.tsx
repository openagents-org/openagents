import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogBody,
} from '@/components/layout/ui/dialog';
import { Button } from '@/components/layout/ui/button';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface RestartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestartNow?: () => void | Promise<void>;
  onRestartLater?: () => void;
}

const RestartDialog: React.FC<RestartDialogProps> = ({
  open,
  onOpenChange,
  onRestartNow,
  onRestartLater,
}) => {
  const { t } = useTranslation('admin');
  const [isRestarting, setIsRestarting] = useState(false);

  const handleRestartNow = async () => {
    setIsRestarting(true);
    try {
      await onRestartNow?.();
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRestartLater = () => {
    onRestartLater?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <DialogTitle>
              {t('modManagement.restart.success', '✅ 设置保存成功！')}
            </DialogTitle>
          </div>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-start gap-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t('modManagement.restart.warning', '⚠️ 需要重启网络才能使更改生效。')}
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleRestartLater}
          >
            {t('modManagement.restart.later', '稍后重启')}
          </Button>
          <Button
            variant="primary"
            onClick={handleRestartNow}
            disabled={isRestarting}
          >
            {isRestarting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('modManagement.restart.restarting', '正在重启...')}
              </>
            ) : (
              t('modManagement.restart.now', '立即重启')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RestartDialog;

