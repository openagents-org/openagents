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
 * 安全地解析日期字符串，处理各种可能的格式问题
 * @param dateString - 日期字符串
 * @returns Date 对象，如果解析失败返回当前时间
 */
export const parseDate = (dateString: string): Date => {
  if (!dateString) return new Date();

  // 尝试直接解析
  let date = new Date(dateString);

  // 检查是否是有效日期
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date string: ${dateString}, using current time`);
    return new Date();
  }

  // 检查是否是异常的早期日期（如1970年）
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
 * 格式化时间戳为相对时间显示（支持多种时间戳格式）
 * @param timestamp - 时间戳（可以是字符串或数字，支持Unix时间戳、毫秒时间戳、ISO字符串等）
 * @returns 格式化后的相对时间字符串
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
 * 格式化日期为相对时间显示（简化版本，用于日期字符串）
 * @param dateString - 日期字符串
 * @returns 格式化后的相对时间字符串
 * @deprecated 推荐使用 formatRelativeTimestamp，功能更强大
 */
export const formatRelativeDate = (dateString: string): string => {
  return formatRelativeTimestamp(dateString);
};
