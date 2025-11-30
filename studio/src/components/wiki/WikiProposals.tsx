import React, { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useWikiStore } from "@/stores/wikiStore";
import DiffViewer from "@/components/common/DiffViewer";
import { formatDateTime } from "@/utils/utils";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const WikiProposals: React.FC = () => {
  const navigate = useNavigate();
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [pageContents, setPageContents] = useState<{ [key: string]: string }>(
    {}
  );

  const {
    proposals,
    pages,
    pagesError,
    setConnection,
    loadProposals,
    loadPages,
    loadPage,
    resolveProposal,
    clearError,
  } = useWikiStore();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load proposals
  useEffect(() => {
    if (openAgentsService) {
      console.log("WikiProposals: Loading proposals");
      loadProposals();
      loadPages(); // Ensure we have page data
    }
  }, [openAgentsService, loadProposals, loadPages]);

  // Get page content for diff comparison
  const getPageContent = async (pagePath: string): Promise<string> => {
    if (pageContents[pagePath]) {
      return pageContents[pagePath];
    }

    // First check if the page already exists in pages
    const existingPage = pages.find((page) => page.page_path === pagePath);
    if (existingPage) {
      const content = existingPage.wiki_content || "";
      setPageContents((prev) => ({ ...prev, [pagePath]: content }));
      return content;
    }

    // If not, try to load page details
    try {
      await loadPage(pagePath);
      // Here we need to get the latest loaded page from the store
      const updatedPages = pages;
      const loadedPage = updatedPages.find(
        (page) => page.page_path === pagePath
      );
      const content = loadedPage?.wiki_content || "";
      setPageContents((prev) => ({ ...prev, [pagePath]: content }));
      return content;
    } catch (error) {
      console.error("Failed to load page content for diff:", error);
      return "";
    }
  };

  const handleToggleProposal = async (proposalId: string, pagePath: string) => {
    if (expandedProposal === proposalId) {
      setExpandedProposal(null);
    } else {
      setExpandedProposal(proposalId);
      await getPageContent(pagePath);
    }
  };

  const handleBack = () => {
    navigate("/wiki");
  };

  const handleResolveProposal = async (
    proposalId: string,
    action: "approve" | "reject"
  ) => {
    await resolveProposal(proposalId, action);
  };

  const pendingProposals = proposals.filter((p) => p.status === "pending");

  return (
    <div className="flex-1 flex flex-col h-full dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <button
            onClick={handleBack}
            className="py-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Edit Proposals
            </h1>
            <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
              {pendingProposals.length} pending proposals
            </p>
          </div>
        </div>
      </div>

      {/* Error message */}
      {pagesError && (
        <div className="mx-6 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-300 text-sm">{pagesError}</p>
          <button
            onClick={clearError}
            className="mt-2 text-xs text-red-600 dark:text-red-400 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Proposals list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 dark:bg-gray-900">
        {pendingProposals.length === 0 ? (
          <div className="text-center py-12 h-full flex flex-col items-center justify-center">
            <div className="mb-4 text-gray-500 dark:text-gray-400">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              No pending proposals
            </h3>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              All proposals have been reviewed
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingProposals.map((proposal) => {
              const isExpanded = expandedProposal === proposal.proposal_id;
              const currentContent = pageContents[proposal.page_path] || "";

              return (
                <div
                  key={proposal.proposal_id}
                  className="p-4 rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                          {proposal.page_path}
                        </h3>
                        <button
                          onClick={() =>
                            handleToggleProposal(
                              proposal.proposal_id,
                              proposal.page_path
                            )
                          }
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                        >
                          <svg
                            className={`w-4 h-4 transform transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        by {proposal.proposed_by} •{" "}
                        {formatDateTime(proposal.created_timestamp / 1000)}
                      </p>
                    </div>
                    <div className="flex space-x-2 ml-4">
                      <button
                        onClick={() =>
                          handleResolveProposal(proposal.proposal_id, "approve")
                        }
                        className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          handleResolveProposal(proposal.proposal_id, "reject")
                        }
                        className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Rationale:
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded">
                      {proposal.rationale}
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4">
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Changes:
                      </div>
                      <DiffViewer
                        oldValue={currentContent}
                        newValue={proposal.proposed_content || ""}
                        oldTitle="Current Version"
                        newTitle="Proposed Version"
                        viewType="unified"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Proposed content preview:
                      </div>
                      <div className="text-xs p-2 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                        <div className="whitespace-pre-wrap">
                          {proposal.proposed_content
                            ? proposal.proposed_content.substring(0, 300)
                            : "No content"}
                          {proposal.proposed_content &&
                            proposal.proposed_content.length > 300 &&
                            "..."}
                        </div>
                      </div>
                      <div className="mt-2">
                        <button
                          onClick={() =>
                            handleToggleProposal(
                              proposal.proposal_id,
                              proposal.page_path
                            )
                          }
                          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                        >
                          View detailed changes →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WikiProposals;
