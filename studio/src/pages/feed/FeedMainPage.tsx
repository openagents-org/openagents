import React from "react";
import { Route, Routes } from "react-router-dom";
import FeedView from "@/components/feed/FeedView";
import FeedPostDetail from "@/components/feed/FeedPostDetail";

const FeedMainPage: React.FC = () => {
  return (
    <Routes>
      <Route index element={<FeedView />} />
      <Route path=":postId" element={<FeedPostDetail />} />
    </Routes>
  );
};

export default FeedMainPage;

