import { ValidationError } from '../errors/index.js';

const PARTS = ['params', 'query', 'body'];

/**
 * Validates request parts against zod schemas and stores the parsed results on
 * `req.validated` ({ params, query, body }). Controllers read only `req.validated`,
 * so they always get trimmed, coerced, defaulted values with unknown fields stripped.
 *
 * (Express 5 makes `req.query` read-only, which is why results go on `req.validated`
 * rather than being written back onto the request.)
 *
 *   router.post('/', validate({ body: createSchema }), controller.create)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const issues = [];

    for (const part of PARTS) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location: part, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      throw new ValidationError('Request validation failed', { details: issues });
    }

    req.validated = { ...req.validated, ...validated };
    next();
  };
}
