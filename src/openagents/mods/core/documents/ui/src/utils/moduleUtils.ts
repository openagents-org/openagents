export interface ModuleInfo {
  name: string;
  enabled: boolean;
  config?: Record<string, any>;
}

export interface ModUISidebarConfig {
  label: string;
  icon: string;
  position: number;
}

export interface ModUIConfig {
  enabled: boolean;
  entry: string;
  route: string;
  sidebar?: ModUISidebarConfig;
  permissions?: string[];
}

export interface HealthResponse {
  success: boolean;
  status: string;
  data: {
    network_id: string;
    network_name: string;
    is_running: boolean;
    mods: ModuleInfo[];
    mod_uis?: Record<string, ModUIConfig>;
    [key: string]: any;
  };
}

