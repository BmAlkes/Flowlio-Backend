const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
function registeredRoutes(root, read = file => fs.readFileSync(file, 'utf8')) {
 const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
 const serverFile = path.join(root, 'src/server.ts');
 const server = parse(serverFile); const imports = new Map(); const mounts = [];
 function visitServer(node) {
  if (ts.isImportDeclaration(node) && node.importClause?.name) imports.set(node.importClause.name.text, node.moduleSpecifier.text);
  if (ts.isCallExpression(node) && node.expression.getText(server) === 'app.use' && ts.isStringLiteral(node.arguments[0] || {})) {
   const route = node.arguments[1]; if (route && ts.isIdentifier(route)) mounts.push([node.arguments[0].text, route.text]);
  }
  ts.forEachChild(node, visitServer);
 }
 visitServer(server); const routes = [];
 for (const [prefix, identifier] of mounts) {
  const specifier = imports.get(identifier); if (!specifier?.includes('.routes')) continue;
  const file = specifier.startsWith('@/') ? path.join(root,'src',specifier.slice(2)+'.ts') : path.resolve(root,'src',specifier+'.ts');
  const source = parse(file);
  function visit(node) {
   if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
     && ['get','post','put','patch','delete'].includes(node.expression.name.text)
     && ts.isStringLiteral(node.arguments[0] || {})) {
    const route = (prefix + node.arguments[0].text).replace(/\/$/, '').replace(/^\/api(?=\/|$)/, '') || '/';
    routes.push({ method: node.expression.name.text, path: route });
   }
   ts.forEachChild(node, visit);
  }
  visit(source);
 }
 return routes;
}
function assertCoreRoutes(endpoints, routes) {
 const missing = Object.entries(endpoints).filter(([, endpoint]) => !routes.some(route => route.method === endpoint.method && route.path === endpoint.path));
 if (missing.length) throw Error('Missing API endpoints: ' + missing.map(([name, endpoint]) => `${name} (${endpoint.method.toUpperCase()} ${endpoint.path})`).join(', '));
}
module.exports = { registeredRoutes, assertCoreRoutes };
