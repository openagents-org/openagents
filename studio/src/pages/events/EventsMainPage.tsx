import React, { useState, useEffect, useMemo, useContext, useCallback } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
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
import EventDetailPage from "./EventDetailPage";

/**
 * Events Main Page - Event Explorer
 */
const EventsMainPage: React.FC = () => {
  const navigate = useNavigate();
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMod, setSelectedMod] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("");
  
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
        setError(result.error_message || "Failed to load mods");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load mods");
    }
  }, []);
  
  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      let result;
      
      if (searchQuery.trim()) {
        result = await searchEvents(searchQuery);
      } else {
        result = await getEvents(
          selectedMod || undefined,
          selectedType || undefined
        );
      }
      
      if (result.success && result.data) {
        setEvents(result.data.events || []);
      } else {
        setError(result.error_message || "Failed to load events");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedMod, selectedType]);
  
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
        setError(result.error_message || "Failed to sync events");
      }
    } catch (err: any) {
      setError(err.message || "Failed to sync events");
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
    navigate(`/profile/events/${encodeURIComponent(eventName)}`);
  };
  
  return (
    <Routes>
      <Route
        index
        element={
          <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Event Explorer
                </h1>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncing ? "Syncing..." : "Sync from GitHub"}
                </button>
              </div>
              
              {/* Search Bar */}
              <div className="mb-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
                </div>
              </div>
              
              {/* Filters */}
              <div className="flex gap-4">
                <select
                  value={selectedMod}
                  onChange={(e) => setSelectedMod(e.target.value)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Mods</option>
                  {mods.map(mod => (
                    <option key={mod.mod_id} value={mod.mod_id}>
                      {mod.mod_name} ({mod.event_count})
                    </option>
                  ))}
                </select>
                
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Types</option>
                  <option value="operation">Operation</option>
                  <option value="response">Response</option>
                  <option value="notification">Notification</option>
                </select>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {error && (
                <div className="mb-4 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-lg">
                  {error}
                </div>
              )}
              
              {loading ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Loading events...
                </div>
              ) : Object.keys(eventsByMod).length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No events found. Try syncing from GitHub.
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(eventsByMod).map(([modId, modEvents]) => (
                    <div
                      key={modId}
                      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                    >
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        {getModName(modId)} ({modEvents.length} events)
                      </h2>
                      
                      <div className="space-y-3">
                        {modEvents.map((event) => (
                          <div
                            key={event.event_name}
                            onClick={() => handleEventClick(event.event_name)}
                            className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-mono text-blue-600 dark:text-blue-400">
                                    {event.event_name}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 text-xs rounded ${
                                      event.event_type === 'operation'
                                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                        : event.event_type === 'response'
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                        : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                    }`}
                                  >
                                    {event.event_type}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                  {event.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
      />
      
      <Route
        path=":eventName"
        element={<EventDetailPage />}
      />
    </Routes>
  );
};

export default EventsMainPage;

