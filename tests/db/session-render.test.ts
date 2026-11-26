import { describe, expect, it, vi } from "vitest";

// A page render: the cookie can be read but not changed, as in a Next.js Server Component.
const jar = {
  value: undefined as string | undefined,
  get: () => (jar.value ? { name: "nexora_session", value: jar.value } : undefined),
  set: () => {
    throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
  },
  delete: () => {
    throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
  },
};
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { prisma } from "@/lib/db";
import { createSession, getSessionUser } from "@/lib/auth";
import { makeCustomer } from "../helpers/fixtures";

describe("reading the session while a page renders", () => {
  it("treats a revoked session as signed out instead of crashing the page", async () => {
    const c = await makeCustomer();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
    const token = await createSession({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role }, { setCookie: false });

    jar.value = token;
    expect((await getSessionUser())?.id).toBe(u.id);

    // Revoked elsewhere (signed out on another device, password changed...).
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("treats a forged or garbled cookie as signed out", async () => {
    jar.value = "not-a-real-token";
    await expect(getSessionUser()).resolves.toBeNull();
  });
});
