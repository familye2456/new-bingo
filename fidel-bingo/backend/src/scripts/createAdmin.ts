import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database';
import { User } from '../modules/user/domain/User';

async function createAdmin() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);

  const existing = await userRepo.findOne({
    where: [{ username: 'amouradmin' }, { email: 'admin@bingo.com' }],
  });

  if (existing) {
    console.log('Admin user already exists.');
    await AppDataSource.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash('0934942672', 12);

  const admin = userRepo.create({
    username: 'amouradmin',
    email: 'admin@bingo.com',
    passwordHash,
    role: 'admin',
    status: 'active',
    balance: 0,
    kycLevel: 0,
    mfaEnabled: false,
    loginAttempts: 0,
  });

  await userRepo.save(admin);
  console.log('Admin user created successfully.');
  await AppDataSource.destroy();
}

createAdmin().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
