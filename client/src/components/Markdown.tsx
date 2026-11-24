import { Fragment } from 'react';
import { RichText } from './RichText.tsx';

/**
 * A small, safe subset of Markdown for long owner-written pages (the privacy policy):
 *   # / ## / ### headings, paragraphs (a line ending in two spaces breaks the line),
 *   "- " bullet lists, and RichText's inline **bold**, `code`, and [links](…).
 * Anything else is plain text. It builds React elements, never HTML, so nothing in the
 * text can inject markup.
 */
export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; id: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] };

/** "## 13. Contact Us" → "13-contact-us", so a section can be linked (#13-contact-us). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownBlock | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, (spaces) => (spaces.length >= 2 ? '  ' : ''));
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (line.trim() === '') {
      flush();
    } else if (heading) {
      flush();
      const text = heading[2]!.trim();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text,
        id: headingId(text),
      });
    } else if (line.startsWith('- ')) {
      const block = current as MarkdownBlock | null;
      if (block?.kind !== 'list') {
        flush();
        current = { kind: 'list', items: [] };
      }
      (current as unknown as { items: string[] }).items.push(line.slice(2).trim());
    } else {
      const block = current as MarkdownBlock | null;
      if (block?.kind !== 'paragraph') {
        flush();
        current = { kind: 'paragraph', lines: [] };
      }
      (current as unknown as { lines: string[] }).lines.push(line);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseMarkdown(source).map((block, i) => {
        if (block.kind === 'heading') {
          const Tag = (['h1', 'h2', 'h3'] as const)[block.level - 1]!;
          return (
            <Tag key={i} id={block.id}>
              <RichText text={block.text} />
            </Tag>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                <RichText text={line.trimEnd()} />
                {j < block.lines.length - 1 && (line.endsWith('  ') ? <br /> : ' ')}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
