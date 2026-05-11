var { argStr } = require('./registry');
var fs = require('fs');
var path = require('path');

function register(registry, mc) {
  registry.register({
    name: 'list_available_documents',
    description: 'List all available documentation files in Machbase Neo.',
    parameters: { type: 'object', properties: {} },
    fn: function (args, cb) {
      try {
        var neoDir = findNeoDir();
        if (!neoDir) return cb(null, 'Error: neo documentation directory not found');
        // Use pre-built catalog.md if available (scanDocs can cause Go panic in JSH)
        var catalogPath = path.join(neoDir, 'catalog.md');
        if (fs.existsSync(catalogPath)) {
          return cb(null, fs.readFileSync(catalogPath, 'utf8'));
        }
        cb(null, scanDocs(neoDir));
      } catch (e) { cb(null, 'Error: ' + e.message); }
    },
  });

  registry.register({
    name: 'get_full_document_content',
    description: 'Get the full content of a documentation file by its path from the catalog.',
    parameters: {
      type: 'object',
      properties: { file_identifier: { type: 'string', description: 'Document path from catalog' } },
      required: ['file_identifier'],
    },
    fn: function (args, cb) {
      var filePath = argStr(args, 'file_identifier', '');
      if (!filePath) return cb(null, 'Error: file_identifier is required');
      try {
        var neoDir = findNeoDir();
        if (!neoDir) return cb(null, 'Error: neo documentation directory not found');
        var content = fs.readFileSync(path.join(neoDir, filePath), 'utf8');
        if (content.length > 8000) content = content.substring(0, 8000) + '\n\n... (truncated, total ' + content.length + ' chars)';
        cb(null, content);
      } catch (e) { cb(null, 'Error: File not found: ' + filePath); }
    },
  });

  registry.register({
    name: 'get_document_sections',
    description: 'Get document content organized by sections (headers).',
    parameters: {
      type: 'object',
      properties: {
        file_identifier: { type: 'string' },
        section_filter: { type: 'string', description: 'Optional keyword to filter sections' },
      },
      required: ['file_identifier'],
    },
    fn: function (args, cb) {
      var filePath = argStr(args, 'file_identifier', '');
      var filter = argStr(args, 'section_filter', '').toLowerCase();
      if (!filePath) return cb(null, 'Error: file_identifier is required');
      try {
        var neoDir = findNeoDir();
        if (!neoDir) return cb(null, 'Error: neo documentation directory not found');
        var content = fs.readFileSync(path.join(neoDir, filePath), 'utf8');
        var sections = parseSections(content);
        if (filter) sections = sections.filter(function (s) { return s.title.toLowerCase().indexOf(filter) >= 0; });
        var out = '';
        for (var i = 0; i < sections.length; i++) out += '## ' + sections[i].title + '\n' + sections[i].content.substring(0, 500) + '\n\n';
        cb(null, out.trim() || 'No sections found.');
      } catch (e) { cb(null, 'Error: ' + e.message); }
    },
  });

  registry.register({
    name: 'extract_code_blocks',
    description: 'Extract code blocks from a documentation file.',
    parameters: {
      type: 'object',
      properties: {
        file_identifier: { type: 'string' },
        language: { type: 'string', description: 'Optional language filter (e.g., "sql", "tql")' },
      },
      required: ['file_identifier'],
    },
    fn: function (args, cb) {
      var filePath = argStr(args, 'file_identifier', '');
      var lang = argStr(args, 'language', '').toLowerCase();
      if (!filePath) return cb(null, 'Error: file_identifier is required');
      try {
        var neoDir = findNeoDir();
        if (!neoDir) return cb(null, 'Error: neo documentation directory not found');
        var content = fs.readFileSync(path.join(neoDir, filePath), 'utf8');
        var blocks = extractBlocks(content, lang);
        if (blocks.length === 0) return cb(null, 'No code blocks found.');
        var out = '';
        for (var i = 0; i < blocks.length; i++) out += '```' + blocks[i].lang + '\n' + blocks[i].code + '\n```\n\n';
        cb(null, out.trim());
      } catch (e) { cb(null, 'Error: ' + e.message); }
    },
  });
}

function findNeoDir() {
  var cwd = process.cwd();
  var candidates = [path.join(cwd, 'neo'), path.join(cwd, '..', 'neo'), 'neo'];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.statSync(candidates[i]).isDirectory()) return candidates[i]; } catch (e) { /* continue */ }
  }
  return null;
}

function scanDocs(baseDir, relParts) {
  var out = '';
  if (!relParts) relParts = [];
  try {
    var dirArgs = [baseDir].concat(relParts);
    var dirPath = path.join.apply(path, dirArgs);
    var entries = fs.readdirSync(dirPath);
    for (var i = 0; i < entries.length; i++) {
      var childParts = relParts.concat([entries[i]]);
      var fullArgs = [baseDir].concat(childParts);
      var full = path.join.apply(path, fullArgs);
      try {
        if (fs.statSync(full).isDirectory()) out += scanDocs(baseDir, childParts);
        else if (entries[i].endsWith('.md')) out += childParts.join('/') + '\n';
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return out;
}

function parseSections(content) {
  var lines = content.split('\n');
  var sections = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].match(/^#{1,3}\s/)) {
      if (current) sections.push(current);
      current = { title: lines[i].replace(/^#+\s*/, ''), content: '' };
    } else if (current) { current.content += lines[i] + '\n'; }
  }
  if (current) sections.push(current);
  return sections;
}

function extractBlocks(content, langFilter) {
  var blocks = [];
  var re = /```(\w*)\n([\s\S]*?)```/g;
  var match;
  while ((match = re.exec(content)) !== null) {
    var lang = match[1] || '';
    if (langFilter && lang.toLowerCase() !== langFilter) continue;
    blocks.push({ lang: lang, code: match[2].trim() });
  }
  return blocks;
}

module.exports = { register };
