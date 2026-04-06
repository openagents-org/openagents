import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import ArtifactCreateModal from "@/components/artifact/components/ArtifactCreateModal";

// Artifact Sidebar Content Component
const ArtifactSidebar: React.FC = () => {
  const { t } = useTranslation('artifact');
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* New Artifact Button Section */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span className="font-medium">{t('sidebar.newArtifact')}</span>
        </button>
      </div>

      {/* Additional content can be added here */}
      <div className="flex-1 flex items-center justify-center px-4 py-3">
        <div className="text-center text-gray-400 dark:text-gray-500">
          <p className="text-sm">{t('sidebar.navigation')}</p>
          <p className="text-xs mt-2 text-gray-500 dark:text-gray-600">
            {t('sidebar.filters')}
          </p>
        </div>
      </div>

      {/* Create Artifact Modal */}
      <ArtifactCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
};

export default React.memo(ArtifactSidebar);
