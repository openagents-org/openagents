import React, { useEffect, useContext } from "react";
import { Routes, Route } from "react-router-dom";
import InterviewTopicList from "@/components/interview/InterviewTopicList";
import InterviewTopicDetail from "@/components/interview/InterviewTopicDetail";
import { useInterviewStore } from "@/stores/interviewStore";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

/**
 * Interview main page - handles all Interview related functionality
 */
const InterviewMainPage: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const { setupEventListeners, cleanupEventListeners } = useInterviewStore();

  // Setup event listeners at parent level to persist across navigation
  useEffect(() => {
    if (openAgentsService) {
      console.log("InterviewMainPage: Setting up interview event listeners");
      setupEventListeners();

      return () => {
        console.log("InterviewMainPage: Cleaning up interview event listeners");
        cleanupEventListeners();
      };
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners]);

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
