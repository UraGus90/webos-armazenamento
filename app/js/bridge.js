// Chamada ao serviço local pelo barramento Luna (PalmServiceBridge, presente em apps web do webOS).
(function (root) {
  'use strict';

  var SERVICE_URI = 'luna://org.local.armazenamento.service/';

  function call(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof root.PalmServiceBridge !== 'function') {
        if (typeof root.__mockService === 'function') return root.__mockService(method, params).then(resolve, reject);
        return reject(new Error('Serviço da TV indisponível.'));
      }
      var bridge = new root.PalmServiceBridge();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { bridge.cancel(); } catch (e) { /* já encerrada */ }
        reject(new Error('A TV demorou demais para responder.'));
      }, timeoutMs || 60000);

      bridge.onservicecallback = function (text) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var response;
        try {
          response = JSON.parse(text);
        } catch (e) {
          return reject(new Error('Resposta inválida do serviço.'));
        }
        if (response && response.returnValue === true) resolve(response);
        else reject(new Error((response && response.errorText) || 'Erro no serviço.'));
      };
      bridge.call(SERVICE_URI + method, JSON.stringify(params || {}));
    });
  }

  root.Bridge = { call: call };
})(this);
