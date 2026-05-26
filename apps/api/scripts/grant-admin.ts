import { prisma } from '@crossbar/db';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm --filter @crossbar/api admin:grant <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  if (user.isAdmin) {
    console.log(`User ${email} is already an admin.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  console.log(`Granted admin to ${email}.`);
  console.log('');
  console.log('Note: JWTs encode isAdmin at signing time. The user must log out');
  console.log('and back in for the admin UI/endpoints to recognize them.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
