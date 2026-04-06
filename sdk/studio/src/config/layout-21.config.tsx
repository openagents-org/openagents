import { MenuConfig } from "@/config/types";
import {
  ChartLine,
  Cog,
  UserRoundCog,
  Bolt,
  Users,
  Download,
  FileChartLine,
  SquareActivity,
  Newspaper,
  Briefcase,
  Megaphone,
  Palette,
  BarChart2,
  Handshake,
} from "lucide-react";

export const MENU_SIDEBAR_MAIN: MenuConfig = [
  {
    children: [
      {
        title: 'Home',
        path: '#',
        icon: Bolt
      },
      {
        title: 'Updates',
        path: '/layout-21',
        icon: Users
      },
      {
        title: 'Inbox',
        path: '#',
        icon: UserRoundCog
      },
      {
        title: 'Clients',
        path: '#',
        icon: Cog,
        badge: 'Beta'
      },
      {
        title: 'My Tasks',
        path: '#',
        icon: ChartLine
      },
    ],
  }
];

export const MENU_SIDEBAR_RESOURCES: MenuConfig = [
  {
    title: 'Resources',
    children: [
      {
        title: 'About Metronic',
        path: '#',
        icon: Download
      },
      {
        title: 'Advertise',
        path: '#',
        icon: FileChartLine,
        badge: 'Pro'
      },
      {
        title: 'Help',
        path: '#',
        icon: SquareActivity
      },
      {
        title: 'Blog',
        path: '#',
        icon: Newspaper
      },
      {
        title: 'Careers',
        path: '#',
        icon: Briefcase
      },
      {
        title: 'Press',
        path: '#',
        icon: Megaphone
      },
    ],
  }
];

export const MENU_SIDEBAR_WORKSPACES: MenuConfig = [
  {
    title: 'Workspaces',
    children: [
      {
        title: 'Business Concepts',
        path: '#',
        icon: Briefcase
      },
      {
        title: 'KeenThemes Studio',
        path: '#',
        icon: Palette
      },
      {
        title: 'Teams',
        path: '#',
        icon: Handshake,
        badge: 'Pro'
      },
      {
        title: 'Reports',
        path: '#',
        icon: BarChart2
      },
    ],
  }
];

