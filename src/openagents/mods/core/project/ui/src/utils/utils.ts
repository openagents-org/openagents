import {
  GENERATE_RANDOM_NAME_NOUNS,
  GENERATE_RANDOM_NAME_ADJECTIVES,
} from "./const";

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

export const formatDateTime = (
  timestamp: number,
  options?: {
    includeTime?: boolean;
    locale?: string;
  }
): string => {
  const { includeTime = true, locale = "zh-CN" } = options || {};

  if (!timestamp || timestamp <= 0) {
    return "Unknown date";
  }

  let milliseconds = timestamp;
  if (timestamp < 10000000000) {
    milliseconds = timestamp * 1000;
  }

  const date = new Date(milliseconds);

  if (isNaN(date.getTime())) {
    return "Invalid date";
  }

  if (includeTime) {
    return date.toLocaleString(locale);
  } else {
    return date.toLocaleDateString(locale);
  }
};

