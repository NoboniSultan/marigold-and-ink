import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from './RichText.tsx';

describe('RichText', () => {
  it('renders **bold** and [links](https://…), leaving the rest as text', () => {
    const { container } = render(
      <p>
        <RichText text="Plant with **Digital Humani**, see [their site](https://www.digitalhumani.com/)." />
      </p>,
    );

    expect(screen.getByText('Digital Humani').tagName).toBe('STRONG');
    const link = screen.getByRole('link', { name: 'their site' });
    expect(link).toHaveAttribute('href', 'https://www.digitalhumani.com/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.textContent).toBe('Plant with Digital Humani, see their site.');
  });

  it('never turns other link schemes or raw HTML into elements', () => {
    const { container } = render(
      <p>
        <RichText text="[x](javascript:alert(1)) <b>hi</b>" />
      </p>,
    );
    expect(container.querySelector('a, b')).toBeNull();
    expect(container.textContent).toBe('[x](javascript:alert(1)) <b>hi</b>');
  });
});
