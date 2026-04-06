// Mod Configuration Schema Types

export type FieldType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'select' 
  | 'multiselect' 
  | 'list' 
  | 'object' 
  | 'text' 
  | 'password';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface ConfigField {
  key: string;           // 配置键名
  type: FieldType;       // 字段类型
  label: string;         // 显示标签
  description?: string;  // 帮助文本
  default?: any;         // 默认值
  required?: boolean;    // 是否必填
  placeholder?: string;  // 占位符

  // 类型特定属性
  min?: number;          // number 类型
  max?: number;          // number 类型
  step?: number;         // number 类型
  maxLength?: number;    // string/text 类型
  pattern?: string;      // string 类型 (正则表达式)
  options?: SelectOption[];  // select/multiselect 类型
  item_type?: FieldType;     // list 类型的元素类型
  item_schema?: { fields: ConfigField[] };  // list<object> 类型
  fields?: ConfigField[];    // object 类型的嵌套字段
  rows?: number;         // text 类型
}

export interface ConfigSection {
  id: string;
  title: string;
  fields: ConfigField[];
}

export interface ConfigSchema {
  sections: ConfigSection[];
}

export interface ModInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  hasConfig: boolean;
  configSchema?: ConfigSchema;
}

export interface SaveConfigResponse {
  success: boolean;
  requiresRestart: boolean;
  message?: string;
  errors?: Record<string, string>;
}

