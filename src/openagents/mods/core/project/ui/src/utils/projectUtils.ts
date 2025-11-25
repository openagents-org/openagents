import { HealthResponse } from "./moduleUtils";

export interface ProjectTemplate {
  template_id: string;
  name: string;
  description: string;
  agent_groups: string[];
  context: string;
}

export const isProjectModeEnabled = (
  healthData: HealthResponse | null
): boolean => {
  if (!healthData?.data?.mods) {
    return false;
  }

  return healthData.data.mods.some(
    (mod) => mod.name === "openagents.mods.workspace.project" && mod.enabled
  );
};

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
  return Object.entries(templates).map(
    ([templateId, templateData]: [string, any]) => ({
      template_id: templateId,
      name: templateData.name || templateId,
      description: templateData.description || "",
      agent_groups: templateData.agent_groups || [],
      context: templateData.context || "",
    })
  );
};

export const isProjectChannel = (channelName: string): boolean => {
  const normalizedName = channelName.startsWith("#")
    ? channelName.slice(1)
    : channelName;
  return normalizedName.startsWith("project-");
};

export const extractProjectIdFromChannel = (
  channelName: string
): string | null => {
  const normalizedName = channelName.startsWith("#")
    ? channelName.slice(1)
    : channelName;

  if (normalizedName.startsWith("project-")) {
    const parts = normalizedName.replace("project-", "").split("-");
    if (parts.length >= 2) {
      return parts.slice(1).join("-");
    }
    return parts[0];
  }

  return null;
};

