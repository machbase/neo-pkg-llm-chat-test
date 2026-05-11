// TQL content fixes: template expansion, line breaks, escaped newlines

var TQL_FUNC_RE = /\)[ \t]*(SQL_SELECT|SQL|SCRIPT|CHART_LINE|CHART_BAR3D|CHART|MAPVALUE|POPVALUE|MAPKEY|GROUPBYKEY|FFT|FLATTEN|PUSHKEY|CSV)\(/g;
var TEMPLATE_REF_RE = /TEMPLATE:\s*(\d+-\d+)/;
var TEMPLATE_TABLE_RE = /TABLE:\s*(\S+)/;
var TEMPLATE_TAG_RE = /(?:^|\s)TAG:\s*(\S+)/;
var TEMPLATE_TAG1_RE = /TAG1:\s*(\S+)/;
var TEMPLATE_TAG2_RE = /TAG2:\s*(\S+)/;
var TEMPLATE_UNIT_RE = /UNIT:\s*(\S+)/;
var TEMPLATE_ID_RE = /(\d+[-_]\d+)/;

// ExpandTemplateFunc callback - set by agent/templates.js
var expandTemplateFunc = null;

function setExpandTemplateFunc(fn) {
  expandTemplateFunc = fn;
}

function fixTQLContent(toolName, args, fctx) {
  if (toolName !== 'save_tql_file' && toolName !== 'execute_tql_script' && toolName !== 'validate_chart_tql') return;

  var contentKey = toolName === 'validate_chart_tql' ? 'tql_script' : 'tql_content';
  var content = args[contentKey];
  if (!content || typeof content !== 'string') return;

  // Case 1: TEMPLATE: reference in content
  var tmplMatch = TEMPLATE_REF_RE.exec(content);
  if (tmplMatch && expandTemplateFunc) {
    var params = extractTemplateParams(content, fctx);
    params.id = tmplMatch[1];
    try {
      var expanded = expandTemplateFunc(params.id, params);
      if (expanded) {
        args[contentKey] = expanded;
        console.println('  [fix] Template ' + params.id + ' expanded');
        return;
      }
    } catch (e) {
      console.println('  [fix] Template expansion failed: ' + e.message);
    }
  }

  // Case 2: Auto-detect template from filename
  if (toolName === 'save_tql_file' && expandTemplateFunc) {
    var filename = args.filename || '';
    var idMatch = TEMPLATE_ID_RE.exec(filename);
    if (idMatch) {
      var templateId = idMatch[1].replace('_', '-');
      var params2 = extractTemplateParams(content, fctx);
      try {
        var expanded2 = expandTemplateFunc(templateId, params2);
        if (expanded2) {
          args[contentKey] = expanded2;
          console.println('  [fix] Template ' + templateId + ' auto-expanded from filename');
          return;
        }
      } catch (e) { /* fallthrough */ }
    }
  }

  // Case 3: Fix line breaks between TQL functions
  var fixed = content.replace(TQL_FUNC_RE, ')\n$1(');
  if (fixed !== content) {
    args[contentKey] = fixed;
  }
}

function extractTemplateParams(content, fctx) {
  var params = {};

  var m;
  m = TEMPLATE_TABLE_RE.exec(content);
  if (m) params.TABLE = m[1];

  m = TEMPLATE_TAG_RE.exec(content);
  if (m) params.TAG = m[1].replace(/^['"]|['"]$/g, '');

  m = TEMPLATE_TAG1_RE.exec(content);
  if (m) params.TAG1 = m[1].replace(/^['"]|['"]$/g, '');

  m = TEMPLATE_TAG2_RE.exec(content);
  if (m) params.TAG2 = m[1].replace(/^['"]|['"]$/g, '');

  m = TEMPLATE_UNIT_RE.exec(content);
  if (m) {
    var unit = m[1].replace(/^['"]|['"]$/g, '');
    params.UNIT = "'" + unit + "'";
  }

  // Inject time range from fixer context
  if (fctx && fctx.timeStartDt) params.TIME_START = fctx.timeStartDt;
  if (fctx && fctx.timeEndDt) params.TIME_END = fctx.timeEndDt;

  return params;
}

function fixEscapedNewlines(args) {
  var keys = Object.keys(args);
  for (var i = 0; i < keys.length; i++) {
    var v = args[keys[i]];
    if (typeof v === 'string' && v.indexOf('\\n') >= 0) {
      args[keys[i]] = v.replace(/\\n/g, '\n');
    }
  }
}

module.exports = { fixTQLContent, fixEscapedNewlines, setExpandTemplateFunc, TEMPLATE_ID_RE };
