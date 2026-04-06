import { networkFetch } from "@/utils/httpClient";
import { useAuthStore } from "@/stores/authStore";
import {
  ImportMode,
  ImportValidationResult,
  ImportResult,
  ExportOptions,
} from "@/types/networkManagement";

/**
 * Network Management Service
 * Handles network import/export operations
 */
class NetworkManagementService {
  /**
   * Get the current network connection info
   */
  private getNetworkInfo() {
    const { selectedNetwork } = useAuthStore.getState();
    if (!selectedNetwork) {
      throw new Error("No network connection available");
    }
    return selectedNetwork;
  }

  /**
   * Export network configuration as .zip file
   */
  async exportNetwork(
    options: ExportOptions = {},
    agentId?: string,
    secret?: string
  ): Promise<Blob> {
    const network = this.getNetworkInfo();
    const { host, port, useHttps } = network;

    // Build query parameters
    const params = new URLSearchParams();
    if (options.include_password_hashes) {
      params.append("include_password_hashes", "true");
    }
    if (options.include_sensitive_config) {
      params.append("include_sensitive_config", "true");
    }
    if (options.notes) {
      params.append("notes", options.notes);
    }

    const queryString = params.toString();
    const endpoint = `/api/network/export${queryString ? `?${queryString}` : ""}`;

    // Build headers with authentication
    const headers: HeadersInit = {};
    if (agentId && secret) {
      headers["X-Agent-ID"] = agentId;
      headers["X-Agent-Secret"] = secret;
    }

    const response = await networkFetch(host, port, endpoint, {
      method: "GET",
      useHttps: useHttps || false,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Export failed: ${response.status} ${errorText}`);
    }

    return await response.blob();
  }

  /**
   * Validate uploaded .zip file before import
   */
  async validateImport(
    file: File,
    agentId?: string,
    secret?: string
  ): Promise<ImportValidationResult> {
    const network = this.getNetworkInfo();
    const { host, port, useHttps } = network;

    const formData = new FormData();
    formData.append("file", file);

    // For FormData, we need to use fetch directly to avoid setting Content-Type header
    // The browser will automatically set Content-Type with boundary for FormData
    const protocol = useHttps ? "https" : "http";
    const url = `${protocol}://${host}:${port}/api/network/import/validate`;

    // Build headers with authentication
    const headers: HeadersInit = {};
    if (agentId && secret) {
      headers["X-Agent-ID"] = agentId;
      headers["X-Agent-Secret"] = secret;
    }

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers,
      // Don't set Content-Type - let browser set it with boundary
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validation failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Apply imported network configuration and restart network
   */
  async applyImport(
    file: File,
    mode: ImportMode,
    newName?: string,
    agentId?: string,
    secret?: string
  ): Promise<ImportResult> {
    const network = this.getNetworkInfo();
    const { host, port, useHttps } = network;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);
    if (newName) {
      formData.append("new_name", newName);
    }

    // For FormData, we need to use fetch directly to avoid setting Content-Type header
    // The browser will automatically set Content-Type with boundary for FormData
    const protocol = useHttps ? "https" : "http";
    const url = `${protocol}://${host}:${port}/api/network/import/apply`;

    // Build headers with authentication
    const headers: HeadersInit = {};
    if (agentId && secret) {
      headers["X-Agent-ID"] = agentId;
      headers["X-Agent-Secret"] = secret;
    }

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers,
      // Don't set Content-Type - let browser set it with boundary
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Import failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Download blob as file
   */
  downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}

export const networkManagementService = new NetworkManagementService();

