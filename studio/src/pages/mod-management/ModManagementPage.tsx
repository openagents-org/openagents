import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProfileData } from '@/pages/profile/hooks/useProfileData';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/layout/ui/button';
import { Badge } from '@/components/layout/ui/badge';
import { Card, CardContent } from '@/components/layout/ui/card';
import { ScrollArea } from '@/components/layout/ui/scroll-area';
import { Lock, RefreshCw, Layers, CheckCircle, XCircle, Plus, Zap, Trash2, Power, Loader2 } from 'lucide-react';

interface StaticModInfo {
  name: string;
  enabled: boolean;
  config?: Record<string, any>;
}

interface DynamicModInfo {
  mod_id: string;
  mod_path: string;
  loaded_at: string;
}

const ModManagementPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { healthData, refresh } = useProfileData();
  const { isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();
  const { connector } = useOpenAgents();
  const { agentName } = useAuthStore();

  const [refreshing, setRefreshing] = useState(false);
  const [staticMods, setStaticMods] = useState<StaticModInfo[]>([]);
  const [dynamicMods, setDynamicMods] = useState<DynamicModInfo[]>([]);
  const [loadingMod, setLoadingMod] = useState<string | null>(null);

  // Extract mods information from healthData
  useEffect(() => {
    // Extract static mods from config
    if (healthData?.data?.mods) {
      setStaticMods(healthData.data.mods as StaticModInfo[]);
    } else {
      setStaticMods([]);
    }
    // Extract dynamic mods (loaded at runtime)
    // dynamic_mods is an object with {loaded: [], count: number, details: {}}
    if (healthData?.data?.dynamic_mods?.loaded && Array.isArray(healthData.data.dynamic_mods.loaded)) {
      // Map the loaded array to DynamicModInfo format
      const details = healthData.data.dynamic_mods.details || {};
      const dynamicModsList: DynamicModInfo[] = healthData.data.dynamic_mods.loaded.map((modId: string) => ({
        mod_id: modId,
        mod_path: details[modId]?.mod_path || modId,
        loaded_at: details[modId]?.loaded_at || '',
      }));
      setDynamicMods(dynamicModsList);
    } else {
      setDynamicMods([]);
    }
  }, [healthData]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Handle unload dynamic mod
  const handleUnloadMod = useCallback(async (modId: string, modPath: string) => {
    if (!connector) {
      toast.error(t('modManagement.loadMod.notConnected'));
      return;
    }

    setLoadingMod(modId);
    try {
      const response = await connector.sendEvent({
        event_name: 'system.mod.unload',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: modPath,
        },
      });

      if (response.success) {
        toast.success(t('modManagement.loadedMods.unloadSuccess', { modId: modPath.split('.').pop() }));
        setTimeout(() => {
          refresh();
        }, 500);
      } else {
        toast.error(t('modManagement.loadedMods.unloadFailed', { error: response.message || 'Unknown error' }));
      }
    } catch (error: any) {
      console.error('Failed to unload Mod:', error);
      toast.error(t('modManagement.loadedMods.unloadFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoadingMod(null);
    }
  }, [connector, agentName, refresh, t]);

  // Handle toggle static mod (enable/disable)
  const handleToggleMod = useCallback(async (modName: string, currentEnabled: boolean) => {
    if (!connector) {
      toast.error(t('modManagement.loadMod.notConnected'));
      return;
    }

    setLoadingMod(modName);
    try {
      const response = await connector.sendEvent({
        event_name: currentEnabled ? 'system.mod.disable' : 'system.mod.enable',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: modName,
        },
      });

      if (response.success) {
        toast.success(currentEnabled
          ? t('modManagement.actions.disableSuccess', { modName: modName.split('.').pop() })
          : t('modManagement.actions.enableSuccess', { modName: modName.split('.').pop() })
        );
        setTimeout(() => {
          refresh();
        }, 500);
      } else {
        toast.error(t('modManagement.actions.toggleFailed', { error: response.message || 'Unknown error' }));
      }
    } catch (error: any) {
      console.error('Failed to toggle Mod:', error);
      toast.error(t('modManagement.actions.toggleFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoadingMod(null);
    }
  }, [connector, agentName, refresh, t]);

  // Check admin permission
  if (isCheckingAdmin) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('modManagement.checkingPermissions')}
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
            {t('modManagement.accessDenied')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('modManagement.adminOnly')}
          </p>
          <Button
            variant="outline"
            onClick={() => window.history.back()}
          >
            {t('modManagement.goBack')}
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
              {t('modManagement.simpleTitle', 'Mod Management')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('modManagement.simpleSubtitle', 'Manage network mods')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate('/admin/mods/add')}
              variant="primary"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t('modManagement.addMod.button')}
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? t('modManagement.loadedMods.refreshing') : t('modManagement.loadedMods.refresh')}
            </Button>
          </div>
        </div>

        {/* Enabled Mods Section */}
        <Card className="border-gray-200 dark:border-gray-700">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <Layers className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('modManagement.enabledMods.title', 'Enabled Mods')}
                </h2>
              </div>
              <Badge variant="secondary" appearance="light" size="sm">
                {t('modManagement.enabledMods.total', 'Total')}: {staticMods.filter(m => m.enabled).length + dynamicMods.length}
              </Badge>
            </div>

            {(staticMods.length > 0 || dynamicMods.length > 0) ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {/* Static Mods */}
                {staticMods.map((mod, index) => {
                  const isLoading = loadingMod === mod.name;
                  return (
                    <div
                      key={mod.name || index}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {mod.enabled ? (
                          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium truncate ${
                              mod.enabled
                                ? 'text-gray-900 dark:text-gray-100'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}>
                              {mod.name.split('.').pop() || mod.name}
                            </span>
                            <Badge variant="secondary" appearance="light" size="sm" className="flex-shrink-0">
                              {t('modManagement.modTypes.static', 'Static')}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mt-0.5">
                            {mod.name}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant={mod.enabled ? "outline" : "primary"}
                        size="sm"
                        onClick={() => handleToggleMod(mod.name, mod.enabled)}
                        disabled={isLoading || loadingMod !== null}
                        className="flex-shrink-0 ml-4"
                      >
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Power className="w-3.5 h-3.5 mr-1" />
                            {mod.enabled
                              ? t('modManagement.actions.disable', 'Disable')
                              : t('modManagement.actions.enable', 'Enable')
                            }
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
                {/* Dynamic Mods */}
                {dynamicMods.map((mod) => {
                  const isLoading = loadingMod === mod.mod_id;
                  return (
                    <div
                      key={mod.mod_id}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate text-gray-900 dark:text-gray-100">
                              {mod.mod_path.split('.').pop() || mod.mod_path}
                            </span>
                            <Badge variant="info" appearance="light" size="sm" className="flex-shrink-0">
                              {t('modManagement.enabledMods.dynamic', 'Dynamic')}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mt-0.5">
                            {mod.mod_path}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleUnloadMod(mod.mod_id, mod.mod_path)}
                        disabled={isLoading || loadingMod !== null}
                        className="flex-shrink-0 ml-4"
                      >
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            {t('modManagement.actions.remove', 'Remove')}
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Layers className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {t('modManagement.enabledMods.empty', 'No mods configured')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/admin/mods/add')}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {t('modManagement.addMod.button')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
};

export default ModManagementPage;
