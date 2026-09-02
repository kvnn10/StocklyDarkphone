import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken, verifyToken } from "@/utils/auth";

describe("JWT session security", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-secret-for-session-security");
  });

  it("fails closed when JWT_SECRET is missing", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(() => generateToken("user-1")).toThrow("JWT_SECRET is required");
    expect(verifyToken("not-a-token")).toBeNull();
  });

  it("rejects invalid and malformed tokens", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiIifQ.")).toBeNull();
  });

  it("round-trips a valid user session", () => {
    const token = generateToken("user-123");
    expect(verifyToken(token)).toEqual({ userId: "user-123" });
  });
});
