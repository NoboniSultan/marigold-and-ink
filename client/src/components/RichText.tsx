import { Fragment, type ReactNode } from 'react';

// **bold**, or [text](https://…). Anything else is plain text.
const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

/**
 * Renders the owner's copy with its two kinds of inline markup. It builds React elements
 * (never raw HTML), so the text can't inject markup, and only https links are recognised.
 */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [, bold, label, href] = match;
    parts.push(
      bold !== undefined ? (
        <strong key={match.index}>{bold}</strong>
      ) : (
        <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
