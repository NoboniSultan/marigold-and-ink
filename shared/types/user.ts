export type Role = 'client' | 'admin';

/** The logged-in user, as returned by register, login, and GET /users/me. */
export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  /** When the email was proven (sign-up code or Google); null only for old accounts. */
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** Sign-up step 1: where to send the code. */
export interface SignupStartRequest {
  email: string;
}

export interface SignupStartResponse {
  email: string;
  /** How long until another code can be requested. */
  resendAfterSeconds: number;
}

/** Sign-up step 2: the emailed code plus the new account's details. */
export interface SignupCompleteRequest {
  email: string;
  code: string;
  password: string;
  displayName: string;
}

/** Which sign-in methods are switched on (GET /auth/providers). */
export interface AuthProviders {
  google: boolean;
  emailSignup: boolean;
}

/** GET /users/me: the signed-in user plus their sign-in methods, for the account page. */
export interface Account extends User {
  /** False for accounts that only sign in with Google (no password to change). */
  hasPassword: boolean;
  hasGoogle: boolean;
}

/** PATCH /users/me */
export interface UpdateProfileRequest {
  displayName: string;
}

/** POST /users/me/password. Signs out every other session. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * DELETE /users/me. Accounts with a password confirm with it; Google-only accounts type
 * their email address instead.
 */
export interface DeleteAccountRequest {
  password?: string;
  confirmEmail?: string;
}

/** Forgot password, step 1: where to send the code (the answer is the same for any address). */
export interface PasswordResetStartRequest {
  email: string;
}

/** Forgot password, step 2: the emailed code and the new password; signs in on success. */
export interface PasswordResetCompleteRequest {
  email: string;
  code: string;
  newPassword: string;
}

/** Email change, step 1: the new address, and the password if the account has one. */
export interface ChangeEmailStartRequest {
  newEmail: string;
  password?: string;
}

/** Email change, step 2: the code sent to the new address. */
export interface ChangeEmailConfirmRequest {
  newEmail: string;
  code: string;
}
