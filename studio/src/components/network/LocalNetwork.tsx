import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { detectLocalNetwork, getCurrentNetworkHealth } from "@/services/networkService";
import { NetworkConnection } from "@/types/connection";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate } from "react-router-dom";
import LanguageSwitcher from "@/components/common/LanguageSwitcher";

const LocalNetworkLoading = React.memo(() => {
  const { t } = useTranslation('auth');

  return (
    <div className="flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      <span className="ml-3 text-gray-600 dark:text-gray-400">
        {t('localNetwork.detecting')}
      </span>
    </div>
  );
});

const LocalNetworkNotFound = React.memo(() => {
  const { t } = useTranslation('auth');

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
      <p className="text-yellow-800 dark:text-yellow-400">
        {t('localNetwork.notFound')}
      </p>
    </div>
  );
});

const LocalNetworkShow = React.memo(
  ({ localNetwork }: { localNetwork: NetworkConnection }) => {
    const { t } = useTranslation('auth');
    const navigate = useNavigate();
    const { host, port } = localNetwork;
    const { handleNetworkSelected } = useAuthStore();

    const handleConnect = async () => {
      handleNetworkSelected(localNetwork);
      // Network selection will trigger onboarding check in NetworkSelectionPage
      // No need to navigate here, the page will show onboarding if needed
    };

    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-green-800 dark:text-green-400">
              {t('localNetwork.found')}
            </h3>
            <p className="text-green-600 dark:text-green-500">
              {t('localNetwork.runningOn', { host, port })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleConnect()}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {t('localNetwork.connect')}
            </button>
            <button
              onClick={() => {
                // Navigate to admin login page with connection info in state
                // Don't call handleNetworkSelected here to avoid triggering redirects
                navigate('/admin-login', {
                  state: { pendingConnection: localNetwork },
                  replace: true
                });
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {t('localNetwork.manageNetwork')}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

const LocalNetwork: React.FC = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { handleNetworkSelected } = useAuthStore();
  const [localNetwork, setLocalNetwork] = useState<NetworkConnection | null>(
    null
  );
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);

  useEffect(() => {
    const checkLocal = async () => {
      setIsLoadingLocal(true);
      try {
        const local = await detectLocalNetwork();
        setLocalNetwork(local);

        // If network detected, check if it's initialized
        // If not initialized, auto-connect and redirect to onboarding
        if (local) {
          try {
            const healthResult = await getCurrentNetworkHealth(local);
            const isInitialized = healthResult.data?.data?.initialized === true;

            if (!isInitialized) {
              // Auto-connect to the network and redirect to onboarding
              handleNetworkSelected(local);
              navigate("/onboarding", { replace: true });
              return;
            }
          } catch (error) {
            console.error("Error checking network health:", error);
          }
        }
      } catch (error) {
        console.error("Error detecting local network:", error);
      } finally {
        setIsLoadingLocal(false);
      }
    };

    checkLocal();
  }, [handleNetworkSelected, navigate]);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
          {t('localNetwork.title')}
        </h2>
        {/* Language Switcher - Right side of title */}
        <LanguageSwitcher
          showFlag={true}
          showFullName={false}
          variant="minimal"
          align="right"
          size="lg"
        />
      </div>
      {isLoadingLocal ? (
        <LocalNetworkLoading />
      ) : !localNetwork ? (
        <LocalNetworkNotFound />
      ) : (
        <LocalNetworkShow localNetwork={localNetwork} />
      )}
    </div>
  );
};

export default LocalNetwork;
