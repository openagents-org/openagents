export enum ImportMode {
  CREATE_NEW = "create_new",
  OVERWRITE = "overwrite",
}

export interface ImportPreview {
  network_name: string;
  network_mode: string;
  mods?: string[];
  agent_groups?: string[];
  transports?: string[];
  export_timestamp?: string;
  export_notes?: string;
  source_version?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  preview: ImportPreview | null;
}

export interface ImportResult {
  success: boolean;
  message: string;
  network_restarted: boolean;
  errors?: string[];
  warnings?: string[];
  applied_config?: {
    network_name?: string;
    mode?: string;
    mods_count?: number;
  } | null;
}

export interface ExportManifest {
  version: string;
  export_timestamp: string;
  source_network: string;
  source_version: string;
  openagents_version: string;
  notes?: string;
  includes_password_hashes: boolean;
  includes_sensitive_config: boolean;
}

export interface ExportOptions {
  include_password_hashes?: boolean;
  include_sensitive_config?: boolean;
  notes?: string;
}

