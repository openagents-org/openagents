import React, { useContext, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";
import { isInterviewHubMode } from "@/config/interviewHubConfig";
import JobListView from "./JobListView";
import JobDetailView from "./JobDetailView";
import InterviewerHubView from "./InterviewerHubView";
import RightSidebar from "./RightSidebar";
import UserRegistrationModal from "./UserRegistrationModal";

const InterviewMainPage: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const connection = context?.connector || null;
  const isConnected = context?.isConnected;

  const {
    setConnection,
    userInfo,
    userInfoChecked,
    checkUserInfo,
    registerUser,
    loadJobs,
    loadNotifications,
    loadInterviews,
    fetchAssessmentStatus,
  } = useInterviewPortalStore();

  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [autoRegistrationAttempted, setAutoRegistrationAttempted] = useState(false);

  useEffect(() => {
    if (connection) {
      setConnection(connection);
      return () => {
        setConnection(null);
      };
    }
  }, [connection, setConnection]);

  // Check user info on connection
  useEffect(() => {
    if (!connection || !isConnected) {
      return;
    }
    checkUserInfo();
  }, [connection, isConnected, checkUserInfo]);

  // Auto-register in Interview Hub mode
  useEffect(() => {
    if (
      isInterviewHubMode() &&
      connection &&
      isConnected &&
      userInfoChecked &&
      !userInfo &&
      !autoRegistrationAttempted
    ) {
      // Try to get stored user info from localStorage
      const storedUserInfoStr = localStorage.getItem('interview_hub_user_info');
      if (storedUserInfoStr) {
        try {
          const storedUserInfo = JSON.parse(storedUserInfoStr);
          console.log('🎯 Interview Hub Mode: Auto-registering user', storedUserInfo);

          setAutoRegistrationAttempted(true);
          registerUser(storedUserInfo).then((success) => {
            if (success) {
              // Clear the stored info after successful registration
              localStorage.removeItem('interview_hub_user_info');
            }
          });
        } catch (error) {
          console.error('Failed to parse stored user info:', error);
          setAutoRegistrationAttempted(true);
        }
      } else {
        setAutoRegistrationAttempted(true);
      }
    }
  }, [connection, isConnected, userInfoChecked, userInfo, autoRegistrationAttempted, registerUser]);

  // Show registration modal if user is not registered (and not in auto-registration mode)
  useEffect(() => {
    if (userInfoChecked && !userInfo) {
      // In Interview Hub mode, only show modal if auto-registration failed
      if (isInterviewHubMode()) {
        setShowRegistrationModal(autoRegistrationAttempted);
      } else {
        setShowRegistrationModal(true);
      }
    } else {
      setShowRegistrationModal(false);
    }
  }, [userInfoChecked, userInfo, autoRegistrationAttempted]);

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

  const handleRegister = async (data: {
    email: string;
    first_name: string;
    last_name: string;
  }) => {
    const success = await registerUser(data);
    return success;
  };

  return (
    <>
      <div className="flex h-full w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded-xl overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route index element={<JobListView />} />
            <Route path="jobs/:jobId" element={<JobDetailView />} />
            <Route path="interviewer-hub" element={<InterviewerHubView />} />
            <Route path="*" element={<Navigate to="/interview" replace />} />
          </Routes>
        </div>
        <RightSidebar />
      </div>

      <UserRegistrationModal
        isOpen={showRegistrationModal}
        onRegister={handleRegister}
      />
    </>
  );
};

export default InterviewMainPage;
