import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useNetworkStore } from "../stores/networkStore";
import { routes } from "./routeConfig";

interface RouteGuardProps {
  children: React.ReactNode;
}

/**
 * 全局路由守卫 - 集中处理所有页面流程的路由逻辑
 * 根据当前状态确定用户应该在哪个页面
 */
const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
  const location = useLocation();
  const { selectedNetwork, agentName } = useNetworkStore();

  // 集中处理所有路由逻辑
  const getRequiredRoute = (): string | null => {
    // 1. 没有选择网络 -> 网络选择页面
    if (!selectedNetwork) {
      return "/network-selection";
    }

    // 2. 有网络但没有代理名称 -> 代理设置页面
    if (!agentName) {
      return "/agent-setup";
    }

    // 3. 有网络和代理名称 -> 可以访问认证页面，连接状态由 RootLayout 处理
    return null;
  };

  const requiredRoute = getRequiredRoute();
  const currentPath = location.pathname;

  // 如果需要重定向且当前路径不匹配，则进行重定向
  if (requiredRoute && currentPath !== requiredRoute) {
    console.log(`🔄 Redirecting from ${currentPath} to ${requiredRoute}`);
    return <Navigate to={requiredRoute} replace />;
  }

  // 如果用户已认证但试图访问设置页面，重定向到聊天页面
  if (
    !requiredRoute &&
    (currentPath === "/network-selection" ||
      currentPath === "/agent-setup")
  ) {
    console.log(`🔄 User completed setup, redirecting to /chat`);
    return <Navigate to="/chat" replace />;
  }

  // 如果用户已认证，检查当前路径是否为有效的认证路由
  if (!requiredRoute) {
    const isValidAuthenticatedRoute = routes.some(route => {
      if (!route.requiresAuth) return false;

      // 处理通配符路径 (如 "/forum/*")
      if (route.path.endsWith("/*")) {
        const basePath = route.path.slice(0, -2); // 移除 "/*"
        return currentPath === basePath || currentPath.startsWith(basePath + "/");
      }

      // 精确匹配
      return currentPath === route.path;
    });

    // 如果当前路径不是有效的认证路由，重定向到聊天页面
    if (!isValidAuthenticatedRoute && currentPath !== "/chat" && !currentPath.startsWith("/chat/")) {
      console.log(`🔄 Invalid authenticated route ${currentPath}, redirecting to /chat`);
      return <Navigate to="/chat" replace />;
    }
  }

  // 当前页面正确，渲染内容
  return <>{children}</>;
};

export default RouteGuard;
