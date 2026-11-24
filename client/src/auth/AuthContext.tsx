/**
 * Who is logged in, for the whole app. The session lives in an httpOnly cookie that
 * JavaScript can't read, so "am I logged in?" is answered by GET /auth/session, cached by
 * TanStack Query under queryKeys.me. Login, sign-up, and logout update that cache entry,
 * so every component using useAuth() re-renders at once.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  LoginRequest,
  PasswordResetCompleteRequest,
  SignupCompleteRequest,
  User,
} from '@shared/types/user.ts';
import { authApi } from '../api/endpoints.ts';
import { queryKeys, useMe } from '../api/queries.ts';

interface AuthValue {
  user: User | null;
  /** True until the first /auth/session answer arrives. */
  isLoading: boolean;
  login: (body: LoginRequest) => Promise<User>;
  /** Sign-up step 2 (step 1, sending the code, needs no auth state: authApi.signupStart). */
  completeSignup: (body: SignupCompleteRequest) => Promise<User>;
  /** Forgot password step 2: sets the new password and signs this browser in. */
  completePasswordReset: (body: PasswordResetCompleteRequest) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useMe();

  const value = useMemo<AuthValue>(() => {
    const signedIn = (user: User) => {
      queryClient.setQueryData(queryKeys.me, user);
      return user;
    };
    return {
      user: me.data ?? null,
      isLoading: me.isPending,
      login: async (body) => signedIn(await authApi.login(body)),
      completeSignup: async (body) => signedIn(await authApi.signupComplete(body)),
      completePasswordReset: async (body) => signedIn(await authApi.passwordResetComplete(body)),
      logout: async () => {
        await authApi.logout();
        queryClient.setQueryData(queryKeys.me, null);
      },
    };
  }, [me.data, me.isPending, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
