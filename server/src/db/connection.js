/**
 * Builds the pg connection config from a database URL. Shared by the app's pool and the
 * migration runner so both connect the same way.
 *
 * TLS comes straight from the URL: with `sslmode=verify-full` (or `require`, which pg
 * treats the same), the connection is encrypted and the server's certificate and
 * hostname are verified.
 *
 * Channel binding is the one setting pg reads from the URL but does not act on, so we
 * translate it here. Channel binding (SCRAM-SHA-256-PLUS) ties the password login to this
 * specific TLS connection, so a machine in the middle can't relay it. Hosted providers
 * such as Neon put `channel_binding=require` in their connection strings. pg only uses it
 * when the server offers it, so it is harmless for local databases without TLS.
 */
export function buildConnectionConfig(databaseUrl) {
  const channelBinding = new URL(databaseUrl).searchParams.get('channel_binding');
  return {
    connectionString: databaseUrl,
    enableChannelBinding: channelBinding === 'require' || channelBinding === 'prefer',
  };
}
