// Re-export everything from the centralized config
export {
  type RouteConfig,
  dynamicRouteConfig as routes,
  specialRoutes,
  getAllRoutes,
  getAllRoutesWithModUI,
  getVisibleNavigationRoutes,
  getNavigationRoutesByGroup,
  updateRouteVisibility
} from "@/config/routeConfig";