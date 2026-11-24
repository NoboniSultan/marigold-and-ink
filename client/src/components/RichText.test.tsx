import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

  it('renders `code`, and same-site paths as in-app links (no new tab)', () => {
    render(
      <MemoryRouter>
        <p>
          <RichText text="Marked `HttpOnly`; see the [account page](/account)." />
        </p>
      </MemoryRouter>,
    );

    expect(screen.getByText('HttpOnly').tagName).toBe('CODE');
    const link = screen.getByRole('link', { name: 'account page' });
    expect(link).toHaveAttribute('href', '/account');
    expect(link).not.toHaveAttribute('target');
  });

  it('never treats //other-site as a same-site path', () => {
    const { container } = render(
      <p>
        <RichText text="[x](//evil.example)" />
      </p>,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders mailto links as plain email links', () => {
    render(
      <p>
        <RichText text="Write to [hello@noboni.art](mailto:hello@noboni.art)." />
      </p>,
    );
    const link = screen.getByRole('link', { name: 'hello@noboni.art' });
    expect(link).toHaveAttribute('href', 'mailto:hello@noboni.art');
    expect(link).not.toHaveAttribute('target');
  });
});
