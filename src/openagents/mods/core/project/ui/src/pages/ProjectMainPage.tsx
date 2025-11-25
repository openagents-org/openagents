import React from "react";
import { Routes, Route } from "react-router-dom";
import ProjectChatRoom from "./components/ProjectChatRoom";

const ProjectMainPage: React.FC = () => {
  return (
    <div className="h-full bg-white dark:bg-gray-900">
      <Routes>
        <Route index element={<ProjectChatRoom />} />
        <Route path=":projectId" element={<ProjectChatRoom />} />
      </Routes>
    </div>
  );
};

export default ProjectMainPage;

