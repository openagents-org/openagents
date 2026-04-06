import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useAuthStore } from '@/stores/authStore';
import { ConfigSchema, SaveConfigResponse } from '@/types/modConfig';
import ConfigFieldRenderer from './ConfigFieldRenderer';
import { getModConfig, getModSchema, updateModConfig, createApiOptions } from '@/services/modManagementApi';

interface ModSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modId: string;
  modName: string;
  onSave?: () => void;
}

const ModSettingsDialog: React.FC<ModSettingsDialogProps> = ({
  open,
  onOpenChange,
  modId,
  modName,
  onSave,
}) => {
  const { t } = useTranslation('admin');
  const { selectedNetwork } = useAuthStore();

  // Extract mod display name
  const modDisplayName = modName.split('.').pop() || modName;
  
  // State for form values
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setFormData({});
      setConfigSchema(null);
      setErrors({});
    }
  }, [open]);

  // Load config schema and current config from API
  useEffect(() => {
    if (!open || !selectedNetwork) return;

    const loadConfigData = async () => {
      setIsLoadingSchema(true);
      const apiOptions = createApiOptions(selectedNetwork);
      
      if (!apiOptions) {
        toast.error(t('modManagement.settings.notConnected'));
        setIsLoadingSchema(false);
        return;
      }

      try {
        // Load schema and config in parallel
        const [schema, config] = await Promise.all([
          getModSchema(apiOptions, modId),
          getModConfig(apiOptions, modId).catch(() => ({})) // Fallback to empty object if config doesn't exist
        ]);

        setConfigSchema(schema);

        // Initialize form data with defaults from schema
        const defaultValues: Record<string, any> = {};
        if (schema) {
          schema.sections.forEach((section) => {
            section.fields.forEach((field) => {
              if (field.default !== undefined) {
                defaultValues[field.key] = field.default;
              }
            });
          });
        }

        // Merge defaults with current config
        const mergedConfig = { ...defaultValues, ...config };
        setFormData(mergedConfig);
      } catch (error: any) {
        console.error('Failed to load config data:', error);
        toast.error(t('modManagement.settings.loadFailed', 'Failed to load configuration') + ': ' + (error.message || 'Unknown error'));
      } finally {
        setIsLoadingSchema(false);
      }
    };

    loadConfigData();
  }, [open, modId, selectedNetwork, t]);

  // Handle field value change
  const handleFieldChange = (fieldPath: string, value: any) => {
    setFormData((prev) => {
      const newData = JSON.parse(JSON.stringify(prev)); // Deep clone
      
      // Handle nested paths like "parent.child" or "items[0].field"
      const setNestedValue = (obj: any, path: string, val: any) => {
        const parts = path.split('.');
        let current = obj;
        
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
          
          if (arrayMatch) {
            const arrayKey = arrayMatch[1];
            const index = parseInt(arrayMatch[2]);
            if (!current[arrayKey]) current[arrayKey] = [];
            if (!current[arrayKey][index]) current[arrayKey][index] = {};
            current = current[arrayKey][index];
          } else {
            if (!current[part] || typeof current[part] !== 'object') {
              current[part] = {};
            }
            current = current[part];
          }
        }
        
        const lastPart = parts[parts.length - 1];
        const lastArrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);
        
        if (lastArrayMatch) {
          const arrayKey = lastArrayMatch[1];
          const index = parseInt(lastArrayMatch[2]);
          if (!current[arrayKey]) current[arrayKey] = [];
          current[arrayKey][index] = val;
        } else {
          current[lastPart] = val;
        }
      };
      
      setNestedValue(newData, fieldPath, value);
      return newData;
    });
    
    // Clear error for this field
    if (errors[fieldPath]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldPath];
        return newErrors;
      });
    }
  };

  // Validate form data
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!configSchema) return true;

    const validateField = (field: any, value: any, path: string) => {
      if (field.required && (value === undefined || value === null || value === '')) {
        newErrors[path] = `${field.label} 是必填项`;
        return false;
      }

      if (field.type === 'number') {
        if (value !== undefined && value !== null) {
          if (field.min !== undefined && value < field.min) {
            newErrors[path] = `值不能小于 ${field.min}`;
            return false;
          }
          if (field.max !== undefined && value > field.max) {
            newErrors[path] = `值不能大于 ${field.max}`;
            return false;
          }
        }
      }

      if (field.type === 'string' && value) {
        if (field.maxLength && value.length > field.maxLength) {
          newErrors[path] = `长度不能超过 ${field.maxLength} 个字符`;
          return false;
        }
        if (field.pattern) {
          const regex = new RegExp(field.pattern);
          if (!regex.test(value)) {
            newErrors[path] = '格式不正确';
            return false;
          }
        }
      }

      // Validate nested fields
      if (field.type === 'object' && field.fields) {
        const objValue = typeof value === 'object' && value !== null ? value : {};
        field.fields.forEach((subField: any) => {
          validateField(subField, objValue[subField.key], `${path}.${subField.key}`);
        });
      }

      return true;
    };

    configSchema.sections.forEach((section) => {
      section.fields.forEach((field) => {
        const value = formData[field.key];
        validateField(field, value, field.key);
      });
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle save
  const handleSave = async () => {
    const apiOptions = createApiOptions(selectedNetwork);
    
    if (!apiOptions) {
      toast.error(t('modManagement.settings.notConnected'));
      return;
    }

    // Validate form
    if (!validateForm()) {
      toast.error(t('modManagement.settings.validationFailed', '请检查表单错误'));
      return;
    }

    setIsSaving(true);
    try {
      const saveResponse = await updateModConfig(apiOptions, modId, formData);
      
      toast.success(saveResponse.message || t('modManagement.settings.saveSuccess', 'Configuration saved successfully'));
      onSave?.();
      
      // Show restart dialog will be handled by parent if requiresRestart is true
      if (saveResponse.requiresRestart) {
        // Parent will handle showing restart dialog
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to save mod config:', error);
      
      // Handle validation errors from backend
      if (error.errors) {
        setErrors(error.errors);
        toast.error(error.message || t('modManagement.settings.saveFailed', 'Failed to save configuration'));
      } else {
        toast.error(error.message || t('modManagement.settings.saveFailed', 'Failed to save configuration'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Render config fields based on schema
  const renderConfigFields = () => {
    // If schema is available, use schema-driven rendering
    if (configSchema && configSchema.sections) {
      return (
        <div className="space-y-6">
          {configSchema.sections.map((section) => (
            <div key={section.id}>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
                {section.title}
              </h3>
              <div className="space-y-4">
                {section.fields.map((field) => (
                  <ConfigFieldRenderer
                    key={field.key}
                    field={field}
                    value={formData[field.key]}
                    onChange={(value) => handleFieldChange(field.key, value)}
                    errors={errors}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Fallback: Show JSON editor if no schema
    if (isLoadingSchema) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('modManagement.settings.loadingSchema', '加载配置模式...')}
            </p>
          </div>
        </div>
      );
    }

    // No schema available - show empty state
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg
              className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t('modManagement.settings.noSchema.title', '暂无配置模式')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('modManagement.settings.noSchema.description', '此 Mod 尚未定义配置模式。配置模式将在 Mod 的 manifest.json 文件中定义。')}
          </p>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {t('modManagement.settings.title', '{{modName}} 设置', { modName: modDisplayName })}
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-4 overflow-y-auto min-h-0">
          {renderConfigFields()}
        </div>

        {/* Bottom buttons */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('modManagement.settings.cancel', '取消')}
          </button>
          {configSchema && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving 
                ? t('modManagement.settings.saving', '保存中...')
                : t('modManagement.settings.save', '保存设置')
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModSettingsDialog;

