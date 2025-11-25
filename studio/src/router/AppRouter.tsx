import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/context/ConfirmContext";
import RouteGuard from "./RouteGuard";
import { routes, getAllRoutesWithModUI } from "./routeConfig";
import RootLayout from "@/components/layout/RootLayout";
import { getLoadedModUIs } from "@/utils/modUILoader";
import ModUIWrapper from "@/components/mod/ModUIWrapper";

// Create protected routes wrapper component
const ProtectedRoutes: React.FC = () => {
  const [modUIRoutes, setModUIRoutes] = useState<any[]>([]);
  const [updateKey, setUpdateKey] = useState(0);

  // Load mod UI routes dynamically and update when mod UIs are loaded
  useEffect(() => {
    const updateRoutes = () => {
      const loadedModUIs = getLoadedModUIs();
      const routes = loadedModUIs
        .filter((modUI) => modUI.component && !modUI.error && modUI.config.enabled)
        .map((modUI) => ({
          modName: modUI.modName,
          path: modUI.config.route,
          config: modUI.config,
        }));
      setModUIRoutes(routes);
    };

    // Initial load
    updateRoutes();

    // Poll for updates (mod UIs are loaded asynchronously)
    const interval = setInterval(() => {
      updateRoutes();
    }, 1000);

    // Also listen for custom event when mod UIs are loaded
    const handleModUILoaded = () => {
      updateRoutes();
      setUpdateKey((prev) => prev + 1);
    };
    window.addEventListener('mod-ui-loaded', handleModUILoaded);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mod-ui-loaded', handleModUILoaded);
    };
  }, []);

  // Get all routes including mod UI routes
  const allRoutes = getAllRoutesWithModUI();
  const protectedRoutes = allRoutes.filter((route) => route.requiresAuth);

  return (
    <Routes key={updateKey}>
      {protectedRoutes.map(({ path, element: Component, requiresLayout }) => (
        <Route
          key={path}
          path={path}
          element={
            <RouteGuard>
              {requiresLayout ? (
                <RootLayout>
                  <Component />
                </RootLayout>
              ) : (
                <Component />
              )}
            </RouteGuard>
          }
        />
      ))}
      {/* Dynamic mod UI routes */}
      {modUIRoutes.map(({ modName, path }) => (
        <Route
          key={`mod-ui-${modName}`}
          path={`${path}/*`}
          element={
            <RouteGuard>
              <RootLayout>
                <ModUIWrapper modName={modName} />
              </RootLayout>
            </RouteGuard>
          }
        />
      ))}
    </Routes>
  );
};

const AppRouter: React.FC = () => {
  // Get routes that don't require authentication (login pages)
  const publicRoutes = routes.filter((route) => !route.requiresAuth);

  return (
    <BrowserRouter>
      <ConfirmProvider>
        <Toaster position="top-right" richColors />
        <Routes>
          {publicRoutes.map(({ path, element: Component, requiresLayout }) => (
            <Route
              key={path}
              path={path}
              element={
                <RouteGuard>
                  {requiresLayout ? (
                    <RootLayout>
                      <Component />
                    </RootLayout>
                  ) : (
                    <Component />
                  )}
                </RouteGuard>
              }
            />
          ))}

          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </ConfirmProvider>
    </BrowserRouter>
  );
};

export default AppRouter;
