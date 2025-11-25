import React from "react";
import { Routes, Route } from "react-router-dom";
import WikiPageList from "../components/WikiPageList";
import WikiPageDetail from "../components/WikiPageDetail";
import WikiProposals from "../components/WikiProposals";

/**
 * Wiki主页面 - 处理Wiki相关的所有功能
 */
const WikiMainPage: React.FC = () => {
  return (
    <Routes>
      {/* 默认Wiki列表视图 */}
      <Route index element={<WikiPageList />} />

      {/* Wiki页面详情 */}
      <Route path="detail/:pagePath" element={<WikiPageDetail />} />

      {/* Wiki提案管理 */}
      <Route path="proposals" element={<WikiProposals />} />
    </Routes>
  );
};

export default WikiMainPage;

