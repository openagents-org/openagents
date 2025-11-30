import React from "react";
import { Routes, Route } from "react-router-dom";
import MessagingView from "./MessagingView";
import ProjectChatRoom from "./components/ProjectChatRoom";
/**
 * Messaging main page - Use chatStore unified architecture
 */
const MessagingMainPage: React.FC = () => {

  return (
    <Routes>
      {/* Project private chat room independent route */}
      <Route
        path="project/:projectId"
        element={<ProjectChatRoom />}
      />

      {/* Default chat view */}
      <Route
        index
        element={
          <MessagingView />
        }
      />

      {/* Other chat-related sub-routes can be added here */}
    </Routes>
  );
};

export default MessagingMainPage;
