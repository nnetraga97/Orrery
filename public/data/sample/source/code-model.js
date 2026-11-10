// Shared, serializable source model. Both offline analysis and the browser use this
// module; no renderer, filesystem, or compiler nodes escape through its result.
const VERSION = 2;
const clip = (s, max = 180) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const unique = values => [...new Set(values)];
const hash = text => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};
export const sourceFingerprint = source => `${source.length}:${hash(source)}`;

function scriptKind(ts, file) {
  return /\.tsx$/i.test(file)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(file)
      ? ts.ScriptKind.JSX
      : /\.(?:js|mjs|cjs)$/i.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
}

function callableKind(ts, node) {
  return ts.isConstructorDeclaration(node)
    ? 'ctor'
    : ts.isGetAccessor(node)
      ? 'get'
      : ts.isSetAccessor(node)
        ? 'set'
        : ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)
          ? 'method'
          : 'function';
}

function unwrapped(ts, node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression?.(node))
  )
    node = node.expression;
  return node;
}

function boundName(ts, node, sf) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isClassExpression(node) && node.parent && ts.isVariableDeclaration(node.parent))
    return node.parent.name.getText(sf);
  if (node.name) return node.name.getText(sf);
  let p = node.parent;
  while (
    p &&
    (ts.isParenthesizedExpression(p) || ts.isCallExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p))
  )
    p = p.parent;
  if (p && (ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertyAssignment(p)))
    return p.name.getText(sf);
  if (p && ts.isExportAssignment(p)) return 'default';
  return 'anonymous';
}

/** Canonical IDs have no source-line component. Duplicate implementations receive
 * a signature suffix in analyzeSource; TypeScript overload signatures share the
 * executable implementation's identity. */
export function declarationId(ts, node, options = {}) {
  const sf = options.sourceFile || node.getSourceFile();
  let owner = options.owner;
  if (owner === undefined) {
    const owners = [];
    for (let p = node.parent; p && p !== sf; p = p.parent) {
      if (ts.isClassLike(p) || ts.isObjectLiteralExpression(p) || ts.isModuleDeclaration(p))
        owners.unshift(boundName(ts, p, sf));
    }
    owner = owners.join('.');
  }
  return `${String(options.file || sf.fileName).replace(/\\/g, '/')}#${owner ? owner + '.' : ''}${options.name || boundName(ts, node, sf)}:${options.kind || callableKind(ts, node)}`;
}

