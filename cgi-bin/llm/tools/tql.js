var { argStr } = require('./registry');

function register(registry, mc) {
  // execute_tql_script
  registry.register({
    name: 'execute_tql_script',
    description: 'Execute a TQL (Transforming Query Language) script on Machbase Neo. Returns the execution result (chart HTML, CSV data, or error).',
    parameters: {
      type: 'object',
      properties: {
        tql_content: { type: 'string', description: 'TQL script content to execute' },
        timeout_seconds: { type: 'integer', description: 'Execution timeout in seconds (default: 30)', default: 30 },
      },
      required: ['tql_content'],
    },
    fn: function (args, cb) {
      var tql = argStr(args, 'tql_content', '');
      if (!tql) return cb(null, 'Error: tql_content is required');
      mc.executeTQL(tql, function (err, result) {
        if (err) return cb(null, 'Error: TQL execution failed: ' + err.message);
        if (!result || result.trim() === '') return cb(null, 'TQL executed successfully (no output).');
        if (result.length > 5000) {
          return cb(null, result.substring(0, 5000) + '\n... (truncated, total ' + result.length + ' chars)');
        }
        cb(null, result);
      });
    },
  });

  // save_tql_file
  registry.register({
    name: 'save_tql_file',
    description: 'Save a TQL script to a file in Machbase Neo filesystem.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File path (e.g., "GOLD/avg_trend.tql"). Must be English only.' },
        tql_content: { type: 'string', description: 'TQL script content or TEMPLATE reference' },
      },
      required: ['filename', 'tql_content'],
    },
    fn: function (args, cb) {
      var filename = argStr(args, 'filename', '');
      var tqlContent = argStr(args, 'tql_content', '');
      if (!filename) return cb(null, 'Error: filename is required');
      if (!tqlContent) return cb(null, 'Error: tql_content is required');
      if (!filename.toLowerCase().endsWith('.tql')) filename += '.tql';

      var slashIdx = filename.lastIndexOf('/');

      function afterFolder() {
        // Validate by executing
        mc.executeTQL(tqlContent, function (err, testResult) {
          if (err) return cb(null, 'Error: TQL validation failed: ' + err.message);
          if (testResult && testResult.toLowerCase().indexOf('error') === 0) {
            return cb(null, 'Error: TQL validation failed: ' + testResult);
          }
          // Save file
          mc.writeFile(filename, tqlContent, function (err2) {
            if (err2) return cb(null, 'Error: Failed to save file: ' + err2.message);
            cb(null, 'TQL file saved: ' + filename);
          });
        });
      }

      if (slashIdx > 0) {
        mc.createFolder(filename.substring(0, slashIdx), function () { afterFolder(); });
      } else {
        afterFolder();
      }
    },
  });
}

module.exports = { register };
