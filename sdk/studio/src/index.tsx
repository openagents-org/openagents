import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import "./i18n"; // Initialize i18n
import App from "./App";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>
);
