import { describe, it, expect } from 'vitest';
import { buildConnectionConfig } from '../connection.js';

const NEON_STYLE = 'postgresql://user:secret@ep-example-123.us-west-2.aws.neon.tech/neondb';

describe('buildConnectionConfig', () => {
  it('passes the URL through so pg applies its TLS settings', () => {
    const url = `${NEON_STYLE}?sslmode=verify-full`;

    expect(buildConnectionConfig(url)).toEqual({
      connectionString: url,
      enableChannelBinding: false,
    });
  });

  it.each(['require', 'prefer'])('enables channel binding for channel_binding=%s', (mode) => {
    const config = buildConnectionConfig(
      `${NEON_STYLE}?sslmode=verify-full&channel_binding=${mode}`,
    );

    expect(config.enableChannelBinding).toBe(true);
  });

  it('leaves channel binding off when disabled or absent (e.g. local Docker Postgres)', () => {
    expect(
      buildConnectionConfig(`${NEON_STYLE}?channel_binding=disable`).enableChannelBinding,
    ).toBe(false);
    expect(
      buildConnectionConfig('postgres://marigold:marigold@localhost:5434/marigold_dev')
        .enableChannelBinding,
    ).toBe(false);
  });
});
