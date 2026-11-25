/**
 * Give a user a staff role, change it, or remove staff access.
 *
 *   npm run admin:role -- person@example.com FINANCE_OFFICER
 *   npm run admin:role -- person@example.com NONE        (back to an ordinary customer)
 *   npm run admin:role                                   (list current staff)
 *
 * Takes effect on the person's next request. Every change is written to the audit log.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma-factory";
import { isStaffRole, permissionsOf, STAFF_ROLE_LABEL } from "../src/lib/permissions";

const prisma = createPrismaClient();
const [emailArg, roleArg] = process.argv.slice(2);

async function main() {
  if (!emailArg) {
    const staff = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { email: true, staffRole: true },
      orderBy: { email: "asc" },
    });
    for (const s of staff) console.log(`${s.email.padEnd(40)} ${s.staffRole ?? "(no role: view only)"}`);
    console.log(`\nRoles: ${Object.keys(STAFF_ROLE_LABEL).join(", ")}, NONE`);
    return;
  }

  const role = (roleArg ?? "").toUpperCase();
  if (role !== "NONE" && !isStaffRole(role)) {
    throw new Error(`Unknown role "${roleArg ?? ""}". Use one of: ${Object.keys(STAFF_ROLE_LABEL).join(", ")}, NONE`);
  }

  const email = emailArg.toLowerCase();
  const before = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, staffRole: true } });
  if (!before) throw new Error(`No user with email ${email}`);

  if (before.staffRole === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const others = await prisma.user.count({ where: { role: "ADMIN", staffRole: "SUPER_ADMIN", id: { not: before.id } } });
    if (others === 0) throw new Error("Refusing: this is the last Super Admin. Give someone else SUPER_ADMIN first.");
  }

  const data = role === "NONE" ? { role: "USER" as const, staffRole: null } : { role: "ADMIN" as const, staffRole: role };
  await prisma.$transaction([
    prisma.user.update({ where: { id: before.id }, data }),
    prisma.auditLog.create({
      data: {
        userId: before.id,
        action: "admin.staff_role_set",
        meta: JSON.stringify({ from: before.staffRole ?? null, to: data.staffRole, via: "scripts/set-staff-role" }),
      },
    }),
  ]);

  if (data.staffRole) {
    console.log(`${email} is now ${STAFF_ROLE_LABEL[data.staffRole]}.`);
    console.log(`Can: ${permissionsOf({ role: "ADMIN", staffRole: data.staffRole }).join(", ")}`);
  } else {
    console.log(`${email} no longer has staff access.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
