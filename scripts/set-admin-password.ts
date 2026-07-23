import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@nexora.ng").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD missing in .env");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.update({
    where: { email },
    data: { passwordHash, role: "ADMIN" },
  });
  console.log(`Admin password updated for ${user.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
