import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

const root = path.resolve('css');
const files = [];

async function collectCss(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectCss(filePath);
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(filePath);
  }
}

await collectCss(root);
let errors = 0;

for (const filePath of files.sort()) {
  const source = await readFile(filePath, 'utf8');
  let ast;
  try {
    ast = postcss.parse(source, { from: filePath });
  } catch (error) {
    console.error(error.toString());
    errors += 1;
    continue;
  }

  ast.walkRules((rule) => {
    const declarations = new Map();
    rule.walkDecls((declaration) => {
      const key = `${declaration.prop.toLowerCase()}\0${declaration.value.trim()}`;
      if (declarations.has(key)) {
        console.error(`${filePath}:${declaration.source.start.line}: duplicate ${declaration.prop}: ${declaration.value} in ${rule.selector}`);
        errors += 1;
      } else {
        declarations.set(key, declaration.source.start.line);
      }
    });
  });
}

if (errors) {
  console.error(`CSS lint failed with ${errors} issue${errors === 1 ? '' : 's'} across ${files.length} stylesheet(s).`);
  process.exitCode = 1;
} else {
  console.log(`CSS lint passed: parsed ${files.length} stylesheet(s); no exact duplicate declarations found.`);
}
