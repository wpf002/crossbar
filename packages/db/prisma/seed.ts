import { prisma } from '../src/index.js';

async function main() {
  await prisma.sport.upsert({
    where: { id: 'mlb' },
    update: {},
    create: { id: 'mlb', name: 'Major League Baseball' },
  });
  await prisma.sport.upsert({
    where: { id: 'nfl' },
    update: {},
    create: { id: 'nfl', name: 'National Football League' },
  });
  await prisma.sport.upsert({
    where: { id: 'nba' },
    update: {},
    create: { id: 'nba', name: 'National Basketball Association' },
  });
  await prisma.sport.upsert({
    where: { id: 'nhl' },
    update: {},
    create: { id: 'nhl', name: 'National Hockey League' },
  });
  console.log('Seeded 4 sports.');
}

main().finally(() => prisma.$disconnect());
