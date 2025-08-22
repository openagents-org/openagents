/**
 * Cookie utility functions for storing and retrieving data
 */

export interface CookieOptions {
  expires?: number; // Days until expiration
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Set a cookie with the given name and value
 */
export const setCookie = (name: string, value: string, options: CookieOptions = {}): void => {
  const {
    expires = 30, // Default to 30 days
    path = '/',
    domain,
    secure = window.location.protocol === 'https:',
    sameSite = 'Lax'
  } = options;

  let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (expires) {
    const date = new Date();
    date.setTime(date.getTime() + (expires * 24 * 60 * 60 * 1000));
    cookieString += `; expires=${date.toUTCString()}`;
  }

  if (path) {
    cookieString += `; path=${path}`;
  }

  if (domain) {
    cookieString += `; domain=${domain}`;
  }

  if (secure) {
    cookieString += `; secure`;
  }

  if (sameSite) {
    cookieString += `; samesite=${sameSite}`;
  }

  document.cookie = cookieString;
};

/**
 * Get a cookie value by name
 */
export const getCookie = (name: string): string | null => {
  const nameEQ = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(';');

  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length));
    }
  }

  return null;
};

/**
 * Delete a cookie by name
 */
export const deleteCookie = (name: string, options: Pick<CookieOptions, 'path' | 'domain'> = {}): void => {
  setCookie(name, '', { ...options, expires: -1 });
};

/**
 * Check if cookies are enabled in the browser
 */
export const areCookiesEnabled = (): boolean => {
  try {
    const testCookie = '__test_cookie__';
    setCookie(testCookie, 'test', { expires: 1 });
    const hasTestCookie = getCookie(testCookie) === 'test';
    if (hasTestCookie) {
      deleteCookie(testCookie);
    }
    return hasTestCookie;
  } catch {
    return false;
  }
};

/**
 * Store manual connection details
 */
export const saveManualConnection = (host: string, port: string): void => {
  const connectionData = JSON.stringify({ host, port, timestamp: Date.now() });
  setCookie('openagents_manual_connection', connectionData, { expires: 365 }); // 1 year
};

/**
 * Get saved manual connection details
 */
export const getSavedManualConnection = (): { host: string; port: string } | null => {
  try {
    const connectionData = getCookie('openagents_manual_connection');
    if (!connectionData) return null;

    const parsed = JSON.parse(connectionData);
    if (parsed.host && parsed.port) {
      return { host: parsed.host, port: parsed.port };
    }
  } catch (error) {
    console.warn('Failed to parse saved manual connection:', error);
  }

  return null;
};

/**
 * Clear saved manual connection
 */
export const clearSavedManualConnection = (): void => {
  deleteCookie('openagents_manual_connection');
};

/**
 * Generate a network key for caching agent names
 */
const getNetworkKey = (host: string, port: string | number): string => {
  return `${host}:${port}`.toLowerCase();
};

/**
 * Store agent name for a specific network
 */
export const saveAgentNameForNetwork = (host: string, port: string | number, agentName: string): void => {
  try {
    const networkKey = getNetworkKey(host, port);
    const agentNamesData = getCookie('openagents_agent_names');
    
    let agentNames: Record<string, { name: string; timestamp: number }> = {};
    if (agentNamesData) {
      agentNames = JSON.parse(agentNamesData);
    }
    
    agentNames[networkKey] = {
      name: agentName,
      timestamp: Date.now()
    };
    
    // Keep only the last 10 networks to prevent cookie bloat
    const entries = Object.entries(agentNames);
    if (entries.length > 10) {
      entries.sort(([, a], [, b]) => b.timestamp - a.timestamp);
      agentNames = Object.fromEntries(entries.slice(0, 10));
    }
    
    setCookie('openagents_agent_names', JSON.stringify(agentNames), { expires: 365 });
  } catch (error) {
    console.warn('Failed to save agent name for network:', error);
  }
};

/**
 * Get saved agent name for a specific network
 */
export const getSavedAgentNameForNetwork = (host: string, port: string | number): string | null => {
  try {
    const networkKey = getNetworkKey(host, port);
    const agentNamesData = getCookie('openagents_agent_names');
    
    if (!agentNamesData) return null;
    
    const agentNames = JSON.parse(agentNamesData);
    const networkData = agentNames[networkKey];
    
    if (networkData && networkData.name) {
      return networkData.name;
    }
  } catch (error) {
    console.warn('Failed to get saved agent name for network:', error);
  }
  
  return null;
};

/**
 * Get all saved agent names with their networks
 */
export const getAllSavedAgentNames = (): Record<string, { name: string; timestamp: number }> => {
  try {
    const agentNamesData = getCookie('openagents_agent_names');
    if (agentNamesData) {
      return JSON.parse(agentNamesData);
    }
  } catch (error) {
    console.warn('Failed to get all saved agent names:', error);
  }
  
  return {};
};

/**
 * Clear saved agent name for a specific network
 */
export const clearSavedAgentNameForNetwork = (host: string, port: string | number): void => {
  try {
    const networkKey = getNetworkKey(host, port);
    const agentNamesData = getCookie('openagents_agent_names');
    
    if (!agentNamesData) return;
    
    const agentNames = JSON.parse(agentNamesData);
    delete agentNames[networkKey];
    
    if (Object.keys(agentNames).length === 0) {
      deleteCookie('openagents_agent_names');
    } else {
      setCookie('openagents_agent_names', JSON.stringify(agentNames), { expires: 365 });
    }
  } catch (error) {
    console.warn('Failed to clear saved agent name for network:', error);
  }
};

/**
 * Clear all saved agent names
 */
export const clearAllSavedAgentNames = (): void => {
  deleteCookie('openagents_agent_names');
};
