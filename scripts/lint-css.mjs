import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

const root = path.resolve('css');
const files = [];
const errors = [];
const keyframes = new Set();
const knownProperties = new Set(`accent-color align-content align-items align-self animation animation-duration animation-iteration-count appearance aspect-ratio backdrop-filter background background-color background-image background-size border border-bottom border-collapse border-color border-left border-left-color border-radius border-right border-right-color border-spacing border-top border-top-color bottom box-shadow box-sizing clip color color-scheme content cursor display fill filter flex flex-basis flex-direction flex-shrink flex-wrap font font-family font-size font-style font-variant-numeric font-weight gap grid-column grid-row grid-template-columns height inset justify-content justify-self left letter-spacing line-height list-style margin margin-bottom margin-inline margin-left margin-right margin-top max-height max-width min-height min-width object-fit opacity order outline outline-offset overflow overflow-wrap overflow-x overflow-y overscroll-behavior overscroll-behavior-inline padding padding-bottom padding-inline padding-left padding-right padding-top place-items pointer-events position r resize right scroll-behavior scrollbar-color scrollbar-width size stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-opacity stroke-width table-layout text-align text-decoration text-overflow text-rendering text-shadow text-transform top touch-action transform transition transition-duration user-select vector-effect vertical-align visibility white-space width word-break z-index -moz-osx-font-smoothing -webkit-appearance -webkit-backdrop-filter -webkit-font-smoothing -webkit-overflow-scrolling -webkit-tap-highlight-color`.split(/\s+/));
const animationKeywords = new Set(`none infinite normal reverse alternate alternate-reverse forwards backwards both running paused ease ease-in ease-out ease-in-out linear step-start step-end initial inherit unset revert revert-layer`.split(/\s+/));

async function collectCss(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectCss(filePath);
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(filePath);
  }
}

await collectCss(root);

for (const filePath of files.sort()) {
  const source = await readFile(filePath, 'utf8');
  let ast;
  try {
    ast = postcss.parse(source, { from: filePath });
  } catch (error) {
    console.error(error.toString());
    errors.push(error.toString());
    continue;
  }

  ast.walkAtRules(/^(?:-webkit-)?keyframes$/i, (rule) => keyframes.add(rule.params.trim()));
}

for (const filePath of files.sort()) {
  const source = await readFile(filePath, 'utf8');
  let ast;
  try { ast = postcss.parse(source, { from: filePath }); }
  catch { continue; }
  ast.walkRules((rule) => {
    const declarations = new Map();
    rule.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      const key = `${property}\0${declaration.value.trim()}`;
      if (declarations.has(key)) {
        errors.push(`${filePath}:${declaration.source.start.line}: duplicate ${declaration.prop}: ${declaration.value} in ${rule.selector}`);
      } else {
        declarations.set(key, declaration.source.start.line);
      }

      if (!property.startsWith('--') && !knownProperties.has(property)) {
        errors.push(`${filePath}:${declaration.source.start.line}: unknown CSS property ${declaration.prop}`);
      }

      for (const match of declaration.value.matchAll(/#([\da-f]{3,8})\b/gi)) {
        if (![3, 4, 6, 8].includes(match[1].length)) errors.push(`${filePath}:${declaration.source.start.line}: invalid hex color #${match[1]}`);
      }

      if (property === 'animation-name' || property === 'animation') {
        const candidates = declaration.value.split(',').flatMap((part) => {
          const cleaned = part.replace(/[\w-]+\([^)]*\)/g, ' ').replace(/\b(?:\d*\.)?\d+m?s\b/gi, ' ');
          return cleaned.match(/[A-Za-z_][\w-]*/g) || [];
        });
        for (const name of candidates) {
          if (animationKeywords.has(name.toLowerCase()) || ['cubic-bezier', 'steps', 'var', 'calc'].includes(name.toLowerCase()) || name.startsWith('--')) continue;
          if (!keyframes.has(name)) errors.push(`${filePath}:${declaration.source.start.line}: animation ${name} has no matching @keyframes`);
        }
      }
    });
  });
}

if (errors.length) {
  for (const error of errors) console.error(error);
  console.error(`CSS lint failed with ${errors.length} issue${errors.length === 1 ? '' : 's'} across ${files.length} stylesheet(s).`);
  process.exitCode = 1;
} else {
  console.log(`CSS lint passed: ${files.length} stylesheets parsed; no duplicate declarations, unknown properties, invalid hex colors, or unresolved animations.`);
}
