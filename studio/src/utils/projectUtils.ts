import { HealthResponse } from "./moduleUtils";

/**
 * Check if project mode is enabled
 */
export const isProjectModeEnabled = (healthData: HealthResponse | null): boolean => {
  if (!healthData?.data?.mods) {
    return false;
  }

  return healthData.data.mods.some(
    (mod) => mod.name === "openagents.mods.workspace.project" && mod.enabled
  );
};

/**
 * Project template interface definition
 */
export interface ProjectTemplate {
  template_id: string;
  name: string;
  description: string;
  agent_groups: string[];
  context: string;
}

/**
 * Get project templates list from health data (fallback method)
 * Should primarily use project.template.list event to get templates
 */
export const getProjectTemplatesFromHealth = (
  healthData: HealthResponse | null
): ProjectTemplate[] => {
  if (!healthData?.data?.mods) {
    return [];
  }

  const projectMod = healthData.data.mods.find(
    (mod) => mod.name === "openagents.mods.workspace.project" && mod.enabled
  );

  if (!projectMod?.config?.project_templates) {
    return [];
  }

  const templates = projectMod.config.project_templates;
  return Object.entries(templates).map(([templateId, templateData]: [string, any]) => ({
    template_id: templateId,
    name: templateData.name || templateId,
    description: templateData.description || "",
    agent_groups: templateData.agent_groups || [],
    context: templateData.context || "",
  }));
};

/**
 * Check if channel is a project channel
 */
export const isProjectChannel = (channelName: string): boolean => {
  const normalizedName = channelName.startsWith("#") 
    ? channelName.slice(1) 
    : channelName;
  return normalizedName.startsWith("project-");
};

/**
 * Extract project ID from project channel name
 * Channel format: project-{template_id}-{project_id}
 */
export const extractProjectIdFromChannel = (channelName: string): string | null => {
  const normalizedName = channelName.startsWith("#") 
    ? channelName.slice(1) 
    : channelName;
  
  if (normalizedName.startsWith("project-")) {
    // Extract project_id from format: project-{template_id}-{project_id}
    const parts = normalizedName.replace("project-", "").split("-");
    if (parts.length >= 2) {
      // Return the project_id (everything after template_id)
      return parts.slice(1).join("-");
    }
    // Fallback for old format: project-{project_id}
    return parts[0];
  }
  
  return null;
};

