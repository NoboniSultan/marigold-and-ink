import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The inline markup the owner's copy may use: **bold**, `code`, and [text](url) where the
 * URL is https:// (opens in a new tab), mailto:someone@example.com (an email link), or a
 * path on this site, like /giving (a normal in-app link). Anything else is plain text.
 */
const TOKEN =
  /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+|mailto:[^)\s@]+@[^)\s]+|\/(?![/\\])[^)\s]*)\)/g;

/**
 * Renders the owner's copy with its inline markup. It builds React elements (never raw
 * HTML), so the text can't inject markup, and only https, mailto, and same-site links
 * are recognised (no javascript: or other schemes, no //other-site).
 */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [, bold, code, label, href] = match;
    if (bold !== undefined) {
      // Bold text may hold a link or code of its own: **[Our page](/giving)**.
      parts.push(
        <strong key={match.index}>
          <RichText text={bold} />
        </strong>,
      );
    } else if (code !== undefined) {
      parts.push(<code key={match.index}>{code}</code>);
    } else if (href!.startsWith('mailto:')) {
      parts.push(
        <a key={match.index} href={href}>
          {label}
        </a>,
      );
    } else if (href!.startsWith('/')) {
      parts.push(
        <Link key={match.index} to={href!}>
          {label}
        </Link>,
      );
    } else {
      parts.push(
        <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
