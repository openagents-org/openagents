import React from 'react';
import { ConfigField } from '@/types/modConfig';
import { Input } from '@/components/layout/ui/input';
import { Label } from '@/components/layout/ui/label';
import { Switch, SwitchWrapper } from '@/components/layout/ui/switch';
import { Textarea } from '@/components/layout/ui/textarea';
import { Button } from '@/components/layout/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/layout/ui/select';
import { Plus, Trash2 } from 'lucide-react';

interface ConfigFieldRendererProps {
  field: ConfigField;
  value: any;
  onChange: (value: any) => void;
  errors?: Record<string, string>;
  path?: string; // For nested fields
}

const ConfigFieldRenderer: React.FC<ConfigFieldRendererProps> = ({
  field,
  value,
  onChange,
  errors = {},
  path = '',
}) => {
  const fieldPath = path ? `${path}.${field.key}` : field.key;
  const error = errors[fieldPath];
  const displayValue = value !== undefined && value !== null ? value : field.default;

  const renderField = () => {
    switch (field.type) {
      case 'string':
        return (
          <Input
            type="text"
            value={displayValue || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            variant="lg"
            className={error ? 'border-red-500' : ''}
          />
        );

      case 'password':
        return (
          <Input
            type="password"
            value={displayValue || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            variant="lg"
            className={error ? 'border-red-500' : ''}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={displayValue ?? ''}
            onChange={(e) => {
              const numValue = e.target.value === '' ? undefined : parseFloat(e.target.value);
              onChange(isNaN(numValue as number) ? undefined : numValue);
            }}
            min={field.min}
            max={field.max}
            step={field.step}
            variant="lg"
            className={error ? 'border-red-500' : ''}
          />
        );

      case 'boolean':
        return (
          <div className="flex items-center justify-end">
            <SwitchWrapper>
              <Switch
                checked={displayValue !== false}
                onCheckedChange={onChange}
              />
            </SwitchWrapper>
          </div>
        );

      case 'select':
        return (
          <Select
            value={String(displayValue ?? '')}
            onValueChange={(val) => {
              // Try to convert to number if options are numbers
              const option = field.options?.find(opt => String(opt.value) === val);
              onChange(option?.value);
            }}
          >
            <SelectTrigger size="lg" className={error ? 'border-red-500' : ''}>
              <SelectValue placeholder={field.placeholder || '请选择...'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(displayValue) ? displayValue : [];
        return (
          <div className="space-y-2">
            <Select
              value=""
              onValueChange={(val) => {
                const option = field.options?.find(opt => String(opt.value) === val);
                if (option && !selectedValues.includes(option.value)) {
                  onChange([...selectedValues, option.value]);
                }
              }}
            >
              <SelectTrigger size="lg" className={error ? 'border-red-500' : ''}>
                <SelectValue placeholder={field.placeholder || '添加选项...'} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option) => (
                  <SelectItem 
                    key={String(option.value)} 
                    value={String(option.value)}
                    disabled={selectedValues.includes(option.value)}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedValues.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedValues.map((val: any) => {
                  const option = field.options?.find(opt => opt.value === val);
                  return (
                    <span
                      key={String(val)}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded text-sm"
                    >
                      {option?.label || String(val)}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          onChange(selectedValues.filter((v: any) => v !== val));
                        }}
                        className="h-auto w-auto p-0.5 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-transparent"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'text':
        return (
          <Textarea
            value={displayValue || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows || 4}
            maxLength={field.maxLength}
            variant="lg"
            className={`resize-none ${
              error ? 'border-red-500' : ''
            }`}
          />
        );

      case 'list':
        const listValue = Array.isArray(displayValue) ? displayValue : [];
        return (
          <div className="space-y-2">
            {listValue.map((item: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                {field.item_type === 'object' && field.item_schema ? (
                  <div className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800/50 space-y-4">
                    {field.item_schema.fields.map((subField) => (
                      <ConfigFieldRenderer
                        key={subField.key}
                        field={subField}
                        value={item[subField.key]}
                        onChange={(val) => {
                          const newList = [...listValue];
                          newList[index] = { ...newList[index], [subField.key]: val };
                          onChange(newList);
                        }}
                        path={`${fieldPath}[${index}]`}
                        errors={errors}
                      />
                    ))}
                  </div>
                ) : (
                  <Input
                    type={field.item_type === 'number' ? 'number' : 'text'}
                    value={item ?? ''}
                    onChange={(e) => {
                      const newList = [...listValue];
                      newList[index] = field.item_type === 'number' 
                        ? parseFloat(e.target.value) || 0
                        : e.target.value;
                      onChange(newList);
                    }}
                    variant="lg"
                    className="flex-1"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    onChange(listValue.filter((_: any, i: number) => i !== index));
                  }}
                  className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const newItem = field.item_type === 'object' && field.item_schema
                  ? {}
                  : (field.item_type === 'number' ? 0 : '');
                onChange([...listValue, newItem]);
              }}
              className="text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              <Plus className="w-4 h-4 mr-2" />
              添加项
            </Button>
          </div>
        );

      case 'object':
        const objectValue = typeof displayValue === 'object' && displayValue !== null 
          ? displayValue 
          : {};
        return (
          <div className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800/50 space-y-4">
            {field.fields?.map((subField) => (
              <ConfigFieldRenderer
                key={subField.key}
                field={subField}
                value={objectValue[subField.key]}
                onChange={(val) => {
                  onChange({ ...objectValue, [subField.key]: val });
                }}
                path={fieldPath}
                errors={errors}
              />
            ))}
          </div>
        );

      default:
        return (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            不支持的字段类型: {field.type}
          </div>
        );
    }
  };

  // For boolean fields, render label and switch on same line
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <Label htmlFor={fieldPath} className="text-sm text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {field.description}
            </p>
          )}
        </div>
        {renderField()}
        {error && (
          <p className="text-xs text-red-500 mt-1">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor={fieldPath} className="text-sm text-gray-700 dark:text-gray-300">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {field.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-1.5">
          {field.description}
        </p>
      )}
      <div className="mt-1.5">
        {renderField()}
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
};

export default ConfigFieldRenderer;

