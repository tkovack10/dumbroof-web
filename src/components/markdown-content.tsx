"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Safe markdown renderer for AI / chat content. Replaces the per-component
 * `renderMarkdown` + `dangerouslySetInnerHTML` pattern with react-markdown,
 * which auto-escapes HTML at parse time (no XSS surface even on
 * adversarial model output).
 *
 * Styling matches the prior Tailwind classes so the chat panels look
 * identical to before. Adjust `components` overrides below if a future
 * surface needs a different look.
 */

interface MarkdownContentProps {
  content: string;
  size?: "sm" | "base";
}

export function MarkdownContent({ content, size = "sm" }: MarkdownContentProps) {
  if (!content) return null;

  const textSize = size === "sm" ? "text-sm" : "text-base";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className={`${textSize} my-1`}>{children}</p>,
        h2: ({ children }) => (
          <h2 className="text-sm font-bold text-indigo-300 mt-3 mb-1">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-bold text-indigo-400 mt-3 mb-1">{children}</h3>
        ),
        strong: ({ children }) => <strong className="text-white">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        code: ({ children }) => (
          <code className="bg-white/10 px-1 rounded text-xs">{children}</code>
        ),
        ul: ({ children }) => (
          <ul className="list-disc space-y-0.5 my-1 ml-4">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal space-y-0.5 my-1 ml-4">{children}</ol>
        ),
        li: ({ children }) => <li className={textSize}>{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-300 underline hover:text-indigo-200"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="text-xs border border-white/10">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="bg-white/5 px-2 py-1 text-left text-indigo-300 border border-white/10">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-2 py-1 border border-white/10">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
