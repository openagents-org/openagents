import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useNetworkStore } from "../stores/networkStore";
import useConnectedStatus from "../hooks/useConnectedStatus";

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
  const { isConnected } = useConnectedStatus();

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

    // 3. 有网络和代理名称但未连接 -> 连接加载页面
    if (!isConnected) {
      return "/connection-loading";
    }

    // 4. 所有条件满足 -> 可以访问聊天页面
    return null;
  };

  const requiredRoute = getRequiredRoute();
  const currentPath = location.pathname;

  // 如果需要重定向且当前路径不匹配，则进行重定向
  if (requiredRoute && currentPath !== requiredRoute) {
    console.log(`🔄 Redirecting from ${currentPath} to ${requiredRoute}`);
    return <Navigate to={requiredRoute} replace />;
  }

  // 如果用户试图访问他们不应该访问的页面，重定向到正确页面
  if (
    !requiredRoute &&
    (currentPath === "/network-selection" ||
      currentPath === "/agent-setup" ||
      currentPath === "/connection-loading")
  ) {
    console.log(`🔄 User completed setup, redirecting to /chat`);
    return <Navigate to="/chat" replace />;
  }

  // 当前页面正确，渲染内容
  return <>{children}</>;
};

export default RouteGuard;
