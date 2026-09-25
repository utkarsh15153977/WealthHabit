import { prisma } from '../src/config/prisma.js';
import { DEFAULT_CATEGORIES, seedDefaultCategories } from '../src/services/defaultCategoryService.js';

async function main(): Promise<void> {
  const { created, existing } = await seedDefaultCategories(prisma);

  console.log(`Default categories: ${created} created, ${existing} already present`);
  console.log(`Total default categories in catalog: ${DEFAULT_CATEGORIES.length}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
