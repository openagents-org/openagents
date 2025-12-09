import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/context/ConfirmContext";
import RouteGuard from "./RouteGuard";
import { routes } from "./routeConfig";
import RootLayout from "@/components/layout/RootLayout";

// Detect basename from URL path (for /studio serving)
const getBasename = (): string => {
  const path = window.location.pathname;
  // If served from /studio/, use that as basename
  if (path.startsWith("/studio")) {
    return "/studio";
  }
  return "/";
};

// Create protected routes wrapper component
const ProtectedRoutes: React.FC = () => {
  // Get routes that require authentication (pages after login)
  const protectedRoutes = routes.filter((route) => route.requiresAuth);

  return (
    <Routes>
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
    </Routes>
  );
};

const AppRouter: React.FC = () => {
  // Get routes that don't require authentication (login pages)
  const publicRoutes = routes.filter((route) => !route.requiresAuth);

  return (
    <BrowserRouter basename={getBasename()}>
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
