import { AppDataSource } from '../config/database';

AppDataSource.initialize()
  .then(() => {
    console.log('✅ Connected to Aiven DB successfully');
    process.exit(0);
  })
  .catch((e) => {
    console.error('❌ Connection failed:', e.message);
    process.exit(1);
  });
