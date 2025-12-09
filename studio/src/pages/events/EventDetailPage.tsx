import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getEventDetail, EventDefinition } from "@/services/eventExplorerService";

/**
 * Event Detail Page - Shows detailed information about a specific event
 */
const EventDetailPage: React.FC = () => {
  const { eventName } = useParams<{ eventName: string }>();
  const navigate = useNavigate();
  
  const [event, setEvent] = useState<EventDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'python' | 'javascript'>('python');
  
  const loadEventDetail = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await getEventDetail(name);
      if (result.success && result.data) {
        setEvent(result.data);
      } else {
        setError(result.error_message || "Failed to load event detail");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load event detail");
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if (eventName) {
      loadEventDetail(decodeURIComponent(eventName));
    }
  }, [eventName, loadEventDetail]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading event details...</div>
      </div>
    );
  }
  
  if (error || !event) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-red-600 dark:text-red-400 mb-4">
          {error || "Event not found"}
        </div>
        <button
          onClick={() => navigate("/profile/events")}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Back to Events
        </button>
      </div>
    );
  }
  
  const eventTypeColor = {
    operation: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    response: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    notification: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  }[event.event_type];
  
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
        <button
          onClick={() => navigate("/profile/events")}
          className="mb-4 text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Back to Events
        </button>
        
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-mono">
            {event.event_name}
          </h1>
          <span className={`px-3 py-1 text-sm rounded ${eventTypeColor}`}>
            {event.event_type} ●
          </span>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          {event.description}
        </p>
        
        <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
          <div>
            <span className="font-semibold">Mod:</span> {event.mod_name}
          </div>
          <div>
            <span className="font-semibold">Type:</span> {event.event_type}
            {event.event_type === 'operation' && ' (request-response)'}
          </div>
          {event.related_events && event.related_events.length > 0 && (
            <div>
              <span className="font-semibold">Related:</span> {event.related_events.join(', ')}
            </div>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Request Payload */}
          {event.request_schema && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Request Payload
              </h2>
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3">
                <pre className="text-sm text-gray-800 dark:text-gray-200 overflow-x-auto">
                  <code>{JSON.stringify(event.request_schema, null, 2)}</code>
                </pre>
              </div>
            </div>
          )}
          
          {/* Response Payload (only for operation events) */}
          {event.event_type === 'operation' && event.response_schema && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Response Payload
              </h2>
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3">
                <pre className="text-sm text-gray-800 dark:text-gray-200 overflow-x-auto">
                  <code>{JSON.stringify(event.response_schema, null, 2)}</code>
                </pre>
              </div>
            </div>
          )}
          
          {/* Examples */}
          {event.examples && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Examples
              </h2>
              
              {/* Tab Selector */}
              <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
                {event.examples.python && (
                  <button
                    onClick={() => setActiveTab('python')}
                    className={`px-4 py-2 text-sm font-medium ${
                      activeTab === 'python'
                        ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    Python
                  </button>
                )}
                {event.examples.javascript && (
                  <button
                    onClick={() => setActiveTab('javascript')}
                    className={`px-4 py-2 text-sm font-medium ${
                      activeTab === 'javascript'
                        ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    JavaScript
                  </button>
                )}
              </div>
              
              {/* Code Example */}
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3">
                <pre className="text-sm text-gray-800 dark:text-gray-200 overflow-x-auto">
                  <code>
                    {activeTab === 'python' && event.examples.python
                      ? event.examples.python
                      : activeTab === 'javascript' && event.examples.javascript
                      ? event.examples.javascript
                      : 'No example available'}
                  </code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventDetailPage;

