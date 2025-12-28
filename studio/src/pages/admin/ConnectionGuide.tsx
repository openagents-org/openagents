import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import { Button } from "@/components/layout/ui/button";
import { lookupNetworkPublication } from "@/services/networkService";
import { Globe, Server, Copy } from "lucide-react";

interface TransportInfo {
  type: string;
  enabled: boolean;
  port: number;
  host: string;
  url?: string;
}

interface ConnectionGuideData {
  transports: TransportInfo[];
  groups: string[];
  requiresPassword: boolean;
  defaultGroup: string;
  recommendedTransport?: string;
}

type IntegrationType = "python" | "yaml" | "langchain" | "mcp";
type ConnectionMode = "direct" | "network_id";

const ConnectionGuide: React.FC = () => {
  const { t } = useTranslation('admin');
  const { connector } = useOpenAgents();
  const { selectedNetwork } = useAuthStore();

  const [data, setData] = useState<ConnectionGuideData>({
    transports: [],
    groups: [],
    requiresPassword: false,
    defaultGroup: "default",
  });
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<IntegrationType>("python");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("direct");
  const [networkPublication, setNetworkPublication] = useState<{
    published: boolean;
    networkId?: string;
    loading: boolean;
  }>({ published: false, loading: true });
  const [networkUuid, setNetworkUuid] = useState<string | null>(null);

  // Load connection guide data
  const fetchGuideData = useCallback(async () => {
    if (!connector) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const healthData = await connector.getNetworkHealth();

      // Get transport information
      const transportsData = healthData?.data?.transports || [];
      const transportsList: TransportInfo[] = transportsData
        .filter((t: any) => t.enabled !== false)
        .map((t: any) => {
          const host = t.host || selectedNetwork?.host || "0.0.0.0";
          const port = t.port || t.config?.port || 8700;
          const protocol = t.tls?.enabled ? "https" : "http";
          let url = "";

          if (t.type === "http") {
            url = `${protocol}://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
          } else if (t.type === "grpc") {
            url = `${host === "0.0.0.0" ? "localhost" : host}:${port}`;
          } else if (t.type === "websocket") {
            const wsProtocol = t.tls?.enabled ? "wss" : "ws";
            url = `${wsProtocol}://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
          }

          return {
            type: t.type || "http",
            enabled: true,
            port,
            host,
            url,
          };
        });

      // If no transport information, add default HTTP transport
      if (transportsList.length === 0 && selectedNetwork) {
        transportsList.push({
          type: "http",
          enabled: true,
          port: selectedNetwork.port || 8700,
          host: selectedNetwork.host || "0.0.0.0",
          url: `http://${selectedNetwork.host === "0.0.0.0" ? "localhost" : selectedNetwork.host}:${selectedNetwork.port || 8700}`,
        });
      }

      // Get agent group information
      const groups = healthData?.data?.groups
        ? Object.keys(healthData.data.groups)
        : healthData?.groups
        ? Object.keys(healthData.groups)
        : [];

      // Get password requirement and default group
      const requiresPassword = healthData?.data?.requires_password || false;
      const defaultGroup = healthData?.data?.default_agent_group || "default";
      const recommendedTransport = healthData?.data?.recommended_transport || transportsList[0]?.type || "http";

      // Capture network_uuid for publishing status lookup
      const uuid = healthData?.data?.network_uuid || healthData?.network_uuid;
      if (uuid) {
        setNetworkUuid(uuid);
      }

      setData({
        transports: transportsList,
        groups,
        requiresPassword,
        defaultGroup,
        recommendedTransport,
      });
    } catch (error) {
      console.error("Failed to fetch connection guide data:", error);
      toast.error(t('connectionGuide.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [connector, selectedNetwork, t]);

  // Check network publication status
  useEffect(() => {
    const checkPublication = async () => {
      if (!networkUuid) {
        setNetworkPublication({ published: false, loading: false });
        return;
      }

      setNetworkPublication(prev => ({ ...prev, loading: true }));
      const result = await lookupNetworkPublication({ networkUuid });
      setNetworkPublication({
        published: result.published,
        networkId: result.networkId,
        loading: false,
      });

      // If published, default to network_id mode
      if (result.published) {
        setConnectionMode("network_id");
      }
    };

    checkPublication();
  }, [networkUuid]);

  useEffect(() => {
    fetchGuideData();
  }, [fetchGuideData]);

  // Get currently selected transport
  const currentTransport = data.transports[0];

  // Copy to clipboard with fallback for HTTP
  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      toast.success(successMessage);
    } catch (err) {
      toast.error(t('connectionGuide.copyFailed'));
    }
  };

  // Copy code to clipboard
  const handleCopyCode = (code: string) => {
    copyToClipboard(code, t('connectionGuide.copyCode'));
  };

  // Get connection parameters based on mode
  const getConnectionParams = () => {
    if (connectionMode === "network_id" && networkPublication.published && networkPublication.networkId) {
      return {
        useNetworkId: true,
        networkId: networkPublication.networkId,
        host: "",
        port: 0,
      };
    }
    const host = currentTransport?.host === "0.0.0.0" ? "localhost" : (currentTransport?.host || selectedNetwork?.host || "localhost");
    const port = currentTransport?.port || selectedNetwork?.port || 8700;
    return {
      useNetworkId: false,
      networkId: "",
      host,
      port,
    };
  };

  // Generate Python code example
  const generatePythonCode = (): string => {
    const params = getConnectionParams();

    const connectionCode = params.useNetworkId
      ? `            network_id="${params.networkId}",`
      : `            network_host="${params.host}",
            network_port=${params.port},`;

    return `import asyncio
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_context import EventContext

class MyAgent(WorkerAgent):
    """Custom agent that responds to messages."""

    default_agent_id = "my-agent"

    async def on_startup(self):
        print("Agent is running! Press Ctrl+C to stop.")

    async def react(self, context: EventContext):
        event = context.incoming_event
        content = event.payload.get("content") or event.payload.get("text") or ""
        if not content:
            return

        # Get the messaging adapter and respond
        messaging = self.client.mod_adapters.get("openagents.mods.workspace.messaging")
        if messaging:
            channel = event.payload.get("channel") or "general"
            await messaging.send_channel_message(
                channel=channel,
                text=f"Response: {content}"
            )

async def main():
    agent = MyAgent()
    try:
        await agent.async_start(
${connectionCode}
        )
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\\nShutting down...")
    finally:
        await agent.async_stop()

if __name__ == "__main__":
    asyncio.run(main())`;
  };

  // Generate YAML agent configuration
  const generateYAMLCode = (): string => {
    const params = getConnectionParams();

    const connectionSection = params.useNetworkId
      ? `connection:
  network_id: "${params.networkId}"`
      : `connection:
  host: "${params.host}"
  port: ${params.port}
  transport: "grpc"`;

    return `# my_agent.yaml - Agent configuration file
type: "openagents.agents.collaborator_agent.CollaboratorAgent"
agent_id: "my-agent"

config:
  model_name: "gpt-4o-mini"
  provider: "openai"  # openai, anthropic, azure, bedrock, etc.

  instruction: |
    You are a helpful AI assistant in an OpenAgents network.
    Respond to messages in a friendly and helpful manner.

  react_to_all_messages: true
  max_iterations: 10

mods:
  - name: "openagents.mods.workspace.messaging"
    enabled: true
  - name: "openagents.mods.discovery.agent_discovery"
    enabled: true

${connectionSection}

# Launch with: openagents agent start ./my_agent.yaml`;
  };

  // Generate LangChain integration code
  const generateLangChainCode = (): string => {
    const params = getConnectionParams();

    const connectionCode = params.useNetworkId
      ? `            network_id="${params.networkId}",`
      : `            network_host="${params.host}",
            network_port=${params.port},`;

    return `from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from openagents.agents import LangChainAgentRunner

# Define custom tools for your agent
@tool
def get_weather(location: str) -> str:
    """Get the current weather for a location."""
    return f"Weather in {location}: Sunny, 72°F"

@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression."""
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {str(e)}"

def create_langchain_agent():
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    tools = [get_weather, calculate]

    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant in the OpenAgents network."),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_tool_calling_agent(llm, tools, prompt)
    return AgentExecutor(agent=agent, tools=tools, verbose=True)

def main():
    langchain_agent = create_langchain_agent()

    # Wrap with OpenAgents runner
    runner = LangChainAgentRunner(
        langchain_agent=langchain_agent,
        agent_id="langchain-assistant",
        include_network_tools=True,  # Auto-inject OpenAgents tools
    )

    try:
        runner.start(
${connectionCode}
        )
        print("Agent is listening for messages...")
        runner.wait_for_stop()
    except KeyboardInterrupt:
        runner.stop()

if __name__ == "__main__":
    main()`;
  };

  // Generate MCP Client code (for Claude Desktop / MCP clients)
  const generateMCPCode = (): string => {
    const params = getConnectionParams();

    // Determine the MCP URL and network name
    let mcpUrl: string;
    let networkName: string;

    if (params.useNetworkId && params.networkId) {
      mcpUrl = `https://network.openagents.org/${params.networkId}/mcp`;
      networkName = params.networkId;
    } else {
      mcpUrl = `http://${params.host}:${params.port}/mcp`;
      // Create a safe network name from host (replace dots and colons)
      networkName = params.host.replace(/\./g, '_').replace(/:/g, '_');
    }

    const config = {
      mcpServers: {
        [networkName]: {
          command: "npx",
          args: [
            "-y",
            "@anthropic-ai/mcp-remote",
            mcpUrl
          ]
        }
      }
    };

    return JSON.stringify(config, null, 2);
  };

  // Get current code example
  const getCurrentCode = (): string => {
    switch (selectedTab) {
      case "python":
        return generatePythonCode();
      case "yaml":
        return generateYAMLCode();
      case "langchain":
        return generateLangChainCode();
      case "mcp":
        return generateMCPCode();
      default:
        return generatePythonCode();
    }
  };

  // Tab configuration
  const tabs: { id: IntegrationType; label: string; description: string }[] = [
    {
      id: "python",
      label: t('connectionGuide.tabs.python'),
      description: t('connectionGuide.subtitle'),
    },
    {
      id: "yaml",
      label: t('connectionGuide.tabs.yaml'),
      description: t('connectionGuide.yamlDescription'),
    },
    {
      id: "langchain",
      label: t('connectionGuide.tabs.langchain'),
      description: t('connectionGuide.langchainDescription'),
    },
    {
      id: "mcp",
      label: t('connectionGuide.tabs.mcp'),
      description: t('connectionGuide.mcpDescription'),
    },
  ];

  if (loading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t('connectionGuide.loadFailed')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab Navigation - Fixed at top */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                selectedTab === tab.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20"
                  : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area - Scrollable */}
      <div className="flex-1 overflow-y-auto p-6 dark:bg-gray-800">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('connectionGuide.title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {tabs.find(t => t.id === selectedTab)?.description}
          </p>
        </div>

        {/* Connection Mode Selector - Only show if network is published */}
        {networkPublication.published && networkPublication.networkId && (
          <div className="mb-6">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
              {t('connectionGuide.connectionMethod')}
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setConnectionMode("network_id")}
                className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  connectionMode === "network_id"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  connectionMode === "network_id"
                    ? "bg-blue-100 dark:bg-blue-900/50"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}>
                  <Globe className={`w-5 h-5 ${
                    connectionMode === "network_id"
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`} />
                </div>
                <div className="text-left">
                  <div className={`font-medium ${
                    connectionMode === "network_id"
                      ? "text-blue-900 dark:text-blue-100"
                      : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {t('connectionGuide.networkId')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      {networkPublication.networkId}
                    </code>
                  </div>
                </div>
                {connectionMode === "network_id" && (
                  <span className="ml-auto text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">
                    {t('connectionGuide.recommended')}
                  </span>
                )}
              </button>

              <button
                onClick={() => setConnectionMode("direct")}
                className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  connectionMode === "direct"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  connectionMode === "direct"
                    ? "bg-blue-100 dark:bg-blue-900/50"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}>
                  <Server className={`w-5 h-5 ${
                    connectionMode === "direct"
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`} />
                </div>
                <div className="text-left">
                  <div className={`font-medium ${
                    connectionMode === "direct"
                      ? "text-blue-900 dark:text-blue-100"
                      : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {t('connectionGuide.directConnection')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      {selectedNetwork?.host}:{selectedNetwork?.port}
                    </code>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Code Example */}
        <div className="bg-gray-900 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-sm text-gray-400">
              {selectedTab === "yaml" 
                ? t('connectionGuide.codeLanguage.yaml')
                : selectedTab === "mcp" 
                ? t('connectionGuide.codeLanguage.json')
                : t('connectionGuide.codeLanguage.python')}
            </span>
            <Button
              onClick={() => handleCopyCode(getCurrentCode())}
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white hover:bg-gray-700"
            >
              <Copy className="w-4 h-4 mr-2" />
              {t('connectionGuide.copy')}
            </Button>
          </div>
          <div className="p-4 overflow-x-auto">
            <pre className="text-sm text-gray-100 font-mono whitespace-pre">
              <code>{getCurrentCode()}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionGuide;
