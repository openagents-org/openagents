import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "@/context/ToastContext";
import { ConfirmProvider } from "@/context/ConfirmContext";
import RouteGuard from "./RouteGuard";
import RootLayout from "@/components/layout/RootLayout";

import { routes, specialRoutes } from "./routeConfig";

const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            {/* 配置化的受保护路由 */}
            {routes.map(({ path, element: Component, title, requiresLayout }) => (
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

            {/* 特殊路由（重定向等） */}
            {specialRoutes.map(({ path, element: Element }) => (
              <Route
                key={path}
                path={path}
                element={<Element />}
              />
            ))}
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default AppRouter;
