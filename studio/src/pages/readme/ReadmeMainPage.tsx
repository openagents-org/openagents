import React, { useState, useEffect } from "react";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";

/**
 * README Main Page - Displays README content fetched from /api/health
 */
const ReadmeMainPage: React.FC = () => {
  const { connector } = useOpenAgents();
  const [readmeContent, setReadmeContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReadme = async () => {
      if (!connector) {
        setError("Not connected to network");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const healthData = await connector.getNetworkHealth();

        // Get readme field from healthData
        // readme may be in network_profile.readme or directly in healthData.readme
        const readme =
          healthData?.network_profile?.readme || healthData?.readme || "";

        if (readme) {
          setReadmeContent(readme);
        } else {
          setReadmeContent("");
        }
      } catch (err) {
        console.error("Failed to fetch README:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch README");
        setReadmeContent("");
      } finally {
        setLoading(false);
      }
    };

    fetchReadme();
  }, [connector]);

  // Loading state
  if (loading) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading README...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center justify-center">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 text-center">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Failed to load README
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty content state
  if (!readmeContent) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 text-gray-400 dark:text-gray-600">
            📄
          </div>
          <h3 className="text-lg font-medium mb-2 text-gray-800 dark:text-gray-200">
            No README Available
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-md mx-auto">
            This network has not provided a README.
          </p>
        </div>
      </div>
    );
  }

  // Display README content
  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          README
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Network documentation and instructions
        </p>
      </div>

      {/* Markdown Content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <MarkdownRenderer
          content={readmeContent}
          className="prose prose-gray dark:prose-invert max-w-none"
        />
      </div>
    </div>
  );
};

export default ReadmeMainPage;
