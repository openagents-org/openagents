import React from "react"
import { PLUGIN_NAME_ENUM } from "@/types/plugins"

// Pages
import NetworkSelectionPage from "@/pages/NetworkSelectionPage"
import AgentSetupPage from "@/pages/AgentSetupPage"
import AdminLoginPage from "@/pages/AdminLoginPage"
import MessagingMainPage from "@/pages/messaging/MessagingMainPage"
import ProjectMainPage from "@/pages/project/ProjectMainPage"
import ForumMainPage from "@/pages/forum/ForumMainPage"
import ArtifactMainPage from "@/pages/artifact/ArtifactMainPage"
import WikiMainPage from "@/pages/wiki/WikiMainPage"
import DocumentsMainPage from "@/pages/documents/DocumentsMainPage"
// import SettingsMainPage from "@/pages/settings/SettingsMainPage";
import ProfileMainPage from "@/pages/profile/ProfileMainPage"
import AgentWorldMainPage from "@/pages/agentworld/AgentWorldMainPage"
import ReadmeMainPage from "@/pages/readme/ReadmeMainPage"
import ModManagementPage from "@/pages/mod-management/ModManagementPage"
// import McpMainPage from "@/pages/mcp/McpMainPage";
import FeedMainPage from "@/pages/feed/FeedMainPage"
import LLMLogsMainPage from "@/pages/llmlogs/LLMLogsMainPage"
import ServiceAgentsMainPage from "@/pages/serviceagents/ServiceAgentsMainPage"
import AdminMainPage from "@/pages/admin/AdminMainPage"
import OnboardingPage from "@/pages/OnboardingPage"

// Navigation icon components
export const NavigationIcons = {
  Messages: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
      })
    )
  ),
  Project: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
      })
    )
  ),
  Forum: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z",
      })
    )
  ),
  Feed: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 5a7 7 0 016.394 9.748l3.256 3.256a1 1 0 11-1.414 1.414l-3.256-3.256A7 7 0 119 5z",
      }),
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 8v8",
      })
    )
  ),
  Artifact: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z",
      })
    )
  ),
  Wiki: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
      })
    )
  ),
  Documents: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      })
    )
  ),
  // Settings: React.memo(() =>
  //   React.createElement("svg",
  //     {
  //       className: "w-5 h-5",
  //       fill: "none",
  //       stroke: "currentColor",
  //       viewBox: "0 0 24 24"
  //     },
  //     React.createElement("path", {
  //       strokeLinecap: "round",
  //       strokeLinejoin: "round",
  //       strokeWidth: 2,
  //       d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  //     }),
  //     React.createElement("path", {
  //       strokeLinecap: "round",
  //       strokeLinejoin: "round",
  //       strokeWidth: 2,
  //       d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  //     })
  //   )
  // ),
  Profile: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-5 h-5",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
      })
    )
  ),
  AgentWorld: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
      })
    )
  ),
  Readme: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      // Information circle icon - intuitive for README/info
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      })
    )
  ),
  ModManagement: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M19.11 4.89l-1.72 1.72a8 8 0 010 11.32l1.72-1.72a6 6 0 000-8.48l-1.72-1.72zM8.29 6.29l-1.72 1.72a6 6 0 000 8.48l1.72 1.72a8 8 0 010-11.32L8.29 6.29zM7 12a5 5 0 011.46-3.54l7.08 7.08A5 5 0 0117 12a5 5 0 01-1.46-3.54L8.46 15.54A5 5 0 017 12z",
      })
    )
  ),
  ServiceAgents: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      // Server/Service icon for service agents
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01",
      })
    )
  ),
  Events: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
      })
    )
  ),
  LLMLogs: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      }),
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M13 10V3L4 14h7v7l9-11h-7z",
      })
    )
  ),
  Shield: React.memo(() =>
    React.createElement(
      "svg",
      {
        className: "w-6 h-6",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
      },
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
      }),
      React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M9 12l2 2 4-4",
      })
    )
  ),
  // MCP: React.memo(() =>
  //   React.createElement("svg",
  //     {
  //       className: "w-5 h-5",
  //       fill: "none",
  //       stroke: "currentColor",
  //       viewBox: "0 0 24 24"
  //     },
  //     React.createElement("path", {
  //       strokeLinecap: "round",
  //       strokeLinejoin: "round",
  //       strokeWidth: 2,
  //       d: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
  //     })
  //   )
  // ),
}

// Route configuration interface
export interface RouteConfig {
  path: string
  element: React.ComponentType
  requiresAuth?: boolean
  requiresLayout?: boolean // Whether RootLayout (including sidebar) is required
  title?: string
  // ModSidebar configuration
  navigationConfig?: {
    key: PLUGIN_NAME_ENUM
    label: string
    icon: keyof typeof NavigationIcons
    visible: boolean
    order: number // Sort weight
    group: "primary" | "secondary" // Primary function | Secondary function
  }
}

