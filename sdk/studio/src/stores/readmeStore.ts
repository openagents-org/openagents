import { create } from "zustand";

export interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

interface ReadmeState {
  content: string;
  headings: HeadingItem[];
  setContent: (content: string) => void;
  clearContent: () => void;
}

/**
 * Extract headings from markdown content
 */
const extractHeadings = (markdown: string): HeadingItem[] => {
  const headings: HeadingItem[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      // Create a URL-friendly ID from the heading text
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      headings.push({ level, text, id });
    }
  }

  return headings;
};

export const useReadmeStore = create<ReadmeState>()((set) => ({
  content: "",
  headings: [],
  setContent: (content: string) =>
    set({
      content,
      headings: extractHeadings(content),
    }),
  clearContent: () =>
    set({
      content: "",
      headings: [],
    }),
}));
