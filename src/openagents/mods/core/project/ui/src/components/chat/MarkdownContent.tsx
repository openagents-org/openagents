import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow, coy } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useThemeStore } from "../../stores/themeStore";

interface MarkdownContentProps {
  content: string;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const { theme: currentTheme } = useThemeStore();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1
            className={`text-2xl font-bold mb-2 ${
              currentTheme === "dark" ? "text-gray-100" : "text-gray-900"
            }`}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            className={`text-xl font-semibold mb-2 ${
              currentTheme === "dark" ? "text-gray-100" : "text-gray-900"
            }`}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            className={`text-lg font-medium mb-2 ${
              currentTheme === "dark" ? "text-gray-200" : "text-gray-800"
            }`}
          >
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p
            className={`mb-2 ${
              currentTheme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {children}
          </p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline ${
              currentTheme === "dark"
                ? "text-blue-400 hover:text-blue-300"
                : "text-blue-600 hover:text-blue-800"
            }`}
          >
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt || "Image"}
            className="max-w-full h-auto rounded-lg my-2"
            style={{ maxHeight: "400px", objectFit: "cover" }}
          />
        ),
        code: ({ node, inline, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "text";

          if (!inline && match) {
            return (
              <SyntaxHighlighter
                style={currentTheme === "dark" ? tomorrow : coy}
                language={language}
                PreTag="div"
                className="rounded-md my-2"
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          }

          return (
            <code
              className={`px-1 py-0.5 rounded text-sm font-mono ${
                currentTheme === "dark"
                  ? "bg-gray-700 text-gray-200"
                  : "bg-gray-100 text-gray-800"
              }`}
              {...props}
            >
              {children}
            </code>
          );
        },
        blockquote: ({ children }) => (
          <blockquote
            className={`border-l-4 pl-4 my-2 italic ${
              currentTheme === "dark"
                ? "border-gray-600 text-gray-400"
                : "border-gray-300 text-gray-600"
            }`}
          >
            {children}
          </blockquote>
        ),
        ul: ({ children }) => (
          <ul
            className={`list-disc pl-6 mb-2 ${
              currentTheme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            className={`list-decimal pl-6 mb-2 ${
              currentTheme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="mb-1">{children}</li>,
        strong: ({ children }) => (
          <strong
            className={`font-semibold ${
              currentTheme === "dark" ? "text-gray-100" : "text-gray-900"
            }`}
          >
            {children}
          </strong>
        ),
        em: ({ children }) => (
          <em
            className={`italic ${
              currentTheme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {children}
          </em>
        ),
        hr: () => (
          <hr
            className={`my-4 ${
              currentTheme === "dark" ? "border-gray-600" : "border-gray-300"
            }`}
          />
        ),
        table: ({ children }) => (
          <table
            className={`w-full border-collapse mb-4 ${
              currentTheme === "dark" ? "border-gray-600" : "border-gray-300"
            }`}
          >
            {children}
          </table>
        ),
        th: ({ children }) => (
          <th
            className={`border p-2 font-semibold text-left ${
              currentTheme === "dark"
                ? "border-gray-600 bg-gray-800 text-gray-100"
                : "border-gray-300 bg-gray-100 text-gray-900"
            }`}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className={`border p-2 ${
              currentTheme === "dark"
                ? "border-gray-600 text-gray-300"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownContent;

