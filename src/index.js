import { startServer } from './app/server.js';

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
