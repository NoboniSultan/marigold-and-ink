import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Markdown, headingId, parseMarkdown } from './Markdown.tsx';

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, and lists, split by blank lines', () => {
    expect(
      parseMarkdown(
        '# Title\n\nFirst line  \nsecond line\njoined\n\n## 2. Next\n\n- one\n- **two**\n\n### A. Sub\nAfter',
      ),
    ).toEqual([
      { kind: 'heading', level: 1, text: 'Title', id: 'title' },
      { kind: 'paragraph', lines: ['First line  ', 'second line', 'joined'] },
      { kind: 'heading', level: 2, text: '2. Next', id: '2-next' },
      { kind: 'list', items: ['one', '**two**'] },
      { kind: 'heading', level: 3, text: 'A. Sub', id: 'a-sub' },
      { kind: 'paragraph', lines: ['After'] },
    ]);
  });

  it('makes linkable heading IDs', () => {
    expect(headingId('13. Contact Us')).toBe('13-contact-us');
    expect(headingId('What Happens When You Delete Your Account?')).toBe(
      'what-happens-when-you-delete-your-account',
    );
  });

  it('treats a list right after a paragraph, and a paragraph after a list, as new blocks', () => {
    expect(parseMarkdown('Intro:\n- a\nAfter')).toEqual([
      { kind: 'paragraph', lines: ['Intro:'] },
      { kind: 'list', items: ['a'] },
      { kind: 'paragraph', lines: ['After'] },
    ]);
  });
});

describe('Markdown', () => {
  it('renders the blocks as headings, paragraphs with line breaks, and lists', () => {
    const { container } = render(
      <MemoryRouter>
        <Markdown
          source={'# Policy\n\n**Effective:** today  \n**Updated:** today\n\n- [Home](/)\n- plain'}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Policy' })).toHaveAttribute(
      'id',
      'policy',
    );
    expect(container.querySelector('p br')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('never renders raw HTML from the text', () => {
    const { container } = render(<Markdown source={'<script>alert(1)</script> <b>bold</b>'} />);
    expect(container.querySelector('script, b')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });
});
