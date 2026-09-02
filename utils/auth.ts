/**
 * Authentication utilities: JWT session tokens, password hashing, and session resolution.
 * Used by API routes (getSessionFromRequest) and client (getSessionClient via /api/auth/session).
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User as PrismaUser } from "@prisma/client";
import Cookies from "js-cookie";
import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/prisma/client";

/** Secret for signing/verifying JWT. Production must provide JWT_SECRET explicitly. */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required to create or verify sessions");
  }
  return secret;
};

/** Session lifetime — password login + Google OAuth share the same JWT + cookie TTL. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day
export const SESSION_JWT_EXPIRES = "1d" as const;

type User = PrismaUser;

// Check if we're on the server side
const isServer = typeof window === "undefined";

/**
 * Cookie options for `session_id` — keep maxAge in sync with SESSION_JWT_EXPIRES.
 */
export function sessionCookieOptions(isSecure: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  };
}

/** Creates a signed JWT containing userId; used after login to set session cookie. */
export const generateToken = (userId: string): string => {
  if (!userId?.trim()) {
    throw new Error("A valid userId is required to create a session");
  }

  return jwt.sign({ userId }, getJwtSecret(), {
    expiresIn: SESSION_JWT_EXPIRES,
  });
};

/** Verifies JWT and returns decoded payload (userId); returns null if invalid or on client. */
export const verifyToken = (token: string): { userId: string } | null => {
  if (!token || token === "null" || token === "undefined") {
    return null;
  }

  // Only verify tokens on the server side
  if (!isServer) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.userId !== "string" ||
      !decoded.userId.trim()
    ) {
      return null;
    }

    return { userId: decoded.userId };
  } catch (error) {
    return null;
  }
};

/**
 * Get session from Pages API request
 * @deprecated Use getSessionFromRequest for App Router compatibility
 */
export const getSessionServer = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<User | null> => {
  const token = req.cookies["session_id"];
  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  return user;
};

/**
 * Get session from App Router NextRequest
 * Works with App Router route handlers
 */
export const getSessionFromRequest = async (request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): Promise<User | null> => {
  const cookie = request.cookies.get("session_id");
  const token = cookie?.value;

  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  return user;
};

/** Client-side: fetches /api/auth/session with cookies to get current user. */
export const getSessionClient = async (): Promise<User | null> => {
  try {
    const token = Cookies.get("session_id");
    if (!token) {
      return null;
    }

    const response = await fetch("/api/auth/session", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (response.ok) {
      const user = await response.json();
      return user;
    }

    return null;
  } catch (error) {
    return null;
  }
};

/** Hashes a plain password with bcrypt for safe storage (used on registration). */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/** Compares plain password with stored hash (used on login). */
export const comparePassword = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};
