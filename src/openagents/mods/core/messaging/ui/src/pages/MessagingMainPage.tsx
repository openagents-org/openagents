import React from "react";
import { Routes, Route } from "react-router-dom";
import MessagingView from "./MessagingView";
import ProjectChatRoom from "./components/ProjectChatRoom";
/**
 * 聊天主页面 - 使用 chatStore 统一架构
 */
const MessagingMainPage: React.FC = () => {

  return (
    <Routes>
      {/* 项目私密聊天室独立路由 */}
      <Route
        path="project/:projectId"
        element={<ProjectChatRoom />}
      />

      {/* 默认聊天视图 */}
      <Route
        index
        element={
          <MessagingView />
        }
      />

      {/* 其他聊天相关的子路由可以在这里添加 */}
    </Routes>
  );
};

export default MessagingMainPage;