// Dynamic route configuration - can be dynamically adjusted through interface or configuration file
export const dynamicRouteConfig: RouteConfig[] = [
  // Authentication-related routes - these pages don't need sidebar and full layout
  {
    path: "/",
    element: NetworkSelectionPage,
    title: "Network Selection",
    requiresLayout: false,
  },
  {
    path: "/agent-setup",
    element: AgentSetupPage,
    title: "Agent Setup",
    requiresLayout: false,
  },
  {
    path: "/admin-login",
    element: AdminLoginPage,
    title: "Admin Login",
    requiresLayout: false,
  },
  {
    path: "/onboarding",
    element: OnboardingPage,
    title: "Onboarding",
    requiresLayout: false,
  },

  // Main feature routes - these pages need full sidebar layout
  {
    path: "/messaging/*",
    element: MessagingMainPage,
    title: "Messaging",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.MESSAGING,
      label: "Messages",
      icon: "Messages",
      visible: true,
      order: 1,
      group: "primary",
    },
  },
  {
    path: "/feed/*",
    element: FeedMainPage,
    title: "Feed",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.FEED,
      label: "Info Feed",
      icon: "Feed",
      visible: true,
      order: 1.2,
      group: "primary",
    },
  },
  {
    path: "/project/*",
    element: ProjectMainPage,
    title: "Project",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.PROJECT,
      label: "Projects",
      icon: "Project",
      visible: true,
      order: 1.5,
      group: "primary",
    },
  },
  {
    path: "/forum/*",
    element: ForumMainPage,
    title: "Forum",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.FORUM,
      label: "Forum",
      icon: "Forum",
      visible: true,
      order: 2,
      group: "primary",
    },
  },
  {
    path: "/artifact/*",
    element: ArtifactMainPage,
    title: "Artifact",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.ARTIFACT,
      label: "Artifact",
      icon: "Artifact",
      visible: true,
      order: 2.2,
      group: "primary",
    },
  },
  {
    path: "/wiki/*",
    element: WikiMainPage,
    title: "Wiki",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.WIKI,
      label: "Wiki",
      icon: "Wiki",
      visible: true,
      order: 2.5,
      group: "primary",
    },
  },
  {
    path: "/documents/*",
    element: DocumentsMainPage,
    title: "Documents",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.DOCUMENTS,
      label: "Documents",
      icon: "Documents",
      visible: true,
      order: 3,
      group: "primary",
    },
  },
  {
    path: "/agentworld/*",
    element: AgentWorldMainPage,
    title: "AgentWorld",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.AGENTWORLD,
      label: "AgentWorld",
      icon: "AgentWorld",
      visible: false, // Only visible when agentworld mod is enabled
      order: 3.5,
      group: "primary",
    },
  },

  // Settings-related routes - these pages need full sidebar layout
  // {
  //   path: "/settings/*",
  //   element: SettingsMainPage,
  //   title: "Settings",
  //   requiresAuth: true,
  //   requiresLayout: true,
  //   navigationConfig: {
  //     key: PLUGIN_NAME_ENUM.SETTINGS,
  //     label: "Settings",
  //     icon: "Settings",
  //     visible: true,
  //     order: 4,
  //     group: 'secondary',
  //   },
  // },
  {
    path: "/profile/*",
    element: ProfileMainPage,
    title: "Profile",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.PROFILE,
      label: "Profile",
      icon: "Profile",
      visible: true,
      order: 5,
      group: "secondary",
    },
  },
  {
    path: "/readme/*",
    element: ReadmeMainPage,
    title: "README",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.README,
      label: "README",
      icon: "Readme",
      visible: true,
      order: 3.5,
      group: "primary",
    },
  },
  {
    path: "/mod-management/*",
    element: ModManagementPage,
    title: "Mod Management",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.MOD_MANAGEMENT,
      label: "Mod Management",
      icon: "ModManagement",
      visible: true,
      order: 6,
      group: "secondary",
    },
  },
  {
    path: "/studio/agents/service/*",
    element: ServiceAgentsMainPage,
    title: "Service Agents",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.SERVICE_AGENTS,
      label: "Service Agents",
      icon: "ServiceAgents",
      visible: false, // Only visible in admin dashboard
      order: 7,
      group: "secondary",
    },
  },
  {
    path: "/llm-logs/*",
    element: LLMLogsMainPage,
    title: "LLM Logs",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.LLM_LOGS,
      label: "LLM Logs",
      icon: "LLMLogs",
      visible: false, // Only visible in admin dashboard
      order: 4,
      group: "secondary",
    },
  },
  {
    path: "/admin/*",
    element: AdminMainPage,
    title: "Admin Dashboard",
    requiresAuth: true,
    requiresLayout: true,
    navigationConfig: {
      key: PLUGIN_NAME_ENUM.ADMIN,
      label: "Admin",
      icon: "Shield",
      visible: false, // Will be dynamically controlled by useIsAdmin in ModSidebar
      order: 4.5,
      group: "secondary",
    },
  },
  // {
  //   path: "/mcp/*",
  //   element: McpMainPage,
  //   title: "MCP",
  //   requiresAuth: true,
  //   requiresLayout: true,
  //   navigationConfig: {
  //     key: PLUGIN_NAME_ENUM.MCP,
  //     label: "MCP",
  //     icon: "MCP",
  //     visible: true,
  //     order: 6,
  //     group: 'secondary',
  //   },
  // },
]

