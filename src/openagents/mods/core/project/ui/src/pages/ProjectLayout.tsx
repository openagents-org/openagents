import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import RootLayout from "../components/layout/RootLayout";
import ProjectMainPage from "./ProjectMainPage";
import { useProfileStore } from "../stores/profileStore";

const ProjectLayout: React.FC = () => {
  const fetchProfile = useProfileStore((state) => state.fetchProfileData);

  useEffect(() => {
    fetchProfile().catch((error) =>
      console.error("Failed to fetch profile data:", error)
    );
  }, [fetchProfile]);

  return (
    <RootLayout>
      <Routes>
        <Route path="/*" element={<ProjectMainPage />} />
        <Route path="*" element={<Navigate to="/project" replace />} />
      </Routes>
    </RootLayout>
  );
};

export default ProjectLayout;

