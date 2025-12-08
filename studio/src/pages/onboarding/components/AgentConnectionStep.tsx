/**
 * Agent Connection step - Guide users to connect their first agent
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface AgentConnectionStepProps {
  httpPort: number;
  networkPath: string;
  onBack: () => void;
  onContinue: () => void;
}

interface Agent {
  agent_id: string;
  name: string;
  status: string;
}

const AgentConnectionStep: React.FC<AgentConnectionStepProps> = ({
  httpPort,
  networkPath,
  onBack,
  onContinue,
}) => {
  const [activeTab, setActiveTab] = useState<'template' | 'yaml' | 'python'>('template');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [checking, setChecking] = useState(false);

  const networkUrl = `http://localhost:${httpPort}`;

  useEffect(() => {
    // Poll for connected agents with a reasonable interval
    const POLLING_INTERVAL_MS = 5000; // 5 seconds
    
    const checkAgents = async () => {
      try {
        const response = await axios.get(`${networkUrl}/api/agents/connected`);
        if (response.data.success && response.data.data.agents) {
          setAgents(response.data.data.agents);
        }
      } catch (error) {
        console.error('Failed to check agents:', error);
      }
    };

    setChecking(true);
    checkAgents();
    const interval = setInterval(checkAgents, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [networkUrl]);

  const templateCommand = `openagents agent start ${networkPath}/agents/charlie.yaml`;
  
  const yamlExample = `# Save as my_agent.yaml
agent:
  id: "my_first_agent"
  name: "My First Agent"
  type: "echo"  # Simple echo agent

network:
  url: "${networkUrl}"`;
  
  const yamlCommand = `openagents agent start my_agent.yaml`;
  
  const pythonExample = `from openagents.agents import WorkerAgent

class MyAgent(WorkerAgent):
    default_agent_id = "my_first_agent"

    async def on_channel_post(self, context):
        await self.workspace().channel(context.channel).reply(
            context.incoming_event.id,
            "Hello! I received your message."
        )

if __name__ == "__main__":
    MyAgent().connect("${networkUrl}")`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Connect Your First Agent
        </h2>
        <p className="text-lg text-gray-600">
          Choose a connection method to get started
        </p>
      </div>

      {/* Connection Status */}
      {agents.length > 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <svg
              className="w-6 h-6 text-green-500 mr-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <h4 className="font-semibold text-green-800">
                🎉 Agent Connected!
              </h4>
              <p className="text-green-700 text-sm">
                {agents.map(a => a.name || a.agent_id).join(', ')} {agents.length > 1 ? 'are' : 'is'} now connected
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <svg
              className="w-5 h-5 text-blue-500 mr-2 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="text-blue-700 font-medium">
              Waiting for agent connection...
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
        <button
          onClick={() => setActiveTab('template')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'template'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Option A: Template
        </button>
        <button
          onClick={() => setActiveTab('yaml')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'yaml'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Option B: YAML
        </button>
        <button
          onClick={() => setActiveTab('python')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'python'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Option C: Python
        </button>
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {activeTab === 'template' && (
          <div>
            <h3 className="text-xl font-semibold mb-4">Use Pre-built Agent Template</h3>
            <p className="text-gray-600 mb-4">
              If you initialized your network with <code className="bg-gray-100 px-2 py-1 rounded text-sm">openagents init</code>,
              you can use the included template agent:
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm relative">
              <code>{templateCommand}</code>
              <button
                onClick={() => copyToClipboard(templateCommand)}
                className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {activeTab === 'yaml' && (
          <div>
            <h3 className="text-xl font-semibold mb-4">YAML-based Agent</h3>
            <p className="text-gray-600 mb-4">
              Create a simple YAML configuration file:
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm mb-4 relative">
              <pre className="overflow-x-auto">{yamlExample}</pre>
              <button
                onClick={() => copyToClipboard(yamlExample)}
                className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-gray-600 mb-2">Then start the agent:</p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm relative">
              <code>{yamlCommand}</code>
              <button
                onClick={() => copyToClipboard(yamlCommand)}
                className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {activeTab === 'python' && (
          <div>
            <h3 className="text-xl font-semibold mb-4">Python Agent</h3>
            <p className="text-gray-600 mb-4">
              Create a Python agent with full control:
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm relative">
              <pre className="overflow-x-auto">{pythonExample}</pre>
              <button
                onClick={() => copyToClipboard(pythonExample)}
                className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-gray-600 mt-4">
              Save as <code className="bg-gray-100 px-2 py-1 rounded text-sm">my_agent.py</code> and run with:{' '}
              <code className="bg-gray-100 px-2 py-1 rounded text-sm">python my_agent.py</code>
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="px-6 py-2 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

export default AgentConnectionStep;
