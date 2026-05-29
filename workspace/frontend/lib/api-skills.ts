// ---------------------------------------------------------------------------
// SkillHub API Client
// ---------------------------------------------------------------------------

export interface LocalSkill {
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryIcon: string;
  exists: boolean;
}

export interface OnlineSkill {
  slug: string;
  name: string;
  description: string;
  descriptionZh?: string;
  category: string;
  ownerName: string;
  downloads: number;
  stars: number;
  installs: number;
  score: number;
  tags: string[];
  iconUrl?: string;
  version?: string;
}

export interface SkillCategory {
  key: string;
  name: string;
  nameEn: string;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

export async function fetchLocalSkills(): Promise<LocalSkill[]> {
  const res = await fetch('/api/skills/local');
  if (!res.ok) throw new Error('Failed to fetch local skills');
  const data = await res.json();
  return data.skills || [];
}

export async function searchOnlineSkills(query: string, limit: number = 20): Promise<OnlineSkill[]> {
  if (!query.trim()) return [];
  const res = await fetch(`/api/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to search online skills');
  const data = await res.json();
  // API may return { items: [...] } or direct array
  return data.items || data.skills || data || [];
}

export async function fetchTopSkills(): Promise<OnlineSkill[]> {
  const res = await fetch('/api/skills/top');
  if (!res.ok) throw new Error('Failed to fetch top skills');
  const data = await res.json();
  // API may return { skills: [...] } or direct array
  return data.skills || data || [];
}

export async function fetchCategories(): Promise<SkillCategory[]> {
  const res = await fetch('/api/skills/categories');
  if (!res.ok) throw new Error('Failed to fetch categories');
  const data = await res.json();
  return data.categories || data || [];
}
