import React, { useEffect } from "react";
import AppRouter from "./router/AppRouter";
import { clearAllOpenAgentsData } from "@/utils/cookies";

const App: React.FC = () => {
  useEffect(() => {
    (window as any).clearOpenAgentsData = clearAllOpenAgentsData;
  }, []);

  return <AppRouter />;
};

export default App;
