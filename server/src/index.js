const app = require('./app');
const config = require('./config');
const migrate = require('./migrate');

migrate().finally(() => {
  app.listen(config.port, () => {
    console.log(`LedgerSMS API listening on port ${config.port}`);
  });
});
