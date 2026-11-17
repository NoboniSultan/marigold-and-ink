// Postgres SQLSTATE codes the services translate into domain errors.
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * True if `err` is a unique-constraint violation, optionally on a specific named constraint.
 * Lets a service rely on the database constraint (race-free) and translate the failure,
 * instead of doing a check-then-insert that two concurrent requests could both pass.
 */
export function isUniqueViolation(err, constraint) {
  return err?.code === PG_UNIQUE_VIOLATION && (!constraint || err.constraint === constraint);
}
