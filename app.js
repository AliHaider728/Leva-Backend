'use strict';

require('dotenv/config');

const app = require('./dist/server.js');

const port = Number.parseInt(process.env.PORT || '5000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

app.listen(port, () => {
  console.log(`PlayBimboo API listening on port ${port}`);
});

module.exports = app;
