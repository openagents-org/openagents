import React from "react";
import { Routes, Route } from "react-router-dom";
import ForumTopicList from "@/components/forum/ForumTopicList";
import ForumTopicDetail from "@/components/forum/ForumTopicDetail";

/**
 * Forum主页面 - 处理Forum相关的所有功能
 */
const ForumMainPage: React.FC = () => {
  return (
    <Routes>
      {/* 话题列表页 */}
      <Route
        index
        element={<ForumTopicList />}
      />

      {/* 话题详情页 */}
      <Route
        path=":topicId"
        element={<ForumTopicDetail />}
      />
    </Routes>
  );
};

export default ForumMainPage;