import React from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useDynamicRoutes } from "@/hooks/useDynamicRoutes";
import { toast } from "sonner";

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

/**
 * AdminRouteGuard - Protects admin routes and redirects non-admin users
 * Non-admin users will be immediately redirected to their default route
 */
const AdminRouteGuard: React.FC<AdminRouteGuardProps> = ({ children }) => {
  const { t } = useTranslation("admin");
  const { isAdmin, isLoading } = useIsAdmin();
  const { defaultRoute } = useDynamicRoutes();

  if (isLoading) {
    return (
      <div className="p-6 h-full flex items-center justify-center dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t("checkingPrivileges")}</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    // Immediately redirect non-admin users to their default route
    console.log("🛡️ Non-admin user attempted to access admin route, redirecting to default route...");
    toast.error(t("noAdminPrivileges"));
    return <Navigate to={defaultRoute || "/messaging"} replace />;
  }

  return <>{children}</>;
};

export default AdminRouteGuard;

