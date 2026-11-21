import * as usersService from './users.service.ts';

/** requireAuth has already loaded the current user onto req.user. */
export function getMe(req, res) {
  res.json({ data: req.user });
}

export async function getById(req, res) {
  const user = await usersService.getById(req.validated.params.id);
  res.json({ data: user });
}

export async function list(req, res) {
  const { users, meta } = await usersService.listUsers(req.validated.query);
  res.json({ data: users, meta });
}
