/**
 * Interview Hub Mode Configuration
 *
 * When REACT_APP_INTERVIEW_HUB_MODE=true, the Studio operates in a special mode
 * designed for the PeakMojo Interview Hub with a streamlined login experience.
 */

export interface InterviewHubConfig {
  enabled: boolean;
  host: string;
  port: number;
}

/**
 * Get Interview Hub configuration from environment variables
 */
export const getInterviewHubConfig = (): InterviewHubConfig => {
  const enabled = process.env.REACT_APP_INTERVIEW_HUB_MODE === 'true';
  const host = process.env.REACT_APP_INTERVIEW_HUB_HOST || 'localhost';
  const port = parseInt(process.env.REACT_APP_INTERVIEW_HUB_PORT || '8700', 10);

  return {
    enabled,
    host,
    port,
  };
};

/**
 * Check if Interview Hub mode is enabled
 */
export const isInterviewHubMode = (): boolean => {
  return process.env.REACT_APP_INTERVIEW_HUB_MODE === 'true';
};

/**
 * Generate agent name from user info
 * Format: firstname.lastname (spaces replaced with underscores)
 */
export const generateAgentNameFromUserInfo = (
  firstName: string,
  lastName: string
): string => {
  const first = firstName.trim().toLowerCase().replace(/\s+/g, '_');
  const last = lastName.trim().toLowerCase().replace(/\s+/g, '_');
  return `${first}.${last}`;
};
