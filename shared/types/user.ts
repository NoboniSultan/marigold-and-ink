export type Role = 'client' | 'admin';

/** The logged-in user, as returned by register, login, and GET /users/me. */
export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}
