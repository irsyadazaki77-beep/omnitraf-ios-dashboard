import 'dotenv/config';
process.env.NODE_ENV = 'production';
await import('../server.js');