// // Quick action configuration - quick actions independent of routes
// export interface QuickActionConfig {
//   id: string;
//   title: string;
//   subtitle: string;
//   icon: React.ReactNode;
//   route: string;
//   visible: boolean;
//   order: number;
//   style: {
//     gradient: string;
//     hoverGradient: string;
//     backgroundImage?: string;
//   };
// }

// export const quickActionConfig: QuickActionConfig[] = [
//   {
//     id: 'documents-quick',
//     title: 'Documents',
//     subtitle: 'Collaborative editing',
//     icon: React.createElement("svg",
//       {
//         className: "w-4 h-4",
//         fill: "none",
//         stroke: "currentColor",
//         viewBox: "0 0 24 24"
//       },
//       React.createElement("path", {
//         strokeLinecap: "round",
//         strokeLinejoin: "round",
//         strokeWidth: 2,
//         d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
//       })
//     ),
//     route: '/documents',
//     visible: true,
//     order: 1,
//     style: {
//       gradient: 'bg-gradient-to-r from-green-600 to-emerald-600 text-white font-medium shadow-md',
//       hoverGradient: 'bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 text-green-700 dark:text-green-300 font-medium border border-green-200 dark:border-green-800/50 hover:shadow-md hover:from-green-200 hover:to-emerald-200 dark:hover:from-green-800/40 dark:hover:to-emerald-800/40',
//       backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(34, 197, 94, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(16, 185, 129, 0.1) 0%, transparent 50%), linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)'
//     }
//   },
//   {
//     id: 'mcp-quick',
//     title: 'MCP Store',
//     subtitle: 'Browse AI plugins & tools',
//     icon: React.createElement("svg",
//       {
//         className: "w-4 h-4",
//         fill: "none",
//         stroke: "currentColor",
//         viewBox: "0 0 24 24"
//       },
//       React.createElement("path", {
//         strokeLinecap: "round",
//         strokeLinejoin: "round",
//         strokeWidth: 2,
//         d: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
//       })
//     ),
//     route: '/mcp',
//     visible: true,
//     order: 2,
//     style: {
//       gradient: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium shadow-md',
//       hoverGradient: 'bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 text-purple-700 dark:text-purple-300 font-medium border border-purple-200 dark:border-purple-800/50 hover:shadow-md hover:from-purple-200 hover:to-pink-200 dark:hover:from-purple-800/40 dark:hover:to-pink-800/40',
//       backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(147, 51, 234, 0.1) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(236, 72, 153, 0.1) 0%, transparent 50%), linear-gradient(45deg, rgba(147, 51, 234, 0.05) 0%, rgba(236, 72, 153, 0.05) 100%), repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(147, 51, 234, 0.03) 2px, rgba(147, 51, 234, 0.03) 4px)'
//     }
//   },
// ];

// Utility function: get visible navigation routes
export const getVisibleNavigationRoutes = () => {
  return dynamicRouteConfig
    .filter((route) => route.navigationConfig?.visible)
    .sort(
      (a, b) =>
        (a.navigationConfig?.order || 0) - (b.navigationConfig?.order || 0)
    )
}

// Utility function: get navigation routes by group
export const getNavigationRoutesByGroup = (group: "primary" | "secondary") => {
  const visibleRoutes = getVisibleNavigationRoutes();
  return visibleRoutes.filter(
    (route) => route.navigationConfig?.group === group
  );
}

// // Utility function: get visible quick actions
// export const getVisibleQuickActions = () => {
//   return quickActionConfig
//     .filter(action => action.visible)
//     .sort((a, b) => a.order - b.order);
// };

// Utility function: get all routes that need to be registered
export const getAllRoutes = () => {
  return dynamicRouteConfig
}

// Special routes (redirects, etc.)
export const specialRoutes = [
  // No special routes needed - NetworkSelectionPage is served directly under /
]

// Dynamic configuration update function - can update configuration through interface calls
export const updateRouteVisibility = (
  pluginKey: PLUGIN_NAME_ENUM,
  visible: boolean
) => {
  const route = dynamicRouteConfig.find(
    (r) => r.navigationConfig?.key === pluginKey
  )
  if (route?.navigationConfig) {
    route.navigationConfig.visible = visible
  }
}

// export const updateQuickActionVisibility = (actionId: string, visible: boolean) => {
//   const action = quickActionConfig.find(a => a.id === actionId);
//   if (action) {
//     action.visible = visible;
//   }
// };
