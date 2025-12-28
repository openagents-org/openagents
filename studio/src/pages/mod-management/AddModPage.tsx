import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProfileData } from '@/pages/profile/hooks/useProfileData';
import { useAuthStore } from '@/stores/authStore';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { Button } from '@/components/layout/ui/button';
import { Badge } from '@/components/layout/ui/badge';
import { Card, CardContent } from '@/components/layout/ui/card';
import { ScrollArea } from '@/components/layout/ui/scroll-area';
import {
  Lock,
  ArrowLeft,
  Plus,
  Loader2,
  MessageSquare,
  Users,
  FileText,
  Folder,
  Globe,
  Gamepad2,
  Search,
  CheckCircle
} from 'lucide-react';

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

// Available mods in OpenAgents
interface AvailableMod {
  id: string;
  name: string;
  path: string;
  description: string;
  category: string;
  icon: React.ReactNode;
}

const AVAILABLE_MODS: AvailableMod[] = [
  // Communication
  {
    id: 'simple_messaging',
    name: 'Simple Messaging',
    path: 'openagents.mods.communication.simple_messaging',
    description: 'Direct and broadcast messaging with text and file attachments',
    category: 'Communication',
    icon: <MessageSquare className="w-5 h-5" />,
  },
  // Discovery
  {
    id: 'agent_discovery',
    name: 'Agent Discovery',
    path: 'openagents.mods.discovery.agent_discovery',
    description: 'Agent capability announcement and discovery',
    category: 'Discovery',
    icon: <Search className="w-5 h-5" />,
  },
  // Coordination
  {
    id: 'task_delegation',
    name: 'Task Delegation',
    path: 'openagents.mods.coordination.task_delegation',
    description: 'Structured task delegation with status tracking and timeout support',
    category: 'Coordination',
    icon: <Users className="w-5 h-5" />,
  },
  // Core
  {
    id: 'shared_cache',
    name: 'Shared Cache',
    path: 'openagents.mods.core.shared_cache',
    description: 'Shared caching system with agent group-based access control',
    category: 'Core',
    icon: <Folder className="w-5 h-5" />,
  },
  // Workspace
  {
    id: 'workspace_messaging',
    name: 'Thread Messaging',
    path: 'openagents.mods.workspace.messaging',
    description: 'Discord/Slack-like messaging with threading and reactions',
    category: 'Workspace',
    icon: <MessageSquare className="w-5 h-5" />,
  },
  {
    id: 'workspace_forum',
    name: 'Forum',
    path: 'openagents.mods.workspace.forum',
    description: 'Reddit-like forum with topics, nested comments, and voting',
    category: 'Workspace',
    icon: <MessageSquare className="w-5 h-5" />,
  },
  {
    id: 'workspace_wiki',
    name: 'Wiki',
    path: 'openagents.mods.workspace.wiki',
    description: 'Collaborative wiki with ownership-based editing and proposals',
    category: 'Workspace',
    icon: <Globe className="w-5 h-5" />,
  },
  {
    id: 'workspace_documents',
    name: 'Shared Documents',
    path: 'openagents.mods.workspace.documents',
    description: 'Real-time collaborative document editing',
    category: 'Workspace',
    icon: <FileText className="w-5 h-5" />,
  },
  {
    id: 'workspace_feed',
    name: 'Feed',
    path: 'openagents.mods.workspace.feed',
    description: 'One-way information broadcasting with immutable posts',
    category: 'Workspace',
    icon: <FileText className="w-5 h-5" />,
  },
  {
    id: 'workspace_project',
    name: 'Project Management',
    path: 'openagents.mods.workspace.project',
    description: 'Project management with templates and state management',
    category: 'Workspace',
    icon: <Folder className="w-5 h-5" />,
  },
  {
    id: 'shared_artifact',
    name: 'Shared Artifacts',
    path: 'openagents.mods.workspace.shared_artifact',
    description: 'Persistent file storage with access control',
    category: 'Workspace',
    icon: <Folder className="w-5 h-5" />,
  },
  // Games
  {
    id: 'agentworld',
    name: 'Agent World',
    path: 'openagents.mods.games.agentworld',
    description: '2D MMORPG game environment for AI agents',
    category: 'Games',
    icon: <Gamepad2 className="w-5 h-5" />,
  },
];

const AddModPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { agentName } = useAuthStore();
  const { connector } = useOpenAgents();
  const { healthData, refresh } = useProfileData();
  const { isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();

  const [staticMods, setStaticMods] = useState<StaticModInfo[]>([]);
  const [dynamicMods, setDynamicMods] = useState<DynamicModInfo[]>([]);
  const [loadingMod, setLoadingMod] = useState<string | null>(null);

  // Extract mods information from healthData
  useEffect(() => {
    if (healthData?.data?.mods) {
      setStaticMods(healthData.data.mods as StaticModInfo[]);
    } else {
      setStaticMods([]);
    }
    // Extract dynamic mods (loaded at runtime)
    // dynamic_mods is an object with {loaded: [], count: number, details: {}}
    if (healthData?.data?.dynamic_mods?.loaded && Array.isArray(healthData.data.dynamic_mods.loaded)) {
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

  // Check if a mod is already enabled (either static or dynamic)
  const isModEnabled = useCallback((modPath: string) => {
    // Check in static mods
    const isStatic = staticMods.some(m => m.name === modPath && m.enabled);
    // Check in dynamic mods
    const isDynamic = dynamicMods.some(m => m.mod_path === modPath);
    return isStatic || isDynamic;
  }, [staticMods, dynamicMods]);

  // Handle loading a mod dynamically
  const handleLoadMod = useCallback(async (mod: AvailableMod) => {
    if (!connector) {
      toast.error(t('modManagement.loadMod.notConnected'));
      return;
    }

    setLoadingMod(mod.id);
    try {
      const response = await connector.sendEvent({
        event_name: 'system.mod.load',
        source_id: agentName || 'system',
        destination_id: 'system:system',
        payload: {
          mod_path: mod.path,
          config: {},
        },
      });

      if (response.success) {
        toast.success(t('modManagement.loadMod.loadSuccess', { modId: mod.name }));
        // Refresh data
        setTimeout(() => {
          refresh();
        }, 500);
      } else {
        toast.error(t('modManagement.loadMod.loadFailed', { error: response.message || 'Unknown error' }));
      }
    } catch (error: any) {
      console.error('Failed to load Mod:', error);
      toast.error(t('modManagement.loadMod.loadFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoadingMod(null);
    }
  }, [connector, agentName, refresh, t]);

  // Group available mods by category
  const modsByCategory = AVAILABLE_MODS.reduce((acc, mod) => {
    if (!acc[mod.category]) {
      acc[mod.category] = [];
    }
    acc[mod.category].push(mod);
    return acc;
  }, {} as Record<string, AvailableMod[]>);

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
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/mods')}
            className="p-2"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('modManagement.addMod.pageTitle')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('modManagement.addMod.pageDescription')}
            </p>
          </div>
        </div>

        {/* Mods by Category */}
        <div className="space-y-8">
          {Object.entries(modsByCategory).map(([category, mods]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mods.map((mod) => {
                  const enabled = isModEnabled(mod.path);
                  const isLoading = loadingMod === mod.id;
                  return (
                    <Card
                      key={mod.id}
                      className={`border transition-colors ${
                        enabled
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                      }`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2.5 rounded-lg flex-shrink-0 ${
                            enabled
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}>
                            {mod.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {mod.name}
                              </span>
                              {enabled && (
                                <Badge variant="success" appearance="light" size="sm">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {t('modManagement.addMod.enabled')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                              {mod.description}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mb-3">
                              {mod.path}
                            </p>
                            {!enabled && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleLoadMod(mod)}
                                disabled={isLoading || loadingMod !== null}
                                className="w-full"
                              >
                                {isLoading ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    {t('modManagement.addMod.loading')}
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-4 h-4 mr-2" />
                                    {t('modManagement.addMod.add')}
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
};

export default AddModPage;
