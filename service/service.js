'use strict';

const Service = require('webos-service');
const pkg = require('./package.json');
const storage = require('./lib/storage');
const cleaner = require('./lib/clean');
const { createDeps } = require('./lib/deps');
const { createHandler } = require('./lib/handler');

const APP_ID = 'org.local.armazenamento';

const service = new Service(pkg.name);
const handle = createHandler({
  allowedSenders: [APP_ID],
  deps: createDeps(),
  storage,
  cleaner,
  log: (text) => console.error('[armazenamento] ' + text),
});

service.register('getOverview', (message) => handle('getOverview', message));
service.register('getUsage', (message) => handle('getUsage', message));
service.register('getCleanables', (message) => handle('getCleanables', message));
service.register('clean', (message) => handle('clean', message));
