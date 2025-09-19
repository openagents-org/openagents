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
 * 格式化日期为相对时间显示
 * @param dateString - 日期字符串
 * @returns 格式化后的相对时间字符串
 */
export const formatRelativeDate = (dateString: string): string => {
  const date = parseDate(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // 如果是未来时间，显示具体日期
  if (diffMs < 0) {
    return date.toLocaleDateString();
  }

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  // const diffWeeks = Math.floor(diffDays / 7);
  // const diffMonths = Math.floor(diffDays / 30);
  // const diffYears = Math.floor(diffDays / 365);

  // 根据时间差返回不同格式
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  // if (diffWeeks < 4) return `${diffWeeks}w ago`;
  // if (diffMonths < 12) return `${diffMonths}mo ago`;
  // if (diffYears < 2) return `${diffYears}y ago`;

  // 超过2年显示具体日期
  return date.toLocaleDateString();
};
