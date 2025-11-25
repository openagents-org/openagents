import {
  GENERATE_RANDOM_NAME_ADJECTIVES,
  GENERATE_RANDOM_NAME_NOUNS,
} from './const';

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

  return `${adjective}${noun}${randomNum.toString().padStart(4, '0')}`;
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
  if (!name) return '';
  return name
    .replace(/[0-9]/g, '')
    .split(/(?=[A-Z])/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
};

export const parseDate = (dateString: string): Date => {
  if (!dateString) return new Date();

  let date = new Date(dateString);

  if (isNaN(date.getTime())) {
    console.warn(`Invalid date string: ${dateString}, using current time`);
    return new Date();
  }

  const year = date.getFullYear();
  if (year < 1990 || year > 2100) {
    console.warn(
      `Suspicious date year: ${year} from ${dateString}, using current time`
    );
    return new Date();
  }

  return date;
};

export const formatRelativeTimestamp = (timestamp: string | number): string => {
  try {
    let date: Date;
    const timestampStr = String(timestamp);

    if (timestampStr.includes('T') || timestampStr.includes('-')) {
      date = new Date(timestampStr);
    } else {
      const timestampNum = parseInt(timestampStr);
      if (isNaN(timestampNum)) {
        console.warn('Invalid timestamp:', timestamp);
        return 'Invalid time';
      }

      const timestampMs =
        timestampNum < 1e10 ? timestampNum * 1000 : timestampNum;
      date = new Date(timestampMs);
    }

    if (isNaN(date.getTime())) {
      console.warn('Invalid date created from timestamp:', timestamp);
      return 'Invalid time';
    }

    if (date.getFullYear() < 2020) {
      console.warn(
        'Date seems too old, might be wrong format:',
        timestamp,
        date
      );
      const timestampNum = parseInt(timestampStr);
      if (!isNaN(timestampNum) && timestampNum > 1e10) {
        date = new Date(timestampNum);
      }
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 0) {
      return date.toLocaleDateString();
    }

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  } catch (error) {
    console.error('Error formatting timestamp:', timestamp, error);
    return 'Invalid time';
  }
};

export const formatRelativeDate = (dateString: string): string => {
  return formatRelativeTimestamp(dateString);
};

export const formatDateTime = (
  timestamp: number,
  options?: {
    includeTime?: boolean;
    locale?: string;
  }
): string => {
  const { includeTime = true, locale = 'zh-CN' } = options || {};

  if (!timestamp || timestamp <= 0) {
    return 'Unknown date';
  }

  let milliseconds = timestamp;
  if (timestamp < 10000000000) {
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

