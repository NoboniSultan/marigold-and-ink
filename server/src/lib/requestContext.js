import { AsyncLocalStorage } from 'node:async_hooks';

// Holds per-request data (currently just the request ID) for the lifetime of a
// request, across every await, without passing `req` through services and repositories.
const storage = new AsyncLocalStorage();

export function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

export function getRequestContext() {
  return storage.getStore();
}
