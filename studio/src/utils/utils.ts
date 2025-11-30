import {
  GENERATE_RANDOM_NAME_NOUNS,
  GENERATE_RANDOM_NAME_ADJECTIVES,
} from "@/utils/const";

export const generateRandomAgentName = (): string => {
  const randomNum = Math.floor(Math.random() * 9999) + 1;

  const adjective =
    GENERATE_RANDOM_NAME_ADJECTIVES[
      Math.floor(Math.random() * GENERATE_RANDOM_NAME_ADJECTIVES.length)
    ];
  const noun =
    GENERATE_RANDOM_NAME_NOUNS[
      Math.floor(Math.random() * GENERATE_RANDOM_NAME_NOUNS.length)
    ];

  return `${adjective}${noun}${randomNum.toString().padStart(4, "0")}`;
};

export const isValidName = (name: string | null): boolean => {
  if (!name) return false;
  return (
    name.trim().length >= 3 &&
    name.trim().length <= 32 &&
    /^[a-zA-Z0-9_-]+$/.test(name.trim())
  );
};

export const getAvatarInitials = (name: string | null): string => {
  if (!name) return "";
  return name
    .replace(/[0-9]/g, "")
    .split(/(?=[A-Z])/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
};

/**
 * Safely parse date string, handling various possible format issues
 * @param dateString - Date string
 * @returns Date object, returns current time if parsing fails
 */
export const parseDate = (dateString: string): Date => {
  if (!dateString) return new Date();

  // Try direct parsing
  let date = new Date(dateString);

  // Check if it's a valid date
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date string: ${dateString}, using current time`);
    return new Date();
  }

  // Check for abnormally early dates (like 1970)
  const year = date.getFullYear();
  if (year < 1990 || year > 2100) {
    console.warn(
      `Suspicious date year: ${year} from ${dateString}, using current time`
    );
    return new Date();
  }

  return date;
};

/**
 * Format timestamp as relative time display (supports multiple timestamp formats)
 * @param timestamp - Timestamp (can be string or number, supports Unix timestamp, millisecond timestamp, ISO string, etc.)
 * @returns Formatted relative time string
 */
export const formatRelativeTimestamp = (timestamp: string | number): string => {
  try {
    let date: Date;
    const timestampStr = String(timestamp);

    // Handle different timestamp formats
    if (timestampStr.includes("T") || timestampStr.includes("-")) {
      // ISO string format (e.g., "2025-01-01T12:00:00.000Z")
      date = new Date(timestampStr);
    } else {
      // Unix timestamp (seconds or milliseconds)
      const timestampNum = parseInt(timestampStr);
      if (isNaN(timestampNum)) {
        console.warn("Invalid timestamp:", timestamp);
        return "Invalid time";
      }

      // Convert to milliseconds if it's in seconds (Unix timestamp < 1e10)
      const timestampMs =
        timestampNum < 1e10 ? timestampNum * 1000 : timestampNum;
      date = new Date(timestampMs);
    }

    // Validate the date
    if (isNaN(date.getTime())) {
      console.warn("Invalid date created from timestamp:", timestamp);
      return "Invalid time";
    }

    // Check if date is too old (before 2020) which might indicate wrong format
    if (date.getFullYear() < 2020) {
      console.warn(
        "Date seems too old, might be wrong format:",
        timestamp,
        date
      );
      // Try treating as milliseconds if it was treated as seconds
      const timestampNum = parseInt(timestampStr);
      if (!isNaN(timestampNum) && timestampNum > 1e10) {
        date = new Date(timestampNum);
      }
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    // If it's future time, show specific date
    if (diffMs < 0) {
      return date.toLocaleDateString();
    }

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  } catch (error) {
    console.error("Error formatting timestamp:", timestamp, error);
    return "Invalid time";
  }
};

/**
 * Format date as relative time display (simplified version for date strings)
 * @param dateString - Date string
 * @returns Formatted relative time string
 * @deprecated Recommend using formatRelativeTimestamp, more powerful
 */
export const formatRelativeDate = (dateString: string): string => {
  return formatRelativeTimestamp(dateString);
};

/**
 * Format timestamp as specific date time display
 * @param timestamp - Timestamp (seconds-level Unix timestamp)
 * @param options - Format options
 * @returns Formatted date time string
 */
export const formatDateTime = (timestamp: number, options?: {
  includeTime?: boolean;
  locale?: string;
}): string => {
  const { includeTime = true, locale = 'en-US' } = options || {};

  if (!timestamp || timestamp <= 0) {
    return 'Unknown date';
  }

  // Detect timestamp format: if 10 digits (seconds-level), convert to milliseconds
  let milliseconds = timestamp;
  if (timestamp < 10000000000) { // 10 digits means seconds-level timestamp
    milliseconds = timestamp * 1000;
  }

  const date = new Date(milliseconds);

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  if (includeTime) {
    return date.toLocaleString(locale);
  } else {
    return date.toLocaleDateString(locale);
  }
};
