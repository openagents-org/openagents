import React, { useState, useEffect, useMemo, useContext, useCallback } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getEvents,
  getMods,
  searchEvents,
  syncEvents,
  setNetworkConnection,
  EventDefinition,
  ModInfo
} from "@/services/eventExplorerService";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { Button } from "@/components/layout/ui/button";
import { Input } from "@/components/layout/ui/input";
import { Card, CardContent } from "@/components/layout/ui/card";
import { Badge } from "@/components/layout/ui/badge";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/layout/ui/select";
import { Search, RefreshCw, Package, Zap, ChevronRight, AlertCircle } from "lucide-react";
import EventDetailPage from "./EventDetailPage";

/**
 * Events Main Page - Event Explorer
 */
const EventsMainPage: React.FC = () => {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;

  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMod, setSelectedMod] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");

  // Set network connection from context
  useEffect(() => {
    if (openAgentsService && 'host' in openAgentsService && 'port' in openAgentsService) {
      const host = (openAgentsService as any).host || 'localhost';
      const port = (openAgentsService as any).port || 8700;
      setNetworkConnection(host, port);
    } else {
      // Try to get from localStorage or use default
      try {
        const networkConfig = localStorage.getItem('openagents_network_config');
        if (networkConfig) {
          const config = JSON.parse(networkConfig);
          if (config.host && config.port) {
            setNetworkConnection(config.host, config.port);
          }
        }
      } catch (e) {
        // Use default
        setNetworkConnection('localhost', 8700);
      }
    }
  }, [openAgentsService]);

  const loadMods = useCallback(async () => {
    try {
      const result = await getMods();
      if (result.success && result.data) {
        setMods(result.data.mods || []);
      } else {
        setError(result.error_message || t('messages.loadModsError', "Failed to load mods"));
      }
    } catch (err: any) {
      setError(err.message || t('messages.loadModsError', "Failed to load mods"));
    }
  }, [t]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let result;

      if (searchQuery.trim()) {
        result = await searchEvents(searchQuery);
      } else {
        result = await getEvents(
          selectedMod === "all" ? undefined : selectedMod,
          selectedType === "all" ? undefined : selectedType
        );
      }

      if (result.success && result.data) {
        setEvents(result.data.events || []);
      } else {
        setError(result.error_message || t('messages.loadEventsError', "Failed to load events"));
      }
    } catch (err: any) {
      setError(err.message || t('messages.loadEventsError', "Failed to load events"));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedMod, selectedType, t]);

  // Load mods on mount
  useEffect(() => {
    loadMods();
  }, [loadMods]);

  // Load events when filters change
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const result = await syncEvents();
      if (result.success) {
        // Reload events and mods after sync
        await Promise.all([loadMods(), loadEvents()]);
      } else {
        setError(result.error_message || t('messages.syncError', "Failed to sync events"));
      }
    } catch (err: any) {
      setError(err.message || t('messages.syncError', "Failed to sync events"));
    } finally {
      setSyncing(false);
    }
  };

  // Group events by mod
  const eventsByMod = useMemo(() => {
    const grouped: Record<string, EventDefinition[]> = {};

    events.forEach(event => {
      const modId = event.mod_id;
      if (!grouped[modId]) {
        grouped[modId] = [];
      }
      grouped[modId].push(event);
    });

    return grouped;
  }, [events]);

  // Get mod name for a mod_id
  const getModName = (modId: string) => {
    const mod = mods.find(m => m.mod_id === modId);
    return mod?.mod_name || modId;
  };

  const handleEventClick = (eventName: string) => {
    // Use relative navigation to work in both /profile/events and /admin/event-explorer
    navigate(encodeURIComponent(eventName));
  };

  const getEventTypeBadge = (eventType: string) => {
    switch (eventType) {
      case 'operation':
        return <Badge variant="info" appearance="light" size="sm">Operation</Badge>;
      case 'response':
        return <Badge variant="success" appearance="light" size="sm">Response</Badge>;
      case 'notification':
        return <Badge variant="secondary" appearance="light" size="sm">Notification</Badge>;
      default:
        return <Badge variant="secondary" appearance="light" size="sm">{eventType}</Badge>;
    }
  };

  return (
    <div className="h-full">
      <Routes>
        <Route
          index
          element={
            <ScrollArea className="h-full">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                      {t('title')}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('subtitle')}
                    </p>
                  </div>

                  <Button
                    onClick={handleSync}
                    disabled={syncing}
                    variant="primary"
                    size="sm"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400"
                  >
                    <RefreshCw className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? t('actions.syncing') : t('actions.sync')}
                  </Button>
                </div>

                {/* Search and Filters */}
                <Card className="mb-6 border-gray-200 dark:border-gray-700">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      {/* Search Input */}
                      <div className="flex-1 relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          type="text"
                          placeholder={t('actions.search')}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          variant="lg"
                          className="pl-10 w-full"
                        />
                      </div>

                      {/* Filters */}
                      <div className="flex gap-3">
                        <Select value={selectedMod} onValueChange={setSelectedMod}>
                          <SelectTrigger size="lg" className="w-[180px]">
                            <Package className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                            <SelectValue placeholder={t('filters.allMods')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('filters.allMods')}</SelectItem>
                            {mods.map(mod => (
                              <SelectItem key={mod.mod_id} value={mod.mod_id}>
                                {mod.mod_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select value={selectedType} onValueChange={setSelectedType}>
                          <SelectTrigger size="lg" className="w-[160px]">
                            <Zap className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                            <SelectValue placeholder={t('filters.allTypes')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('filters.allTypes')}</SelectItem>
                            <SelectItem value="operation">{t('filters.operation')}</SelectItem>
                            <SelectItem value="response">{t('filters.response')}</SelectItem>
                            <SelectItem value="notification">{t('filters.notification')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Error Message */}
                {error && (
                  <Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                    <CardContent className="p-3 flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Content */}
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('messages.loadingEvents')}
                      </p>
                    </div>
                  </div>
                ) : Object.keys(eventsByMod).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="p-4 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                      <Package className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                      {t('messages.noEvents')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(eventsByMod).map(([modId, modEvents]) => (
                      <Card key={modId} className="border-gray-200 dark:border-gray-700 overflow-hidden">
                        <CardContent className="p-0">
                          {/* Module Header */}
                          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                            <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                              <Package className="w-4 h-4" />
                            </div>
                            <h2 className="font-medium text-gray-900 dark:text-gray-100">
                              {getModName(modId)}
                            </h2>
                            <Badge variant="secondary" appearance="light" size="sm">
                              {modEvents.length}
                            </Badge>
                          </div>

                          {/* Events List */}
                          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                            {modEvents.map((event) => (
                              <div
                                key={event.event_name}
                                onClick={() => handleEventClick(event.event_name)}
                                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors group"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-mono text-blue-600 dark:text-blue-400 truncate">
                                      {event.event_name}
                                    </span>
                                    {getEventTypeBadge(event.event_type)}
                                  </div>
                                  {event.description && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {event.description}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 flex-shrink-0 ml-3" />
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          }
        />

        <Route
          path=":eventName"
          element={<EventDetailPage />}
        />
      </Routes>
    </div>
  );
};

export default EventsMainPage;
