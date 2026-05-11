function register(registry, mc) {
  registry.register({
    name: 'get_version',
    description: 'Get the version info of the neo-pkg-llm JSH server.',
    parameters: { type: 'object', properties: {} },
    fn: function (args, cb) {
      cb(null, JSON.stringify({ name: 'neo-pkg-llm-jsh', version: '1.0.0', runtime: 'JSH' }));
    },
  });

  registry.register({
    name: 'debug_mcp_status',
    description: 'Check connection status and available tools.',
    parameters: { type: 'object', properties: {} },
    fn: function (args, cb) {
      var tools = registry.toolNames();
      var status = { tools_count: tools.length, tools: tools, runtime: 'JSH' };
      mc.querySQL('SELECT 1', '', '', '', function (err) {
        status.machbase = err ? 'disconnected: ' + err.message : 'connected';
        cb(null, JSON.stringify(status, null, 2));
      });
    },
  });
}

module.exports = { register };
