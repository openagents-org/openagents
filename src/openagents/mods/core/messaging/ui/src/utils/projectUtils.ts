/**
 * 项目相关的工具函数
 */

/**
 * 检查频道是否为项目频道
 */
export const isProjectChannel = (channelName: string): boolean => {
  const normalizedName = channelName.startsWith("#") 
    ? channelName.slice(1) 
    : channelName;
  return normalizedName.startsWith("project-");
};

/**
 * 从项目频道名称中提取项目 ID
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

