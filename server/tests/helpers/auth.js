import request from 'supertest';
import { createUserWithPassword } from '../factories/index.js';

/** An origin from the CORS allow-list, so state-changing requests pass the CSRF check. */
export const TRUSTED_ORIGIN = process.env.CORS_ORIGINS.split(',')[0].trim();

/**
 * Creates a user and returns a Supertest agent logged in as them. An agent keeps cookies
 * between requests like a browser, so later calls carry the session cookie.
 *
 *   const { agent, user } = await loggedInAgent(app, { role: 'admin' });
 *   await agent.get('/api/v1/users');
 */
export async function loggedInAgent(app, overrides = {}) {
  const user = await createUserWithPassword(overrides);
  const agent = request.agent(app);

  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', TRUSTED_ORIGIN)
    .send({ email: user.email, password: user.password });
  if (res.status !== 200) {
    throw new Error(`loggedInAgent: login failed with ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { agent, user };
}
