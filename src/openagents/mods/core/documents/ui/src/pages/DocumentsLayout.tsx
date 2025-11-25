import React from "react";
import { Routes, Route } from "react-router-dom";
import RootLayout from "../components/layout/RootLayout";
import DocumentsMainPage from "./DocumentsMainPage";

const DocumentsLayout: React.FC = () => {
  return (
    <RootLayout>
      <Routes>
        <Route path="/*" element={<DocumentsMainPage />} />
      </Routes>
    </RootLayout>
  );
};

export default DocumentsLayout;

