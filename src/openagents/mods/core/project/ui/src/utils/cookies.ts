const MANUAL_CONNECTION_COOKIE_NAME = "openagents_manual_connection";
const OPENAGENTS_AGENT_NAMES = "openagents_agent_names";

export interface CookieOptions {
  expires?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export const setCookie = (
  name: string,
  value: string,
  options: CookieOptions = {}
): void => {
  const {
    expires = 30,
    path = "/",
    domain,
    secure = window.location.protocol === "https:",
    sameSite = "Lax",
  } = options;

  let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (expires) {
    const date = new Date();
    date.setTime(date.getTime() + expires * 24 * 60 * 60 * 1000);
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

export const getCookie = (name: string): string | null => {
  const nameEQ = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(";");

  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length));
    }
  }

  return null;
};

export const deleteCookie = (
  name: string,
  options: Pick<CookieOptions, "path" | "domain"> = {}
): void => {
  setCookie(name, "", { ...options, expires: -1 });
};

export const saveManualConnection = (host: string, port: string): void => {
  const connectionData = JSON.stringify({ host, port, timestamp: Date.now() });
  setCookie(MANUAL_CONNECTION_COOKIE_NAME, connectionData, { expires: 365 });
};

export const getSavedManualConnection = (): {
  host: string;
  port: string;
} | null => {
  try {
    const connectionData = getCookie(MANUAL_CONNECTION_COOKIE_NAME);
    if (!connectionData) return null;

    const parsed = JSON.parse(connectionData);
    if (parsed.host && parsed.port) {
      return { host: parsed.host, port: parsed.port };
    }
  } catch (error) {
    console.warn("Failed to parse saved manual connection:", error);
  }

  return null;
};

export const clearSavedManualConnection = (): void => {
  deleteCookie(MANUAL_CONNECTION_COOKIE_NAME);
};

const getNetworkKey = (host: string, port: string | number): string => {
  return `${host}:${port}`.toLowerCase();
};

export const saveAgentNameForNetwork = (
  host: string,
  port: string | number,
  agentName: string
): void => {
  try {
    const networkKey = getNetworkKey(host, port);
    const agentNamesData = getCookie(OPENAGENTS_AGENT_NAMES);

    let agentNames: Record<string, { name: string; timestamp: number }> = {};
    if (agentNamesData) {
      agentNames = JSON.parse(agentNamesData);
    }

    agentNames[networkKey] = {
      name: agentName,
      timestamp: Date.now(),
    };

    const entries = Object.entries(agentNames);
    if (entries.length > 10) {
      entries.sort(([, a], [, b]) => b.timestamp - a.timestamp);
      agentNames = Object.fromEntries(entries.slice(0, 10));
    }

    setCookie(OPENAGENTS_AGENT_NAMES, JSON.stringify(agentNames), {
      expires: 365,
    });
  } catch (error) {
    console.warn("Failed to save agent name for network:", error);
  }
};

export const getSavedAgentNameForNetwork = (
  host: string,
  port: string | number
): string | null => {
  try {
    const networkKey = getNetworkKey(host, port);
    const agentNamesData = getCookie(OPENAGENTS_AGENT_NAMES);

    if (!agentNamesData) return null;

    const agentNames = JSON.parse(agentNamesData);
    const networkData = agentNames[networkKey];

    if (networkData && networkData.name) {
      return networkData.name;
    }
  } catch (error) {
    console.warn("Failed to get saved agent name for network:", error);
  }

  return null;
};

export const clearAllOpenAgentsDataForLogout = (): void => {
  console.log("🚪 Starting logout data cleanup...");

  try {
    const threadData = localStorage.getItem("openagents_thread");
    console.log("📋 Thread data before cleanup:", threadData);
    localStorage.removeItem("openagents_thread");
    console.log("📋 Thread store cleared");

    localStorage.removeItem("openagents_chat_messages");
    localStorage.removeItem("openagents_conversations");
    localStorage.removeItem("openagents_view");
    localStorage.removeItem("openagents_network");

    const keys = Object.keys(localStorage);
    const clearedKeys: string[] = [];
    keys.forEach((key) => {
      if (key.startsWith("openagents_") && key !== "openagents_theme") {
        localStorage.removeItem(key);
        clearedKeys.push(key);
      }
    });

    if (clearedKeys.length > 0) {
      console.log("🧹 Additional keys cleared:", clearedKeys);
    }

    console.log(
      "✅ Thread data after cleanup:",
      localStorage.getItem("openagents_thread")
    );
  } catch (error) {
    console.warn("Failed to clear some localStorage data:", error);
  }

  console.log(
    "🚪 Cleared OpenAgents session data (theme + agent names + network connection preserved)"
  );
};

