const { createApp } = require('./lib/app');
const config = require('./lib/config');
if (require.main === module) {
  const app = createApp();
  const port = config.port;
  app.server.on('error', error => { app.store.close(); console.error(error.message); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => console.log(`Bonsai AI Platform v0.3.0 at http://127.0.0.1:${port}`));
  const stop = () => { app.runner.stop(); app.server.close(); setTimeout(() => { app.store.close(); process.exit(0); }, 1500).unref(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
module.exports = { createApp };