export function analyzeSource(ts, source, options = {}) {
  const file = String(options.file || options.sourceFile?.fileName || 'source.ts').replace(/\\/g, '/');
  const sf =
    options.sourceFile || ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const checker = options.checker;
  const lineOf = pos => sf.getLineAndCharacterOfPosition(Math.max(0, Math.min(pos, source.length))).line + 1;
  const textOf = node => (node ? node.getText(sf) : '');
  const modifiers = node => ts.getCombinedModifierFlags?.(node) || 0;
  const visibility = node =>
    modifiers(node) & ts.ModifierFlags.Private || (node.name && ts.isPrivateIdentifier?.(node.name))
      ? 'private'
      : modifiers(node) & ts.ModifierFlags.Protected
        ? 'protected'
        : 'public';
  const exported = node => !!(modifiers(node) & ts.ModifierFlags.Export) || ts.isExportAssignment(node);
  const range = node => ({
    start: lineOf(node.getStart(sf)),
    end: lineOf(node.end),
    sourceStart: node.getStart(sf),
    sourceEnd: node.end,
  });
  const diagnostics = (sf.parseDiagnostics || []).map(d => ({
    category: 'parse',
    line: lineOf(d.start || 0),
    message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
  }));
  const moduleCache = new Map();
  function moduleFor(specifier) {
    if (!moduleCache.has(specifier)) {
      let result;
      try {
        result = options.resolveModule?.(specifier, sf.fileName);
      } catch (error) {
        diagnostics.push({ category: 'resolution', message: clip(error.message) });
      }
      if (typeof result === 'string')
        result = { file: result, status: result === specifier ? 'unresolved' : 'resolved' };
      result ||= { file: specifier, status: 'unresolved' };
      moduleCache.set(specifier, { ...result, file: result.file || result.path || specifier, specifier });
    }
    return moduleCache.get(specifier);
  }

  // Lexical bindings prevent a parameter named like an import or sibling function
  // from creating a false dependency when no project checker is available.
  const scopes = new WeakMap(),
    scopeOf = new WeakMap(),
    imports = new Map(),
    importNodes = new WeakMap();
  const isScope = node =>
    ts.isSourceFile(node) ||
    ts.isFunctionLike(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCatchClause(node);
  const namesIn = (name, fn) => {
    if (!name) return;
    if (ts.isIdentifier(name)) fn(name.text, name);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
      for (const el of name.elements) if (ts.isBindingElement(el)) namesIn(el.name, fn);
  };
  function indexScopes(node, current) {
    const enclosing = current;
    if (isScope(node)) {
      current = node;
      scopes.set(node, new Map());
    }
    scopeOf.set(node, current);
    const bind = (name, declaration, scope = current) => namesIn(name, id => scopes.get(scope)?.set(id, declaration));
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) bind(node.name, node, enclosing);
    if (ts.isFunctionExpression(node)) bind(node.name, node);
    if (ts.isVariableDeclaration(node)) {
      let bindingScope = current;
      if (ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & ts.NodeFlags.BlockScoped)) {
        while (
          bindingScope &&
          !ts.isSourceFile(bindingScope) &&
          !ts.isFunctionLike(bindingScope) &&
          !ts.isModuleBlock(bindingScope)
        )
          bindingScope = scopeOf.get(bindingScope.parent);
      }
      bind(node.name, node, bindingScope);
    }
    if (ts.isParameter(node)) bind(node.name, node);
    if (ts.isImportClause(node)) bind(node.name, node);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node))
      bind(node.name, node);
    ts.forEachChild(node, child => indexScopes(child, current));
  }
  indexScopes(sf, sf);
  function lexicalDeclaration(identifier) {
    let scope = scopeOf.get(identifier);
    while (scope) {
      const binding = scopes.get(scope)?.get(identifier.text);
      if (binding) return binding;
      scope = scopeOf.get(scope.parent);
    }
    return null;
  }
  function symbolDeclaration(node) {
    if (!checker) return lexicalDeclaration(node);
    try {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      return symbol?.valueDeclaration || symbol?.declarations?.find(d => d.body) || symbol?.declarations?.[0] || null;
    } catch {
      return null;
    }
  }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    const module = moduleFor(st.moduleSpecifier.text),
      clause = st.importClause;
    const add = (node, name, imported, typeOnly = false) => {
      const entry = { name, imported, module, typeOnly, declaration: node };
      imports.set(name, entry);
      importNodes.set(node, entry);
    };
    if (clause?.name) add(clause, clause.name.text, 'default', clause.isTypeOnly);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
      add(clause.namedBindings, clause.namedBindings.name.text, '*', clause.isTypeOnly);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
      for (const el of clause.namedBindings.elements)
        add(el, el.name.text, (el.propertyName || el.name).text, clause.isTypeOnly || el.isTypeOnly);
  }
  function importedModuleCall(node) {
    node = unwrapped(ts, node);
    if (node && ts.isAwaitExpression(node)) node = node.expression;
    if (!node || !ts.isCallExpression(node) || !node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))
      return null;
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire =
      ts.isIdentifier(node.expression) && node.expression.text === 'require' && !lexicalDeclaration(node.expression);
    return isImport || isRequire ? moduleFor(node.arguments[0].text) : null;
  }
  (function commonJSBindings(node) {
    if (ts.isVariableDeclaration(node)) {
      const module = importedModuleCall(node.initializer);
      if (module) {
        const bindings = new Map();
        namesIn(node.name, (name, id) => {
          const imported = ts.isBindingElement(id.parent) ? textOf(id.parent.propertyName || id.parent.name) : '*';
          bindings.set(name, { name, imported, module, typeOnly: false, declaration: node });
        });
        importNodes.set(node, { bindings });
      }
    }
    ts.forEachChild(node, commonJSBindings);
  })(sf);
  function importFor(identifier) {
    if (!ts.isIdentifier(identifier)) return null;
    const entry = importNodes.get(lexicalDeclaration(identifier));
    return entry?.bindings ? entry.bindings.get(identifier.text) || null : entry || null;
  }
  function rootIdentifier(expression) {
    let node = unwrapped(ts, expression);
    while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)))
      node = unwrapped(ts, node.expression);
    return node && ts.isIdentifier(node) ? node : null;
  }
  function originOf(expression, seen = new Set()) {
    const node = unwrapped(ts, expression);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const imported = importFor(node);
      if (imported) return imported;
      const binding = lexicalDeclaration(node);
      if (binding?.initializer) return originOf(binding.initializer, seen);
      if (binding?.type && ts.isTypeReferenceNode(binding.type)) return originOf(binding.type.typeName, seen);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const module = importedModuleCall(node);
      return module
        ? { name: module.specifier, imported: '*', module, typeOnly: false }
        : originOf(node.expression, seen);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const name = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression?.text;
        let owner = node.parent;
        while (owner && !ts.isClassLike(owner)) owner = owner.parent;
        const property = owner?.members.find(member => member.name && textOf(member.name) === name);
        if (property?.initializer) return originOf(property.initializer, seen);
        if (property?.type && ts.isTypeReferenceNode(property.type)) return originOf(property.type.typeName, seen);
        const ctor = owner?.members.find(member => ts.isConstructorDeclaration(member));
        const parameter = ctor?.parameters.find(p => textOf(p.name) === name && modifiers(p));
        if (parameter?.type && ts.isTypeReferenceNode(parameter.type)) return originOf(parameter.type.typeName, seen);
      }
      return originOf(node.expression, seen);
    }
    return null;
  }
  function globalOrigin(expression, seen = new Set()) {
    const node = unwrapped(ts, expression);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const binding = lexicalDeclaration(node);
      if (binding?.initializer) return globalOrigin(binding.initializer, seen);
      return binding ? null : node.text;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node) ||
      ts.isNewExpression(node)
    )
      return globalOrigin(node.expression, seen);
    return null;
  }
  const routeLibrary = source =>
    /^(?:express|fastify|koa-router|@koa\/router|hono|@hapi\/hapi)(?:\/|$)/.test(source || '');
  const eventLibrary = source => /^(?:node:events|events|rxjs|socket\.io)(?:\/|$)/.test(source || '');

  const decls = [],
    records = [],
    nodeRecords = new WeakMap(),
    recordNodes = new Map(),
    registrationNodes = [];
  const bindRecord = (node, record) => {
    if (node) nodeRecords.set(node, record);
  };
  function callableFrom(node) {
    node = unwrapped(ts, node);
    if (!node) return null;
    if (ts.isFunctionLike(node) && node.body) return { fn: node, wrappers: [] };
    if (ts.isCallExpression(node)) {
      const candidates = node.arguments.map(callableFrom).filter(Boolean);
      // Only unambiguous wrappers adopt a callable's identity. Multiple callback
      // arguments are separate registration scopes, never silently discarded.
      if (candidates.length === 1)
        return { fn: candidates[0].fn, wrappers: [clip(textOf(node.expression)), ...candidates[0].wrappers] };
    }
    return null;
  }
  function addCallable(node, binding, owner = null, extra = {}) {
    const found = callableFrom(node);
    if (!found) return null;
    const fn = found.fn,
      name = extra.name || boundName(ts, binding || fn, sf),
      kind = extra.kind || callableKind(ts, binding || fn);
    const record = {
      id: declarationId(ts, fn, { file, sourceFile: sf, owner, name, kind }),
      name,
      kind,
      owner,
      ...range(binding || fn),
      vis: visibility(binding || fn),
      static: !!(modifiers(binding || fn) & ts.ModifierFlags.Static),
      exported: extra.exported || false,
      params: fn.parameters?.length || 0,
      async: !!(modifiers(fn) & ts.ModifierFlags.Async),
      branches: 0,
      uses: [],
      selfCalls: [],
      callTargets: [],
      fields: [],
      operations: [],
      roles: [],
      wrappers: found.wrappers,
      analysisStatus: 'analyzed',
    };
    records.push(record);
    recordNodes.set(record, fn);
    bindRecord(fn, record);
    bindRecord(binding, record);
    bindRecord(node, record);
    return record;
  }
  function addContainer(node, name, kind, statement, owner = null) {
    const container = {
      id: declarationId(ts, node, { file, sourceFile: sf, owner, name, kind }),
      kind,
      name,
      owner,
      ...range(statement || node),
      exported: exported(statement || node),
      members: [],
      fields: [],
    };
    const fullOwner = owner ? owner + '.' + name : name;
    for (const member of node.members || node.properties || []) {
      if (ts.isSpreadAssignment(member)) continue;
      const memberName = ts.isConstructorDeclaration(member) ? 'constructor' : textOf(member.name);
      const candidate = member.body ? member : member.initializer;
      const callable =
        candidate &&
        addCallable(candidate, member, fullOwner, {
          name: memberName,
          kind: callableKind(ts, member) === 'function' ? 'method' : callableKind(ts, member),
        });
      if (callable) container.members.push(callable);
      else if (memberName)
        container.fields.push({
          name: memberName,
          ...range(member),
          vis: visibility(member),
          static: !!(modifiers(member) & ts.ModifierFlags.Static),
          initialized: !!member.initializer,
        });
    }
    return container;
  }
  function registrationCallbacks(node, statement) {
    // A top-level registration callback is executable code of its own. Callbacks
    // nested in any existing callable are extracted as hoods instead.
    const counters = new Map();
    const visit = n => {
      if (ts.isFunctionLike(n) && n.body) return;
      if (ts.isCallExpression(n)) {
        const callee = clip(textOf(n.expression), 90);
        n.arguments.forEach((arg, index) => {
          const found = callableFrom(arg);
          if (!found || nodeRecords.has(found.fn)) return;
          const literal = n.arguments.find(a => ts.isStringLiteralLike(a));
          const label = `${callee}${literal ? '(' + clip(literal.text, 45) + ')' : ''} callback ${index + 1}`;
          const count = counters.get(label) || 0;
          counters.set(label, count + 1);
          const record = addCallable(arg, found.fn, null, {
            name: label + (count ? ` ${count + 1}` : ''),
            kind: 'function',
            exported: false,
          });
          if (record) {
            decls.push(record);
            registrationNodes.push({ record, call: n });
          }
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
  function readStatement(st, namespace = null) {
    if (ts.isClassDeclaration(st)) decls.push(addContainer(st, st.name?.text || 'default', 'class', st, namespace));
    else if (ts.isFunctionDeclaration(st)) {
      if (st.body)
        decls.push(addCallable(st, st, namespace, { name: st.name?.text || 'default', exported: exported(st) }));
    } else if (ts.isVariableStatement(st)) {
      for (const variable of st.declarationList.declarations) {
        const value = unwrapped(ts, variable.initializer),
          name = textOf(variable.name);
        const callable = value && addCallable(value, variable, namespace, { name, exported: exported(st) });
        if (callable) decls.push(callable);
        else if (value && (ts.isClassExpression(value) || ts.isObjectLiteralExpression(value))) {
          const container = addContainer(
            value,
            name,
            ts.isClassExpression(value) ? 'class' : 'object',
            variable,
            namespace,
          );
          container.exported = exported(st);
          decls.push(container);
        } else {
          decls.push({ id: `${file}#${name}:const`, kind: 'const', name, ...range(variable), exported: exported(st) });
          if (value) registrationCallbacks(value, st);
        }
      }
    } else if (ts.isExportAssignment(st)) {
      const value = unwrapped(ts, st.expression),
        callable = addCallable(value, st, null, { name: 'default', exported: true });
      if (callable) decls.push(callable);
      else if (ts.isClassExpression(value) || ts.isObjectLiteralExpression(value))
        decls.push(addContainer(value, 'default', ts.isClassExpression(value) ? 'class' : 'object', st));
      else registrationCallbacks(st, st);
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
      const kind = ts.isInterfaceDeclaration(st) ? 'interface' : ts.isEnumDeclaration(st) ? 'enum' : 'type';
      decls.push({
        id: `${file}#${st.name.text}:${kind}`,
        kind,
        name: st.name.text,
        ...range(st),
        exported: exported(st),
      });
    } else if (ts.isModuleDeclaration(st) && st.body) {
      const body = st.body;
      const owner = namespace ? namespace + '.' + textOf(st.name) : textOf(st.name);
      if (ts.isModuleBlock(body)) for (const nested of body.statements) readStatement(nested, owner);
      else if (ts.isModuleDeclaration(body)) readStatement(body, owner);
    } else if (ts.isExpressionStatement(st)) {
      const expression = st.expression;
      if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const value = unwrapped(ts, expression.right),
          binding = expression.left;
        const name = ts.isPropertyAccessExpression(binding) ? binding.name.text : textOf(binding);
        const owner = ts.isPropertyAccessExpression(binding) ? textOf(binding.expression) : namespace;
        const callable = addCallable(value, expression, owner, {
          name,
          kind: owner ? 'method' : 'function',
          exported: /^(?:module\.exports|exports)(?:\.|$)/.test(textOf(binding)),
        });
        if (callable) {
          decls.push(callable);
          return;
        }
        if (ts.isClassExpression(value) || ts.isObjectLiteralExpression(value)) {
          const container = addContainer(
            value,
            textOf(binding),
            ts.isClassExpression(value) ? 'class' : 'object',
            expression,
            namespace,
          );
          container.exported = /^(?:module\.exports|exports)(?:\.|$)/.test(textOf(binding));
          decls.push(container);
          return;
        }
      }
      registrationCallbacks(st, st);
    }
  }
  for (const st of sf.statements) readStatement(st);
  const duplicateIds = new Map();
  for (const record of records) {
    const list = duplicateIds.get(record.id) || [];
    list.push(record);
    duplicateIds.set(record.id, list);
  }
  for (const list of duplicateIds.values())
    if (list.length > 1) {
      const used = new Map();
      for (const record of list) {
        const fn = recordNodes.get(record),
          signature = hash(
            textOf(fn)
              .slice(0, fn.body.getStart(sf) - fn.getStart(sf))
              .replace(/\s+/g, ''),
          );
        const count = used.get(signature) || 0;
        used.set(signature, count + 1);
        record.id += '~' + signature + (count ? '-' + (count + 1) : '');
      }
    }
  const byOwnerName = new Map();
  for (const record of records) {
    const key = `${record.owner || ''}:${record.name}`;
    const list = byOwnerName.get(key) || [];
    list.push(record);
    byOwnerName.set(key, list);
  }
  const callNames = new Set();
  function recordForDeclaration(declaration) {
    if (!declaration || ts.isParameter(declaration) || ts.isBindingElement(declaration)) return null;
    for (let node = declaration; node && node !== sf; node = node.parent) {
      const record = nodeRecords.get(node);
      if (record) return record;
      if (
        ts.isSourceFile(node) ||
        ts.isBlock(node) ||
        ts.isClassLike(node) ||
        ts.isFunctionLike(node) ||
        ts.isVariableDeclaration(node)
      )
        break;
    }
    return null;
  }
  function callFact(node, record) {
    const expression = unwrapped(ts, node.expression),
      root = rootIdentifier(expression),
      imported = originOf(expression);
    const property = ts.isPropertyAccessExpression(expression)
      ? expression.name
      : ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)
        ? expression.argumentExpression
        : null;
    const name = property
      ? property.text
      : ts.isIdentifier(expression)
        ? expression.text
        : clip(textOf(expression), 60);
    const receiver = property ? clip(textOf(expression.expression), 100) : null;
    let lexicalThis = true;
    const ownerFunction = record && recordNodes.get(record);
    for (let parent = node.parent; parent && parent !== ownerFunction; parent = parent.parent) {
      if (ts.isFunctionLike(parent) && !ts.isArrowFunction(parent)) {
        lexicalThis = false;
        break;
      }
    }
    const self =
      !!property &&
      ((expression.expression.kind === ts.SyntaxKind.ThisKeyword && lexicalThis) || receiver === record?.owner);
    const fact = {
      name,
      target: imported?.module.file || receiver,
      receiver,
      self,
      line: lineOf(node.getStart(sf)),
      argc: node.arguments?.length || 0,
      resolution: 'unresolved',
      expression: clip(textOf(expression)),
      ...(imported
        ? {
            import: {
              source: imported.module.specifier,
              name: imported.imported,
              local: imported.name,
              status: imported.module.status,
            },
          }
        : {}),
    };
    const declaration = checker
      ? symbolDeclaration(property || expression)
      : ts.isIdentifier(expression)
        ? lexicalDeclaration(expression)
        : null;
    let targetRecord = declaration && recordForDeclaration(declaration);
    if (!targetRecord && self) {
      const candidates = byOwnerName.get(`${record?.owner || receiver || ''}:${name}`) || [];
      if (candidates.length === 1) targetRecord = candidates[0];
    }
    if (!targetRecord && property && root && !imported) {
      const binding = lexicalDeclaration(root);
      const owner =
        binding &&
        (ts.isClassDeclaration(binding)
          ? binding.name?.text
          : ts.isVariableDeclaration(binding) &&
              (ts.isObjectLiteralExpression(unwrapped(ts, binding.initializer) || sf) ||
                ts.isClassExpression(unwrapped(ts, binding.initializer) || sf))
            ? textOf(binding.name)
            : null);
      const candidates = owner && byOwnerName.get(`${owner}:${name}`);
      if (candidates?.length === 1) targetRecord = candidates[0];
    }
    if (targetRecord) {
      fact.id = targetRecord.id;
      fact.resolution = 'resolved';
      fact.target = file;
      fact.targetLine = targetRecord.start;
      fact.local = true;
    } else if (declaration && checker && !ts.isParameter(declaration) && !ts.isBindingElement(declaration)) {
      let external;
      try {
        external = options.resolveDeclaration?.(declaration);
      } catch {
        /* Resolution stays explicit. */
      }
      if (external?.id) {
        fact.id = external.id;
        fact.target = external.file || imported?.module.file || null;
        fact.targetLine = external.line;
        fact.resolution = 'resolved';
      } else {
        fact.target = external?.file || imported?.module.file || fact.target;
        fact.binding = 'compiler';
        if (external?.status) fact.targetStatus = external.status;
      }
    }
    callNames.add(name);
    return fact;
  }
  const branchKinds = new Set([
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.CatchClause,
    ts.SyntaxKind.ConditionalExpression,
  ]);
  const logicalKinds = new Set([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ]);

  function buildFlow(record, fn) {
    const scopes = [],
      seenScopes = new Set(),
      operationCounts = new Map(),
      allOperations = [],
      allCalls = [],
      usedImports = new Set(),
      usedFields = new Set();
    const roleEvidence = new Map();
    const evidence = node => ({ line: lineOf(node.getStart(sf)), text: clip(textOf(node)) });
    function role(id, label, confidence, node, reason) {
      const ev = { ...evidence(node), ...(reason ? { reason } : {}) };
      if (!roleEvidence.has(id)) roleEvidence.set(id, { id, label, confidence, evidence: [] });
      const result = roleEvidence.get(id);
      result.confidence = Math.max(result.confidence, confidence);
      if (result.evidence.length < 8 && !result.evidence.some(e => e.line === ev.line && e.text === ev.text))
        result.evidence.push(ev);
    }
    const stateSetters = new Set();
    function inspectBindings(node) {
      if (node !== fn && ts.isFunctionLike(node) && node.body) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isArrayBindingPattern(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const call = callFact(node.initializer, record),
          imported = call.import;
        if (
          imported?.source === 'react' &&
          ['useState', 'useReducer'].includes(imported.name === '*' ? call.name : imported.name)
        ) {
          const setter = node.name.elements[1];
          if (setter && ts.isBindingElement(setter) && ts.isIdentifier(setter.name)) stateSetters.add(setter.name.text);
          role('state', 'State owner', 0.98, node, 'React state binding');
        }
      }
      ts.forEachChild(node, inspectBindings);
    }
    inspectBindings(fn.body);
    function inspectCall(node, call) {
      const effects = [],
        mark = (kind, id, label, confidence, reason) => {
          role(id, label, confidence, node, reason);
          effects.push({ kind, confidence, reason });
        };
      const imported = call.import,
        api = imported?.name === '*' ? call.name : imported?.name;
      if (imported?.source === 'react' && ['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(api))
        role('lifecycle', 'Lifecycle effect', 0.98, node, `React ${api}`);
      if (
        imported?.source === 'react' &&
        ['useState', 'useReducer', 'useContext', 'useSyncExternalStore'].includes(api)
      )
        role('state', 'State owner', 0.95, node, `React ${api}`);
      if (stateSetters.has(call.name) && ts.isIdentifier(node.expression))
        mark('write', 'state-update', 'State update', 0.98, 'Setter from React state binding');
      const receiver = call.receiver || '';
      const eventImport = imported && eventLibrary(imported.source);
      const browserEvent = ['window', 'document', 'globalThis', 'EventTarget'].includes(globalOrigin(node.expression));
      if (
        ['addEventListener', 'removeEventListener'].includes(call.name) &&
        receiver &&
        node.arguments.length >= 2 &&
        browserEvent
      )
        mark('subscribe', 'events', 'Event boundary', 0.95, 'Browser event listener registration or removal');
      if (
        ['on', 'once', 'subscribe'].includes(call.name) &&
        receiver &&
        (node.arguments.some(a => ts.isFunctionLike(a)) || eventImport)
      ) {
        if (eventImport) mark('subscribe', 'events', 'Event subscription', 0.96, `API from ${imported.source}`);
      }
      if ((call.name === 'dispatchEvent' && browserEvent) || (['emit', 'publish'].includes(call.name) && eventImport))
        mark('emit', 'events', 'Event producer', 0.95, 'Event API');
      if (
        ['getItem', 'setItem', 'removeItem', 'clear'].includes(call.name) &&
        /^(?:window\.)?(?:localStorage|sessionStorage)$/.test(receiver) &&
        !(rootIdentifier(node.expression) && lexicalDeclaration(rootIdentifier(node.expression)))
      )
        mark('persist', 'persistence', 'Persistence', 0.99, 'Browser storage API');
      if (
        imported &&
        /(?:prisma|typeorm|sequelize|mongoose|knex|drizzle|sqlite|(?:^|\/)pg$|redis|mongodb|firebase)/i.test(
          imported.source,
        )
      )
        mark('persist', 'persistence', 'Persistence', 0.9, `Receiver originates from ${imported.source}`);
      if (imported && /^(?:node:)?fs(?:\/promises)?$/.test(imported.source))
        mark('filesystem', 'filesystem', 'File I/O', 0.99, 'Node filesystem API');
      if (
        (call.name === 'fetch' && ts.isIdentifier(node.expression) && !lexicalDeclaration(node.expression)) ||
        (imported && /^(?:axios|node-fetch|undici)$/.test(imported.source))
      )
        mark('network', 'network', 'Network I/O', 0.94, 'HTTP client API');
      if (
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use'].includes(call.name) &&
        routeLibrary(imported?.source) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments.slice(1).some(a => ts.isFunctionLike(a) || ts.isIdentifier(a))
      )
        role('routing', 'Route registration', 0.96, node, `Route API from ${imported.source}`);
      return effects;
    }
    function operation(kind, node, detail = {}) {
      const signature = `${kind}:${clip(textOf(node), 120)}`,
        count = operationCounts.get(signature) || 0;
      operationCounts.set(signature, count + 1);
      const op = {
        id: `${record.id}/op:${hash(signature)}${count ? ':' + count : ''}`,
        kind,
        line: lineOf(node.getStart(sf)),
        end: lineOf(node.end),
        // Source offsets make same-line operations distinguishable (source-index.js).
        sourceStart: node.getStart(sf),
        sourceEnd: node.end,
        evidence: evidence(node),
        ...detail,
      };
      allOperations.push(op);
      return op;
    }
    function addScope(node) {
      if (!node.body || seenScopes.has(node)) return;
      seenScopes.add(node);
      let parent = node.parent;
      while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))) parent = parent.parent;
      const parentCall = parent && ts.isCallExpression(parent) ? clip(textOf(parent.expression), 70) : null;
      const scope = {
        name: node.name?.getText(sf) || (parentCall ? parentCall + ' callback' : 'callback'),
        scope: `${record.id}/scope:${hash(clip(textOf(node).slice(0, 160)))}:${scopes.length}`,
        parentLine: lineOf(node.getStart(sf)),
        items: [],
      };
      scopes.push(scope);
      scope.items = sequence(node.body, !ts.isBlock(node.body));
    }
    function facts(node, omit = new Set()) {
      const calls = [],
        writes = [],
        fields = new Set(),
        operations = [];
      const add = (kind, n, detail) => {
        const op = operation(kind, n, detail);
        operations.push(op);
        return op;
      };
      function visit(n) {
        if (omit.has(n)) return;
        if (ts.isFunctionLike(n) && n.body) {
          addScope(n);
          return;
        }
        if (branchKinds.has(n.kind) || (ts.isBinaryExpression(n) && logicalKinds.has(n.operatorToken.kind)))
          record.branches++;
        if (ts.isIdentifier(n)) {
          const imported = importFor(n);
          if (imported) usedImports.add(imported.module.file);
        }
        if (ts.isCallExpression(n)) {
          const call = callFact(n, record);
          calls.push(call);
          allCalls.push(call);
          add('call', n, { call });
          for (const effect of inspectCall(n, call))
            add(effect.kind, n, { confidence: effect.confidence, reason: effect.reason, target: call.expression });
        }
        if (ts.isNewExpression(n)) {
          const call = callFact(n, record);
          calls.push({ ...call, construct: true });
          allCalls.push({ ...call, construct: true });
          add('construct', n, { call });
        }
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const target = clip(textOf(n.left));
          writes.push(target);
          add('write', n.left, { target });
          if (target.startsWith('this.')) role('state-update', 'State update', 0.99, n, 'Writes instance state');
        }
        if (
          (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)
        ) {
          const target = clip(textOf(n.operand));
          writes.push(target);
          add('write', n, { target });
        }
        if (ts.isVariableDeclaration(n)) {
          const target = clip(textOf(n.name));
          writes.push(target);
          add('declare', n.name, { target });
        }
        if (ts.isReturnStatement(n)) add('return', n, { expression: clip(textOf(n.expression)) });
        if (ts.isThrowStatement(n)) add('throw', n, { expression: clip(textOf(n.expression)) });
        if (ts.isAwaitExpression(n)) add('await', n);
        if (ts.isYieldExpression(n)) add('yield', n);
        if (
          ts.isPropertyAccessExpression(n) &&
          n.expression.kind === ts.SyntaxKind.ThisKeyword &&
          !(ts.isCallExpression(n.parent) && n.parent.expression === n)
        ) {
          fields.add(n.name.text);
          usedFields.add(n.name.text);
        }
        if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
          role('ui', 'UI rendering', 0.99, n, 'JSX syntax');
          add('render', n);
        }
        ts.forEachChild(n, visit);
      }
      visit(node);
      return { calls, writes: unique(writes), fields: [...fields], operations };
    }
    const comment = node =>
      (ts.getLeadingCommentRanges(source, node.pos) || [])
        .map(r => clip(source.slice(r.pos, r.end).replace(/^\/\/\s?|^\/\*+\s?|\*+\/$/g, '')))
        .filter(Boolean)[0] || null;
    let statementIndex = 0;
    function sequence(node, expressionReturn = false) {
      return !node ? [] : ts.isBlock(node) ? node.statements.map(n => item(n)) : [item(node, expressionReturn)];
    }
    function item(node, expressionReturn = false) {
      const base = {
        id: `${record.id}/statement:${statementIndex++}`,
        line: lineOf(node.getStart(sf)),
        end: lineOf(node.end),
        sourceStart: node.getStart(sf),
        sourceEnd: node.end,
        summary: clip(textOf(node)),
        comment: comment(node),
        context: [],
      };
      for (let p = node.parent, child = node; p && p !== fn; child = p, p = p.parent) {
        if (ts.isIfStatement(p))
          base.context.unshift({
            line: lineOf(p.getStart(sf)),
            text: `if (${clip(textOf(p.expression), 100)}) · ${child === p.elseStatement ? 'else' : 'then'}`,
          });
        else if (ts.isFunctionLike(p)) base.context.unshift({ line: lineOf(p.getStart(sf)), text: 'callback scope' });
        else if (ts.isCatchClause(p)) base.context.unshift({ line: lineOf(p.getStart(sf)), text: 'catch handler' });
      }
      if (ts.isIfStatement(node)) {
        record.branches++;
        return {
          ...base,
          t: 'if',
          ...facts(node.expression),
          then: sequence(node.thenStatement),
          else: node.elseStatement ? sequence(node.elseStatement) : null,
        };
      }
      if (
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
      )
        return {
          ...base,
          t: 'loop',
          doWhile: ts.isDoStatement(node),
          ...facts(node, new Set([node.statement])),
          body: sequence(node.statement),
        };
      if (ts.isSwitchStatement(node)) {
        record.branches += node.caseBlock.clauses.filter(c => ts.isCaseClause(c)).length;
        return {
          ...base,
          t: 'switch',
          hasDefault: node.caseBlock.clauses.some(c => ts.isDefaultClause(c)),
          ...facts(node.expression),
          cases: node.caseBlock.clauses.map(c => c.statements.map(n => item(n))),
        };
      }
      if (ts.isTryStatement(node)) {
        if (node.catchClause) record.branches++;
        return {
          ...base,
          t: 'try',
          calls: [],
          writes: [],
          fields: [],
          operations: [],
          catchAll: !!node.catchClause,
          body: sequence(node.tryBlock),
          handler: node.catchClause ? sequence(node.catchClause.block) : null,
          finalizer: sequence(node.finallyBlock),
        };
      }
      if (ts.isBlock(node)) return { ...base, t: 'block', body: sequence(node) };
      const kind =
        expressionReturn || ts.isReturnStatement(node)
          ? 'return'
          : ts.isThrowStatement(node)
            ? 'throw'
            : ts.isVariableStatement(node)
              ? 'decl'
              : ts.isBreakStatement(node) || ts.isContinueStatement(node)
                ? 'jump'
                : 'expr';
      const result = { ...base, t: 'stmt', kind, ...facts(node) };
      if (expressionReturn)
        result.operations.push(operation('return', node, { expression: clip(textOf(node)), implicit: true }));
      if (kind === 'throw')
        result.thrown =
          node.expression && ts.isNewExpression(node.expression) ? clip(textOf(node.expression.expression)) : null;
      return result;
    }
    const body = sequence(fn.body, !ts.isBlock(fn.body)),
      hoods = [];
    for (const item of body) {
      if (!hoods.length || (item.comment && hoods[hoods.length - 1].items.length))
        hoods.push({ name: item.comment || 'entry', scope: record.id, items: [] });
      hoods[hoods.length - 1].items.push(item);
    }
    const returnedExpressions = [];
    (function returns(node) {
      if (node !== fn.body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) returnedExpressions.push(node.expression);
      ts.forEachChild(node, returns);
    })(fn.body);
    if (!ts.isBlock(fn.body)) returnedExpressions.push(fn.body);
    for (const expression of returnedExpressions) {
      const returned = unwrapped(ts, expression),
        binding = ts.isIdentifier(returned) ? lexicalDeclaration(returned) : null;
      const value = unwrapped(ts, binding?.initializer || returned);
      if (value && (ts.isNewExpression(value) || ts.isObjectLiteralExpression(value)))
        role('factory', 'Object construction', 0.9, expression, 'Returns a constructed object');
    }
    let returnValue = returnedExpressions.length === 1 ? unwrapped(ts, returnedExpressions[0]) : null;
    if (returnValue && ts.isAwaitExpression(returnValue)) returnValue = unwrapped(ts, returnValue.expression);
    if (
      body.length === 1 &&
      body[0].kind === 'return' &&
      returnValue &&
      ts.isCallExpression(returnValue) &&
      body[0].calls.length === 1 &&
      !body[0].writes.length
    )
      role('delegation', 'Delegation', 0.96, returnedExpressions[0], 'Directly returns a single call');
    if (record.kind === 'get' || record.kind === 'set')
      role('accessor', record.kind === 'get' ? 'Getter' : 'Setter', 1, fn, 'Language accessor declaration');
    if (record.kind === 'ctor') role('construction', 'Constructor', 1, fn, 'Language constructor declaration');
    const decorators = ts.canHaveDecorators?.(fn) ? ts.getDecorators(fn) || [] : fn.decorators || [];
    for (const decorator of decorators) {
      if (!ts.isCallExpression(decorator.expression)) continue;
      const call = callFact(decorator.expression, record);
      if (
        call.import &&
        /(?:nestjs|routing-controllers|tsoa)/.test(call.import.source) &&
        ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Route', 'All'].includes(call.import.name)
      )
        role('routing', 'Route handler', 0.99, decorator, 'Imported framework route decorator');
    }
    record.operations = allOperations;
    record.callTargets = allCalls;
    record.selfCalls = unique(allCalls.filter(c => c.self && c.resolution === 'resolved').map(c => c.name));
    record.uses = [...usedImports];
    record.fields = [...usedFields];
    record.roles = [...roleEvidence.values()];
    if (!record.roles.length)
      record.roles = [
        {
          id: 'computation',
          label: 'Computation',
          confidence: 0.4,
          evidence: [{ line: record.start, text: 'No supported architectural pattern established for this callable.' }],
        },
      ];
    return { body, hoods: [...hoods, ...scopes.filter(scope => scope.items.length)] };
  }
  for (const record of records) record.flow = buildFlow(record, recordNodes.get(record));
  // Registration sites provide evidence for the handler, including named handlers
  // declared elsewhere in the same file. They do not prove requests ever ran.
  function applyRegistration(record, call) {
    if (!record || !ts.isPropertyAccessExpression(call.expression)) return;
    const method = call.expression.name.text,
      literal = call.arguments.find(a => ts.isStringLiteralLike(a));
    const imported = originOf(call.expression),
      browserEvent = ['window', 'document', 'globalThis', 'EventTarget'].includes(globalOrigin(call.expression));
    let role;
    if (
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use'].includes(method) &&
      literal &&
      routeLibrary(imported?.module.specifier)
    )
      role = { id: 'routing', label: 'Route handler', confidence: 0.96 };
    else if (
      (['on', 'once', 'subscribe'].includes(method) && eventLibrary(imported?.module.specifier)) ||
      (method === 'addEventListener' && browserEvent)
    )
      role = { id: 'events', label: 'Event handler', confidence: 0.95 };
    if (role && !record.roles.some(r => r.id === role.id)) {
      record.roles = record.roles.filter(r => r.id !== 'computation');
      record.roles.push({
        ...role,
        evidence: [
          { line: lineOf(call.getStart(sf)), text: clip(textOf(call)), reason: 'Callback passed to registration API' },
        ],
      });
    }
  }
  for (const { record, call } of registrationNodes) applyRegistration(record, call);
  (function registrations(node) {
    if (ts.isCallExpression(node))
      for (const argument of node.arguments) {
        if (!ts.isIdentifier(argument)) continue;
        const record = recordForDeclaration(symbolDeclaration(argument));
        if (record) applyRegistration(record, node);
      }
    ts.forEachChild(node, registrations);
  })(sf);

  const refs = {},
    bump = (target, kind) => {
      (refs[target] ||= [0, 0, 0])[kind]++;
    };
  function isTypeReference(node) {
    for (let p = node.parent; p && p !== sf; p = p.parent) {
      if (ts.isHeritageClause(p)) return !(p.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(p.parent));
      if (ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
      if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return true;
    }
    return false;
  }
  (function reference(node) {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause) bump(moduleFor(node.moduleSpecifier.text).file, 2);
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      bump(moduleFor(node.moduleSpecifier.text).file, 2);
      return;
    }
    if (ts.isIdentifier(node)) {
      const imported = importFor(node),
        p = node.parent;
      if (
        imported &&
        !(p?.name === node && !ts.isShorthandPropertyAssignment(p)) &&
        !(ts.isQualifiedName(p) && p.right === node)
      )
        bump(imported.module.file, imported.typeOnly || isTypeReference(node) ? 1 : 0);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
      callNames.add(node.expression.name.text);
    ts.forEachChild(node, reference);
  })(sf);
  return {
    schemaVersion: VERSION,
    sourceFingerprint: sourceFingerprint(source),
    file,
    lines: source.split('\n').length,
    decls,
    calls: [...callNames],
    refs,
    analysis: {
      engine: 'typescript',
      mode: checker ? 'project' : 'syntax',
      binding: checker ? 'project-checker' : 'lexical',
      status: diagnostics.some(d => d.category === 'parse') ? 'partial' : 'analyzed',
      callableCount: records.length,
      resolvedCalls: records.reduce((n, r) => n + r.callTargets.filter(c => c.resolution === 'resolved').length, 0),
      unresolvedCalls: records.reduce((n, r) => n + r.callTargets.filter(c => c.resolution !== 'resolved').length, 0),
      diagnostics,
      limitations: [
        'Static source relationships do not establish runtime execution.',
        ...(checker ? [] : ['External and dynamic call targets require project type information.']),
      ],
    },
  };
}
