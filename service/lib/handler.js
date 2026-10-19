'use strict';

// Camada entre o barramento Luna e a leitura do disco:
// só aceita o próprio app, executa um pedido por vez e não expõe detalhes internos de erro.

const { InputError } = require('./parse');

const MAX_PENDING = 3;

function errorResponse(err) {
  if (err instanceof InputError) return { returnValue: false, errorCode: 'BAD_INPUT', errorText: err.message };
  return { returnValue: false, errorCode: 'INTERNAL', errorText: 'Não foi possível ler o armazenamento.' };
}

function createHandler({ allowedSenders, deps, storage, cleaner, log = () => {}, maxPending = MAX_PENDING }) {
  const methods = {
    getOverview: () => storage.getOverview(deps),
    getUsage: (payload) => storage.getUsage(deps, payload),
  };
  if (cleaner) {
    methods.getCleanables = () => cleaner.getCleanables(deps);
    methods.clean = (payload) => cleaner.clean(deps, payload);
  }
  let queue = Promise.resolve();
  let pending = 0;

  return function handle(name, message) {
    if (!allowedSenders.includes(message.sender)) {
      message.respond({ returnValue: false, errorCode: 'FORBIDDEN', errorText: 'Chamador não autorizado.' });
      return Promise.resolve();
    }
    if (!Object.prototype.hasOwnProperty.call(methods, name)) {
      message.respond({ returnValue: false, errorCode: 'UNKNOWN_METHOD', errorText: 'Método desconhecido.' });
      return Promise.resolve();
    }
    if (pending >= maxPending) {
      message.respond({ returnValue: false, errorCode: 'BUSY', errorText: 'Ocupado, tente de novo.' });
      return Promise.resolve();
    }

    pending++;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    const job = queue.then(() => methods[name](payload));
    queue = job.catch(() => {});
    return job
      .then(
        (result) => message.respond(Object.assign({ returnValue: true }, result)),
        (err) => {
          if (!(err instanceof InputError)) log(name + ': ' + (err && err.message));
          message.respond(errorResponse(err));
        }
      )
      .finally(() => {
        pending--;
      });
  };
}

module.exports = { createHandler, errorResponse, MAX_PENDING };
