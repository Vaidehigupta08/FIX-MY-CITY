"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AppUser, Profile, Role } from "@/lib/types";
import {
  createLocalUser,
  findLocalUser,
  loginLocalUser,
  normalizeEmail,
  sanitizeUser,
  updateLocalUserProfile,
  upsertLocalUserRecord,
} from "@/lib/client-persistence";

export type User = AppUser | null;

type LoginInput = {
  email: string;
  password: string;
  role: Role;
};

type SignupInput = {
  name: string;
  email: string;
  password: string;
};

type LegacyStoredUser = {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  profile: Profile;
};

type AuthContextType = {
  user: User;
  profile: Profile;
  isLoading: boolean;
  updateProfile: (data: NonNullable<Profile>) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => void;
};

const LEGACY_USERS_STORAGE_KEY = "fmc_users";
const SESSION_STORAGE_KEY = "fmc_session_user";
const LEGACY_MIGRATION_KEY = "fmc_db_migrated";
const AUTH_COOKIE_KEY = "fmc_auth";
const ROLE_COOKIE_KEY = "fmc_role";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function persistSession(nextUser: NonNullable<User>) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextUser));
  document.cookie = `${AUTH_COOKIE_KEY}=1; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  document.cookie = `${ROLE_COOKIE_KEY}=${nextUser.role}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  document.cookie = `${AUTH_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${ROLE_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

function readLegacyUsers(): LegacyStoredUser[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LEGACY_USERS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function parseJsonResponse(response: Response) {
  const data = await response.json();

  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || "Request failed.");
  }

  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const migrateLegacyUsers = async () => {
      if (typeof window === "undefined") return;

      const alreadyMigrated = window.localStorage.getItem(LEGACY_MIGRATION_KEY) === "1";
      const legacyUsers = readLegacyUsers();

      if (alreadyMigrated || legacyUsers.length === 0) {
        return;
      }

      try {
        await fetch("/api/auth/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ users: legacyUsers }),
        });
        window.localStorage.setItem(LEGACY_MIGRATION_KEY, "1");
      } catch {
        // Ignore migration failures and continue with existing session behavior.
      }
    };

    const bootstrapAuth = async () => {
      if (typeof window === "undefined") return;

      await migrateLegacyUsers();

      let nextUser: User = null;
      let nextProfile: Profile = null;

      try {
        const savedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);

        if (savedSession) {
          const parsedSession = JSON.parse(savedSession) as NonNullable<User>;
          const response = await fetch(
            `/api/profile?email=${encodeURIComponent(normalizeEmail(parsedSession.email))}`,
            { cache: "no-store" },
          );

          if (response.ok) {
            const data = await response.json();
            nextUser = data.user ?? null;
            nextProfile = data.profile ?? null;
            if (nextUser) {
              upsertLocalUserRecord(nextUser, nextProfile);
            }
          } else {
            const localUser = findLocalUser(parsedSession.email);
            if (localUser) {
              nextUser = sanitizeUser(localUser);
              nextProfile = localUser.profile;
            } else {
              clearSession();
            }
          }
        }
      } catch {
        const savedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
        const parsedSession = savedSession ? (JSON.parse(savedSession) as NonNullable<User>) : null;
        const localUser = parsedSession ? findLocalUser(parsedSession.email) : null;

        if (localUser) {
          nextUser = sanitizeUser(localUser);
          nextProfile = localUser.profile;
        } else {
          clearSession();
        }
      }

      if (!active) return;

      setUser(nextUser);
      setProfile(nextProfile);
      setIsLoading(false);
    };

    bootstrapAuth();

    return () => {
      active = false;
    };
  }, []);

  const updateProfile = async (data: NonNullable<Profile>) => {
    if (!user) return;

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          profile: data,
        }),
      });

      const parsed = await parseJsonResponse(response);
      setUser(parsed.user ?? user);
      setProfile(parsed.profile ?? data);
      upsertLocalUserRecord(parsed.user ?? user, parsed.profile ?? data);
    } catch {
      const updatedUser = updateLocalUserProfile(user.email, data);
      setUser(sanitizeUser(updatedUser));
      setProfile(updatedUser.profile);
    }
  };

  const login = async ({ email, password, role }: LoginInput) => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizeEmail(email),
          password,
          role,
        }),
      });

      const parsed = await parseJsonResponse(response);
      const nextUser = parsed.user as NonNullable<User>;

      persistSession(nextUser);
      setUser(nextUser);
      setProfile(parsed.profile ?? null);
      upsertLocalUserRecord(nextUser, parsed.profile ?? null);
    } catch {
      const localUser = await loginLocalUser({ email, password, role });
      const nextUser = sanitizeUser(localUser);
      persistSession(nextUser);
      setUser(nextUser);
      setProfile(localUser.profile);
    }
  };

  const signup = async ({ name, email, password }: SignupInput) => {
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: normalizeEmail(email),
          password,
        }),
      });

      const parsed = await parseJsonResponse(response);
      const nextUser = parsed.user as NonNullable<User>;

      persistSession(nextUser);
      setUser(nextUser);
      setProfile(parsed.profile ?? null);
      upsertLocalUserRecord(nextUser, parsed.profile ?? null);
    } catch {
      const localUser = await createLocalUser({ name, email, password });
      const nextUser = sanitizeUser(localUser);
      persistSession(nextUser);
      setUser(nextUser);
      setProfile(localUser.profile);
    }
  };

  const logout = () => {
    if (typeof window !== "undefined") {
      clearSession();
    }

    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, isLoading, updateProfile, login, signup, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
