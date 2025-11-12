const fs = require('fs');
const path = require('path');

const cache = new Map();

function compile(template) {
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let cursor = 0;
  let code = 'let __out = "";\n';
  let match;
  while ((match = matcher.exec(template))) {
    const preceding = template.slice(cursor, match.index);
    if (preceding) {
      code += `__out += ${JSON.stringify(preceding)};\n`;
    }
    const flag = match[1];
    const content = match[2];
    if (flag === '=') {
      code += `__out += (((${content}) ?? '')).toString();\n`;
    } else if (flag === '-') {
      code += `__out += ((${content}) ?? '');\n`;
    } else {
      code += `${content}\n`;
    }
    cursor = match.index + match[0].length;
  }
  const tail = template.slice(cursor);
  if (tail) {
    code += `__out += ${JSON.stringify(tail)};\n`;
  }
  code += 'return __out;';
  return new Function('locals', `with (locals || {}) {\n${code}\n}`);
}

function renderFile(filename, locals, callback) {
  const absolute = path.resolve(filename);
  if (cache.has(absolute)) {
    try {
      const renderer = cache.get(absolute);
      const output = renderer(locals);
      callback(null, output);
      return;
    } catch (error) {
      callback(error);
      return;
    }
  }

  fs.readFile(absolute, 'utf8', (err, source) => {
    if (err) {
      callback(err);
      return;
    }
    try {
      const renderer = compile(source);
      cache.set(absolute, renderer);
      const output = renderer(locals);
      callback(null, output);
    } catch (error) {
      callback(error);
    }
  });
}

module.exports = { renderFile };
