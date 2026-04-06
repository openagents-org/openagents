import React, { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { useProfileData } from "@/pages/profile/hooks/useProfileData";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/layout/ui/button";
import { Badge } from "@/components/layout/ui/badge";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import { DataTable } from "@/components/layout/ui/data-table";
import {
  Lock,
  RefreshCw,
  Layers,
  CheckCircle,
  XCircle,
  Plus,
  Power,
  Loader2,
  Settings,
} from "lucide-react";
import ModSettingsDialog from "./ModSettingsDialog";
import RestartDialog from "./RestartDialog";
import {
  createApiOptions,
  restartNetwork,
} from "@/services/modManagementApi";
import { ModInfo } from "@/types/modConfig";

const ModManagementPage: React.FC = () => {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const { healthData, refresh, loading: healthLoading } = useProfileData();
  const { isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();
  const { connector } = useOpenAgents();
  const { agentName, selectedNetwork } = useAuthStore();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMod, setLoadingMod] = useState<string | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);

  // Convert health data to ModInfo list
  const modsList = useMemo<ModInfo[]>(() => {
    if (!healthData?.data) {
      return [];
    }

    const modsMap = new Map<string, ModInfo>();
    const { mods = [], dynamic_mods } = healthData.data;

    // Process static mods from data.mods
    mods.forEach((mod: any) => {
      const modName = mod.name;
      const modId = modName.split('.').pop() || modName;
      const displayName = modId
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      modsMap.set(modName, {
        id: modName,
        name: modName,
        displayName: displayName,
        description: '', // Health API doesn't provide description
        enabled: mod.enabled || false,
        hasConfig: mod.config && Object.keys(mod.config).length > 0,
      });
    });

    // Process dynamic mods
    if (dynamic_mods?.loaded && Array.isArray(dynamic_mods.loaded)) {
      const details = dynamic_mods.details || {};
      dynamic_mods.loaded.forEach((modId: string) => {
        const detail = details[modId];
        const modPath = detail?.mod_path || modId;
        
        // Only add if not already in the map (from static mods)
        if (!modsMap.has(modPath)) {
          const displayName = modId
            .split('_')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          modsMap.set(modPath, {
            id: modPath,
            name: modPath,
            displayName: displayName,
            description: '', // Health API doesn't provide description
            enabled: true, // Dynamic mods are loaded, so they're enabled
            hasConfig: false, // Dynamic mods typically don't have config in health data
          });
        }
      });
    }

    return Array.from(modsMap.values());
  }, [healthData]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Handle open settings dialog
  const handleOpenSettings = useCallback((mod: ModInfo) => {
    setSelectedMod(mod);
    setSettingsDialogOpen(true);
  }, []);

  // Handle settings saved
  const handleSettingsSaved = () => {
    setRestartDialogOpen(true);
    refresh();
  };

  // Handle restart now
  const handleRestartNow = useCallback(async () => {
    const apiOptions = createApiOptions(selectedNetwork);
    if (!apiOptions) {
      toast.error(
        t("modManagement.restart.notConnected", "Not connected to network")
      );
      return;
    }

    try {
      const result = await restartNetwork(apiOptions);
      // Show info message since manual restart is required
      toast.info(
        result.message ||
          t(
            "modManagement.restart.manualRestartRequired",
            "Please manually restart the OpenAgents process to apply changes."
          )
      );
    } catch (error: any) {
      console.error("Failed to restart network:", error);
      toast.error(
        t("modManagement.restart.restartFailed", "Failed to restart network") +
          ": " +
          (error.message || "Unknown error")
      );
    }
  }, [selectedNetwork, t]);

  // Handle toggle mod (enable/disable) - still using event system for now
  const handleToggleMod = useCallback(
    async (modId: string, currentEnabled: boolean) => {
      if (!connector) {
        toast.error(t("modManagement.loadMod.notConnected"));
        return;
      }

      setLoadingMod(modId);
      try {
        const response = await connector.sendEvent({
          event_name: currentEnabled
            ? "system.mod.disable"
            : "system.mod.enable",
          source_id: agentName || "system",
          destination_id: "system:system",
          payload: {
            mod_path: modId,
          },
        });

        if (response.success) {
          toast.success(
            currentEnabled
              ? t("modManagement.actions.disableSuccess", {
                  modName: modId.split(".").pop(),
                })
              : t("modManagement.actions.enableSuccess", {
                  modName: modId.split(".").pop(),
                })
          );
          setTimeout(() => {
            refresh();
          }, 500);
        } else {
          toast.error(
            t("modManagement.actions.toggleFailed", {
              error: response.message || "Unknown error",
            })
          );
        }
      } catch (error: any) {
        console.error("Failed to toggle Mod:", error);
        toast.error(
          t("modManagement.actions.toggleFailed", {
            error: error.message || "Unknown error",
          })
        );
      } finally {
        setLoadingMod(null);
      }
    },
    [connector, agentName, refresh, t]
  );

  // Define columns for DataTable
  const columns: ColumnDef<ModInfo>[] = useMemo(
    () => [
      {
        accessorKey: "status",
        header: () => (
          <div className="text-center w-10">
            {t("modManagement.table.status", "状态")}
          </div>
        ),
        cell: ({ row }) => {
          const mod = row.original;
          return (
            <div className="flex justify-center">
              {mod.enabled ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        header: t("modManagement.table.name", "模块名称"),
        cell: ({ row }) => {
          const mod = row.original;
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`font-medium truncate ${
                    mod.enabled
                      ? "text-gray-900 dark:text-gray-100"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {mod.id || mod.displayName || mod.name}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mt-0.5">
                {mod.displayName}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "description",
        header: t("modManagement.table.description", "描述"),
        cell: ({ row }) => {
          const mod = row.original;
          return (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {mod.description || "-"}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">
            {t("modManagement.table.actions", "操作")}
          </div>
        ),
        cell: ({ row }) => {
          const mod = row.original;
          const isLoading = loadingMod === mod.id;
          return (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (mod.hasConfig) {
                    handleOpenSettings(mod);
                  }
                }}
                disabled={isLoading || loadingMod !== null || !mod.hasConfig}
                title={
                  mod.hasConfig
                    ? t("modManagement.actions.settings", "设置")
                    : t("modManagement.actions.noConfig", "此模块没有配置选项")
                }
              >
                <Settings className="w-4 h-4 mr-1" />
                {t("modManagement.actions.settings", "设置")}
              </Button>
              <Button
                variant={mod.enabled ? "outline" : "primary"}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMod(mod.id, mod.enabled);
                }}
                disabled={isLoading || loadingMod !== null}
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {mod.enabled
                      ? t("modManagement.actions.disable", "Disable")
                      : t("modManagement.actions.enable", "Enable")}
                  </>
                )}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, loadingMod, handleOpenSettings, handleToggleMod]
  );

  // Check admin permission
  if (isCheckingAdmin) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("modManagement.checkingPermissions")}
          </p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="mb-6">
            <Lock className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t("modManagement.accessDenied")}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t("modManagement.adminOnly")}
          </p>
          <Button variant="outline" onClick={() => window.history.back()}>
            {t("modManagement.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t("modManagement.simpleTitle", "Mod Management")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t("modManagement.simpleSubtitle", "Manage network mods")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate("/admin/mods/add")}
              variant="primary"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t("modManagement.addMod.button")}
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing
                ? t("modManagement.loadedMods.refreshing")
                : t("modManagement.loadedMods.refresh")}
            </Button>
          </div>
        </div>

        {/* Enabled Mods Section */}
        <DataTable
          columns={columns}
          data={modsList}
          loading={healthLoading || refreshing}
          searchable={true}
          searchPlaceholder={t(
            "modManagement.searchPlaceholder",
            "搜索模块..."
          )}
          searchColumn={["id", "name", "displayName", "description"]}
          pagination={true}
          pageSize={10}
          emptyMessage={t(
            "modManagement.enabledMods.empty",
            "No mods configured"
          )}
          emptyIcon={
            <Layers className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
          }
          title={t("modManagement.enabledMods.title", "Enabled Mods")}
          toolbar={
            <Badge variant="secondary" appearance="light" size="sm">
              {t("modManagement.enabledMods.total", "Total")}: {modsList.length}
            </Badge>
          }
        />
      </div>

      {/* Settings Dialog */}
      {selectedMod && (
        <ModSettingsDialog
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          modId={selectedMod.id}
          modName={
            selectedMod.name || selectedMod.displayName || selectedMod.id
          }
          onSave={handleSettingsSaved}
        />
      )}

      {/* Restart Dialog */}
      <RestartDialog
        open={restartDialogOpen}
        onOpenChange={setRestartDialogOpen}
        onRestartNow={handleRestartNow}
        onRestartLater={() => {}}
      />
    </ScrollArea>
  );
};

export default ModManagementPage;
