import React from "react";
import { Routes, Route } from "react-router-dom";
import InterviewTopicList from "@/components/interview/InterviewTopicList";
import InterviewTopicDetail from "@/components/interview/InterviewTopicDetail";

/**
 * Interview main page - handles all Interview related functionality
 */
const InterviewMainPage: React.FC = () => {
  return (
    <Routes>
      {/* Interview session list page */}
      <Route
        index
        element={<InterviewTopicList />}
      />

      {/* Interview session detail page */}
      <Route
        path=":topicId"
        element={<InterviewTopicDetail />}
      />
    </Routes>
  );
};

export default InterviewMainPage;
