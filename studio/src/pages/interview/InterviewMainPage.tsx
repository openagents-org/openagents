import React, { useContext, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";
import JobListView from "./JobListView";
import JobDetailView from "./JobDetailView";
import DiscussionView from "./DiscussionView";
import MyInterviewsView from "./MyInterviewsView";
import NotificationPanel from "./NotificationPanel";

const InterviewMainPage: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const connection = context?.connector || null;
  const isConnected = context?.isConnected;

  const {
    setConnection,
    loadJobs,
    loadNotifications,
    loadInterviews,
    fetchAssessmentStatus,
  } = useInterviewPortalStore();

  useEffect(() => {
    if (connection) {
      setConnection(connection);
      return () => {
        setConnection(null);
      };
    }
  }, [connection, setConnection]);

  useEffect(() => {
    console.log("connection", connection, isConnected);
    if (!connection || !isConnected) {
      return;
    }

    loadJobs();
    fetchAssessmentStatus();
    loadNotifications();
    loadInterviews();
  }, [
    connection,
    isConnected,
    loadJobs,
    fetchAssessmentStatus,
    loadNotifications,
    loadInterviews,
  ]);

  return (
    <div className="flex h-full w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded-xl overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route index element={<JobListView />} />
          <Route path="jobs/:jobId" element={<JobDetailView />} />
          <Route path="discussion" element={<DiscussionView />} />
          <Route path="my-interviews" element={<MyInterviewsView />} />
          <Route path="*" element={<Navigate to="/interview" replace />} />
        </Routes>
      </div>
      <NotificationPanel />
    </div>
  );
};

export default InterviewMainPage;
