import React, { useState, useEffect, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useWikiStore } from "@/stores/wikiStore";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import WikiEditor from "./components/WikiEditor";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const WikiPageDetail: React.FC = () => {
  const { t } = useTranslation('wiki');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [proposalRationale, setProposalRationale] = useState("");
  const navigate = useNavigate();
  const { pagePath } = useParams<{ pagePath: string }>();
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;

  const {
    selectedPage,
    pagesError,
    setConnection,
    loadPage,
    editPage,
    proposeEdit,
    setSelectedPage,
    clearError,
  } = useWikiStore();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load page details
  useEffect(() => {
    if (pagePath && openAgentsService) {
      const decodedPagePath = decodeURIComponent(pagePath);
      console.log("WikiPageDetail: Loading page:", decodedPagePath);
      loadPage(decodedPagePath);
    }

    return () => {
      setSelectedPage(null);
    };
  }, [pagePath, openAgentsService, loadPage, setSelectedPage]);

  // Initialize edit content
  useEffect(() => {
    if (selectedPage && showEditModal) {
      setEditContent(selectedPage.wiki_content);
    }
  }, [selectedPage, showEditModal]);

  const handleBack = () => {
    navigate("/wiki");
  };

  const handleEdit = () => {
    setShowEditModal(true);
    clearError();
  };

  const handleSaveEdit = async () => {
    if (!selectedPage) return;

    const isOwner = selectedPage.creator_id === openAgentsService?.getAgentId();

    let success = false;
    if (isOwner) {
      success = await editPage(selectedPage.page_path, editContent);
    } else {
      success = await proposeEdit(
        selectedPage.page_path,
        editContent,
        proposalRationale
      );
    }

    if (success) {
      setShowEditModal(false);
      setEditContent("");
      setProposalRationale("");
    }
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditContent("");
    setProposalRationale("");
    clearError();
  };

  if (!selectedPage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('detail.loadingPage')}</p>
        </div>
      </div>
    );
  }

  if (pagesError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <div className={`text-red-500 mb-4`}>
            <svg
              className="w-12 h-12 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="mb-4 text-gray-700 dark:text-gray-300">{pagesError}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('detail.backToWiki')}
          </button>
        </div>
      </div>
    );
  }

  const isOwner = selectedPage.creator_id === openAgentsService?.getAgentId();

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-800">
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
          <div className="flex-1">
            <h1 className="text-2xl font-bold line-clamp-1 text-gray-900 dark:text-gray-100">
              {selectedPage.title || "Untitled"}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('detail.byVersion', {
                path: selectedPage.page_path || t('list.unknownPath'),
                user: selectedPage.creator_id || t('list.unknownCreator'),
                version: selectedPage.version || 1
              })}
            </p>
          </div>
        </div>

        <div className="flex space-x-2">
          {isOwner ? (
            <button
              onClick={handleEdit}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {t('detail.edit')}
            </button>
          ) : (
            <button
              onClick={handleEdit}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              {t('detail.proposeEdit')}
            </button>
          )}
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 bg-white dark:bg-gray-800">
        <div className="max-w-none">
          <MarkdownRenderer
            content={selectedPage.wiki_content || "No content available"}
            className="prose max-w-none dark:prose-invert text-gray-700 dark:text-gray-300"
          />
        </div>
      </div>

      {/* Edit modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="w-full max-w-4xl max-h-[600px] mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {isOwner 
                  ? t('detail.editTitle', { title: selectedPage.title })
                  : t('detail.proposeEditTitle', { title: selectedPage.title })}
              </h2>
            </div>

            <div className="flex-1 p-6 space-y-4 overflow-hidden">
              {pagesError && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-700 dark:text-red-300 text-sm">
                    {pagesError}
                  </p>
                </div>
              )}

              <WikiEditor
                value={editContent}
                onChange={setEditContent}
                modes={["edit", "preview", "diff"]}
                oldValue={selectedPage?.wiki_content || ""}
                oldTitle={t('detail.currentVersion')}
                newTitle={t('detail.yourChanges')}
                style={{ height: "200px" }}
                placeholder={t('detail.enterContentPlaceholder')}
              />

              {!isOwner && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    {t('detail.rationaleForChange')}
                  </label>
                  <textarea
                    value={proposalRationale}
                    onChange={(e) => setProposalRationale(e.target.value)}
                    className="w-full p-3 rounded-lg border resize-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                    rows={3}
                    placeholder={t('detail.rationalePlaceholder')}
                  />
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
              <button
                onClick={handleCancelEdit}
                className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                {t('detail.cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!isOwner && !proposalRationale.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isOwner ? t('detail.saveChanges') : t('detail.submitProposal')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WikiPageDetail;
