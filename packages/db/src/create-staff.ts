/**
 * Create a staff account, or reset its password with --reset.
 *   pnpm db:create-staff -- --email a@b.c --name "Name" --role RECEPTIONIST --branch <branch-slug>
 *   pnpm db:create-staff -- --email a@b.c --reset
 * Prints a one-time temporary password (shown once). The user must change it at next login.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createDb, Role } from './index';
import { generateTempPassword, hashPassword } from './password';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    branch: { type: 'string' },
    reset: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

async function main() {
  const email = values.email?.trim().toLowerCase();
  if (!email) throw new Error('--email is required');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, 'pg');
  const temp = generateTempPassword();
  const passwordHash = await hashPassword(temp);

  if (values.reset) {
    await db.staff.update({ where: { email }, data: { passwordHash, mustChangePassword: true } });
  } else {
    const role = values.role as keyof typeof Role | undefined;
    if (!values.name || !role || !(role in Role) || !values.branch) {
      throw new Error('--name, --role (OWNER|BRANCH_MANAGER|RECEPTIONIST|STYLIST) and --branch are required');
    }
    const branch = await db.branch.findUnique({ where: { slug: values.branch } });
    if (!branch) throw new Error(`No branch with slug "${values.branch}"`);
    await db.staff.create({
      data: {
        email,
        name: values.name,
        role: Role[role],
        homeBranchId: branch.id,
        passwordHash,
        mustChangePassword: true,
        bookable: role === 'STYLIST',
      },
    });
  }
  console.log(`Temporary password for ${email}: ${temp}`);
  console.log('Shown once. The user must change it at next login.');
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
