var fs = require('fs');
var path = require('path');

var reportTmplDir = '';

// Find report template directory
(function init() {
  var cwd = process.cwd();
  var candidates = [
    path.join(cwd, 'neo', 'report'),
    path.join(cwd, '..', 'neo', 'report'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var stat = fs.statSync(candidates[i]);
      if (stat.isDirectory()) {
        reportTmplDir = candidates[i];
        console.println('[ReportTemplates] Found dir: ' + reportTmplDir);
        break;
      }
    } catch (e) { /* continue */ }
  }
})();

var REPORT_TEMPLATE_RE = /(?:^|\n)###\s*(R-\d+)\.[^\n]*\n[\s\S]*?```html\n([\s\S]*?)\n```/g;

function loadReportTemplates() {
  var templates = {};
  if (!reportTmplDir) {
    console.println('[ReportTemplates] WARNING: report template directory not found');
    return templates;
  }
  try {
    var entries = fs.readdirSync(reportTmplDir);
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].endsWith('.md')) continue;
      var data = fs.readFileSync(path.join(reportTmplDir, entries[i]), 'utf8');
      var content = data.replace(/\r\n/g, '\n');
      var match;
      REPORT_TEMPLATE_RE.lastIndex = 0;
      while ((match = REPORT_TEMPLATE_RE.exec(content)) !== null) {
        templates[match[1]] = match[2].trim();
      }
    }
  } catch (e) {
    console.println('[ReportTemplates] Failed to read dir: ' + e.message);
  }
  var ids = Object.keys(templates);
  if (ids.length > 0) {
    console.println('[ReportTemplates] Loaded ' + ids.length + ' templates: ' + JSON.stringify(ids));
  }
  return templates;
}

function expandReportTemplate(templateID, params) {
  var tmpl = loadReportTemplates();
  var code = tmpl[templateID];
  if (!code) {
    code = tmpl['R-0'];
    if (code) {
      console.println('[ReportTemplates] Template \'' + templateID + '\' not found, falling back to R-0');
    }
  }
  if (!code) {
    throw new Error('Report template \'' + templateID + '\' not found. Available: ' + JSON.stringify(Object.keys(tmpl)));
  }
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var re = new RegExp('\\{' + keys[i] + '\\}', 'g');
    code = code.replace(re, params[keys[i]]);
  }
  return code;
}

module.exports = { loadReportTemplates, expandReportTemplate };
