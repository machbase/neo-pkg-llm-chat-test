'use strict';

// pkg run stop — JSH 서비스 중지.

var process = require('process');
var service = require('service');

var SERVICE_NAME = 'neo-pkg-llm';

console.println('stopping service:', SERVICE_NAME);
service.stop(SERVICE_NAME, function(err) {
  if (err) {
    console.println('WARN:', err.message);
  } else {
    console.println('service stopped.');
  }
});
