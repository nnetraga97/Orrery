// Java support shared by the Node analyzer and the browser viewer (tree-sitter, no DOM, no filesystem).
//   createJavaParser()          → { parse(source) → tree }
//   javaHeader(tree)            → package, imports, top-level types, and the type names a file mentions
//   javaSymbols(tree, opts)     → the same per-file declaration data symbols.mjs writes for TypeScript
//   extractJavaFlow(tree, src, member) → { body, hoods }, the control-flow tree towns.js lays out
//   javaTokens(tree)            → syntax-highlight ranges for the source panel
// Every tree-sitter node-kind rule for Java lives here so the analyzer and the viewer cannot disagree.

import { createParser } from './tree-sitter.js';

// The bundled viewer passes base explicitly: its chunks do not sit next to vendor/tree-sitter/.
export const createJavaParser = base => createParser('tree-sitter-java.wasm', base);

const TYPE_KINDS = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  record_declaration: 'record',
  annotation_type_declaration: 'annotation',
};
const COMMENT = new Set(['line_comment', 'block_comment']);
const CALLABLE = new Set(['method_declaration', 'constructor_declaration', 'compact_constructor_declaration']);
const line = n => n.startPosition.row + 1;
const endLine = n => n.endPosition.row + 1;
const same = (a, b) => !!a && !!b && a.id === b.id;
const named = n => n.namedChildren.filter(c => !COMMENT.has(c.type));
const simpleOf = qualified => (qualified || '').split('.').pop();
const stripParens = text =>
  text
    .replace(/^\(\s*/, '')
    .replace(/\s*\)$/, '')
    .replace(/\s+/g, ' ');
const looksLikeType = text => text.charCodeAt(0) >= 65 && text.charCodeAt(0) <= 90;

function modifiersOf(n) {
  const m = n.namedChildren.find(c => c.type === 'modifiers');
  return new Set(m ? m.children.map(c => c.type) : []);
}
function visibility(mods, inInterface) {
  if (mods.has('private')) return 'private';
  if (mods.has('public') || inInterface) return 'public';
  return mods.has('protected') ? 'protected' : 'package';
}
const paramsOf = fn =>
  (fn.childForFieldName('parameters')?.namedChildren || []).filter(
    p => p.type === 'formal_parameter' || p.type === 'spread_parameter',
  );
const argCount = call => named(call.childForFieldName('arguments')).length;
// The declared class of a variable, as its simple name: `List<Hold>` is List, `a.b.Catalog` is Catalog. Arrays and
// primitives name no class whose methods a call could reach.
function declaredClass(type) {
  if (!type) return null;
  if (type.type === 'type_identifier') return type.text;
  if (type.type === 'generic_type') return declaredClass(type.namedChildren[0]);
  if (type.type === 'scoped_type_identifier') return declaredClass(type.namedChildren.at(-1));
  return null;
}
// Variable name → declared class for a callable: its owner's fields and record components, then its parameters, then
// its locals (later declarations shadow earlier ones the way Java scopes would for distinct names).
function declaredTypes(fn, owner) {
  const types = new Map(),
    put = (name, type) => {
      const cls = declaredClass(type);
      if (name && cls) types.set(name, cls);
    };
  for (const c of owner?.childForFieldName('body')?.namedChildren || [])
    if (c.type === 'field_declaration')
      c.namedChildren
        .filter(x => x.type === 'variable_declarator')
        .forEach(v => put(v.childForFieldName('name')?.text, c.childForFieldName('type')));
  for (const p of owner?.childForFieldName('parameters')?.namedChildren || [])
    put(p.childForFieldName('name')?.text, p.childForFieldName('type'));
  for (const p of paramsOf(fn)) put(p.childForFieldName('name')?.text, p.childForFieldName('type'));
  (function visit(n) {
    if (n.type === 'local_variable_declaration' || n.type === 'resource')
      n.namedChildren
        .filter(x => x.type === 'variable_declarator')
        .forEach(v => put(v.childForFieldName('name')?.text, n.childForFieldName('type')));
    if (n.type === 'resource' || n.type === 'enhanced_for_statement' || n.type === 'catch_formal_parameter')
      put(n.childForFieldName('name')?.text, n.childForFieldName('type'));
    for (const c of n.namedChildren) visit(c);
  })(fn);
  return types;
}

// Body of a callable, or null for abstract / native methods and interface signatures.
function bodyOf(fn) {
  if (CALLABLE.has(fn.type)) return fn.childForFieldName('body');
  if (fn.type === 'static_initializer') return fn.namedChildren.find(c => c.type === 'block') || null;
  return fn.type === 'block' ? fn : null;
}

// Members of one type body: methods, constructors, initializers, and nested types (returned separately).
function typeBodyOf(t) {
  const body = t.childForFieldName('body');
  if (!body) return { members: [], nested: [] };
  const holders =
    t.type === 'enum_declaration'
      ? body.namedChildren.flatMap(c =>
          c.type === 'enum_body_declarations'
            ? [c]
            : c.type === 'enum_constant'
              ? c.namedChildren.filter(x => x.type === 'class_body')
              : [],
        )
      : [body];
  const members = [],
    nested = [];
  for (const h of holders)
    for (const c of h.namedChildren) {
      if (CALLABLE.has(c.type) || c.type === 'static_initializer' || c.type === 'block') members.push(c);
      else if (TYPE_KINDS[c.type]) nested.push(c);
    }
  return { members, nested };
}
function memberName(m) {
  if (m.type === 'method_declaration') return m.childForFieldName('name').text;
  if (m.type === 'static_initializer') return 'static initializer';
  return m.type === 'block' ? 'instance initializer' : 'constructor';
}

// ---------- header: what a file declares and mentions (drives the import graph) ----------
export function javaHeader(tree) {
  const root = tree.rootNode,
    imports = [],
    types = [],
    refs = new Set();
  let pkg = '';
  for (const c of root.namedChildren) {
    if (c.type === 'package_declaration')
      pkg = c.namedChildren.find(x => x.type === 'scoped_identifier' || x.type === 'identifier')?.text || '';
    else if (c.type === 'import_declaration') {
      const name = c.namedChildren.find(x => x.type === 'scoped_identifier' || x.type === 'identifier')?.text;
      if (name)
        imports.push({
          name,
          isStatic: c.children.some(x => x.type === 'static'),
          wildcard: c.namedChildren.some(x => x.type === 'asterisk'),
        });
    } else if (TYPE_KINDS[c.type]) types.push(c.childForFieldName('name').text);
  }
  const local = new Set(types);
  (function walk(n) {
    if (n.type === 'import_declaration' || n.type === 'package_declaration') return;
    if (TYPE_KINDS[n.type]) local.add(n.childForFieldName('name').text);
    else if ((n.type === 'type_identifier' || n.type === 'identifier') && looksLikeType(n.text)) refs.add(n.text);
    for (const c of n.namedChildren) walk(c);
  })(root);
  return { pkg, imports, types, localTypes: local, refs };
}

// ---------- symbols: declarations and per-method measurements ----------
// opts.resolve(simpleTypeName) → path of the analyzed file that declares it (or null); opts.self is this file's own path.
export function javaSymbols(tree, { resolve = () => null } = {}) {
  const root = tree.rootNode,
    decls = [],
    calledMembers = new Set();
  const cache = new Map();
  const resolved = name => {
    if (!cache.has(name)) cache.set(name, resolve(name) || null);
    return cache.get(name);
  };

  function measure(body, ownerSimple, types = new Map()) {
    let branches = 0;
    const uses = new Set(),
      selfCalls = new Set(),
      sigs = new Set(),
      externalCalls = new Map();
    (function visit(n) {
      switch (n.type) {
        case 'if_statement':
        case 'for_statement':
        case 'enhanced_for_statement':
        case 'while_statement':
        case 'do_statement':
        case 'catch_clause':
        case 'ternary_expression':
          branches++;
          break;
        case 'switch_label':
          if (n.children[0]?.type === 'case') branches++;
          break;
        case 'binary_expression': {
          const op = n.childForFieldName('operator')?.type;
          if (op === '&&' || op === '||') branches++;
          break;
        }
        case 'identifier':
        case 'type_identifier':
          if (looksLikeType(n.text)) {
            const hit = resolved(n.text);
            if (hit) uses.add(hit);
          }
          break;
        case 'method_invocation': {
          const obj = n.childForFieldName('object'),
            name = n.childForFieldName('name').text;
          if (obj) calledMembers.add(name);
          if (!obj || obj.type === 'this' || (obj.type === 'identifier' && obj.text === ownerSimple)) {
            selfCalls.add(name);
            sigs.add(name + '/' + argCount(n));
          } else {
            // A call on a variable of a declared class (or a static Class.call) that another analyzed file declares.
            const receiver =
                obj.type === 'identifier'
                  ? obj.text
                  : obj.type === 'field_access' && obj.childForFieldName('object')?.type === 'this'
                    ? obj.childForFieldName('field')?.text
                    : null,
              cls = receiver ? (types.get(receiver) ?? (looksLikeType(receiver) ? receiver : null)) : null,
              file = cls ? resolved(cls) : null;
            if (file) {
              const argc = argCount(n),
                key = [name, argc, receiver, file].join('\0');
              if (!externalCalls.has(key))
                externalCalls.set(key, { name, argc, receiver, type: cls, target: file, resolution: 'external' });
            }
          }
          break;
        }
      }
      for (const c of n.namedChildren) visit(c);
    })(body);
    return {
      branches,
      uses: [...uses],
      selfCalls: [...selfCalls],
      sigs: [...sigs],
      externalCalls: [...externalCalls.values()],
    };
  }

  function declare(t, prefix, inInterface) {
    const simple = t.childForFieldName('name').text,
      name = prefix ? prefix + '.' + simple : simple,
      sub = TYPE_KINDS[t.type];
    const mods = modifiersOf(t),
      { members: nodes, nested } = typeBodyOf(t);
    const ifaceBody = t.type === 'interface_declaration' || t.type === 'annotation_type_declaration';
    const members = [];
    for (const m of nodes) {
      const body = bodyOf(m);
      if (!body) continue; // abstract and interface signatures have no executable town
      const isCtor = m.type === 'constructor_declaration' || m.type === 'compact_constructor_declaration';
      const mm = modifiersOf(m);
      members.push({
        name: memberName(m),
        kind: isCtor ? 'ctor' : 'method',
        start: line(m),
        end: endLine(m),
        sourceStart: m.startIndex,
        sourceEnd: m.endIndex,
        vis: visibility(mm, ifaceBody),
        static: mm.has('static') || m.type === 'static_initializer',
        params: paramsOf(m).length,
        varargs: paramsOf(m).some(p => p.type === 'spread_parameter'),
        ...measure(body, simple, declaredTypes(m, t)),
      });
    }
    // A type with executable members is a planet region source ('class'); a bodiless one is a moon (interface / enum / type).
    const decl = {
      kind: members.length ? 'class' : sub === 'interface' ? 'interface' : sub === 'enum' ? 'enum' : 'type',
      sub,
      name,
      start: line(t),
      end: endLine(t),
      exported: mods.has('public') || inInterface,
    };
    if (members.length) decl.members = members;
    decls.push(decl);
    nested.forEach(n => declare(n, name, ifaceBody));
  }
  for (const c of root.namedChildren) if (TYPE_KINDS[c.type]) declare(c, '', false);

  // Runtime vs type-only use of each referenced file: [runtime, type-only, 0] (the third slot is TypeScript's re-exports).
  // Runtime: a type name read as a value (Foo.bar(), Foo.CONST), `new Foo`, Foo[] creation, Foo.class, casts, instanceof and
  // `extends Foo`. Everything else (fields, parameters, return types, generics, implements) is type-only.
  const RUNTIME_PARENTS = new Set([
    'object_creation_expression',
    'array_creation_expression',
    'class_literal',
    'cast_expression',
    'instanceof_expression',
    'superclass',
  ]);
  const refs = {},
    bump = (target, i) => {
      (refs[target] ||= [0, 0, 0])[i]++;
    };
  (function visit(n) {
    if (n.type === 'package_declaration' || n.type === 'import_declaration') return;
    if ((n.type === 'identifier' || n.type === 'type_identifier') && looksLikeType(n.text)) {
      const hit = resolved(n.text);
      if (hit) {
        let p = n.parent; // climb through Outer.Inner / Foo<T> / Foo[] to the use site
        while (p && (p.type === 'scoped_type_identifier' || p.type === 'generic_type' || p.type === 'array_type'))
          p = p.parent;
        bump(hit, n.type === 'identifier' || RUNTIME_PARENTS.has(p?.type) ? 0 : 1);
      }
    }
    for (const c of n.namedChildren) visit(c);
  })(root);
  return { decls, calls: [...calledMembers], refs };
}

// ---------- control flow of one method (mirrors towns.js extractFlow for TypeScript) ----------
export function extractJavaFlow(tree, source, member) {
  const lines = source.split('\n');
  let fn = null;
  (function find(n) {
    if (fn) return;
    const initializer =
      n.type === 'block' && (n.parent?.type === 'class_body' || n.parent?.type === 'enum_body_declarations');
    if ((CALLABLE.has(n.type) || n.type === 'static_initializer' || initializer) && line(n) === member.start) {
      fn = n;
      return;
    }
    for (const c of n.namedChildren) find(c);
  })(tree.rootNode);
  const fnBody = fn && bodyOf(fn);
  if (!fnBody) return null;

  const ownerSimple = simpleOf(member.owner);
  // The declared class of each variable a call can be made on, so a town can tell project calls from library calls.
  let ownerType = fn.parent;
  while (ownerType && !TYPE_KINDS[ownerType.type]) ownerType = ownerType.parent;
  const receiverTypes = declaredTypes(fn, ownerType);
  // Names in scope that are not fields: parameters and every local declared anywhere in the method.
  const locals = new Set();
  (function collect(n) {
    if (
      n.type === 'formal_parameter' ||
      n.type === 'spread_parameter' ||
      n.type === 'catch_formal_parameter' ||
      n.type === 'inferred_parameters'
    )
      n.namedChildren.filter(c => c.type === 'identifier').forEach(c => locals.add(c.text));
    if (n.type === 'variable_declarator' || n.type === 'enhanced_for_statement' || n.type === 'resource') {
      const id = n.childForFieldName('name') || n.namedChildren.find(c => c.type === 'identifier');
      if (id) locals.add(id.text);
    }
    if (n.type === 'lambda_expression') {
      const p = n.childForFieldName('parameters');
      if (p?.type === 'identifier') locals.add(p.text);
    }
    for (const c of n.namedChildren) collect(c);
  })(fn);
  const ownerFields = new Set();
  for (let t = fn.parent; t; t = t.parent)
    if (TYPE_KINDS[t.type]) {
      const b = t.childForFieldName('body');
      (b?.namedChildren || []).forEach(c =>
        c.type === 'enum_body_declarations' ? c.namedChildren.forEach(x => addField(x)) : addField(c),
      );
      (t.childForFieldName('parameters')?.namedChildren || []).forEach(p => {
        const id = p.childForFieldName('name');
        if (id) ownerFields.add(id.text);
      });
      break;
    }
  function addField(c) {
    if (c.type === 'field_declaration')
      c.namedChildren
        .filter(x => x.type === 'variable_declarator')
        .forEach(v => ownerFields.add(v.childForFieldName('name').text));
  }

  const clean = raw =>
    raw
      .replace(/^\/\/+\s?|^\/\*+\s?|\*+\/$/g, '')
      .split('\n')
      .map(l => l.replace(/^\s*\*+\s?/, '').trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 90);
  const leading = st => {
    const out = [];
    let p = st.previousSibling;
    while (p && COMMENT.has(p.type) && !lines[p.startPosition.row].slice(0, p.startPosition.column).trim()) {
      out.unshift(clean(p.text));
      p = p.previousSibling;
    }
    return out.filter(Boolean);
  };

  const scopes = [],
    seenScopes = new Set();
  function addScope(node) {
    if (seenScopes.has(node.startIndex)) return;
    let body, name;
    if (node.type === 'lambda_expression') {
      body = node.childForFieldName('body');
      const call =
        node.parent?.type === 'argument_list' && node.parent.parent?.type === 'method_invocation'
          ? node.parent.parent.childForFieldName('name').text
          : null;
      name = call ? call + ' callback' : 'lambda';
    } else {
      body = bodyOf(node);
      name = memberName(node);
    }
    if (!body) return;
    seenScopes.add(node.startIndex);
    const scope = { name: name + ' · L' + line(node), scope: node.startIndex, parentLine: line(node), items: [] };
    scopes.push(scope);
    scope.items = body.type === 'block' || body.type === 'constructor_body' ? seq(body) : [exprItem(body)];
  }

  function facts(n, loopBody) {
    const calls = [],
      writes = [],
      fields = new Set();
    (function visit(x) {
      if (x.type === 'lambda_expression') {
        addScope(x);
        return;
      }
      if (x.type === 'class_body') {
        x.namedChildren.filter(c => CALLABLE.has(c.type)).forEach(addScope);
        return;
      }
      if (loopBody && same(x, loopBody)) return;
      const p = x.parent;
      if (x.type === 'method_invocation') {
        const obj = x.childForFieldName('object'),
          target = obj?.type === 'identifier' ? obj.text : null;
        calls.push({
          name: x.childForFieldName('name').text,
          self: !obj || obj.type === 'this' || (!!target && target === ownerSimple),
          target,
          type: target ? (receiverTypes.get(target) ?? (looksLikeType(target) ? target : null)) : null,
          argc: argCount(x),
        });
      } else if (x.type === 'assignment_expression') writes.push(x.childForFieldName('left').text);
      else if (x.type === 'update_expression') writes.push(x.namedChildren[0].text);
      else if (x.type === 'variable_declarator') writes.push(x.childForFieldName('name').text);
      else if (x.type === 'field_access' && x.childForFieldName('object')?.type === 'this')
        fields.add(x.childForFieldName('field').text);
      else if (
        x.type === 'identifier' &&
        ownerFields.has(x.text) &&
        !locals.has(x.text) &&
        p &&
        !(p.type === 'method_invocation' && same(p.childForFieldName('name'), x)) &&
        !(p.type === 'field_access' && same(p.childForFieldName('field'), x)) &&
        ![
          'variable_declarator',
          'labeled_statement',
          'break_statement',
          'continue_statement',
          'formal_parameter',
        ].includes(p.type)
      )
        fields.add(x.text);
      for (const c of x.namedChildren) if (!COMMENT.has(c.type)) visit(c);
    })(n);
    return { calls, writes, fields: [...fields] };
  }

  const seq = node =>
    !node ? [] : node.type === 'block' || node.type === 'constructor_body' ? named(node).map(item) : [item(node)];
  const base = (st, summary) => ({
    id: `${st.startIndex}:${st.endIndex}`,
    line: line(st),
    end: endLine(st),
    sourceStart: st.startIndex,
    sourceEnd: st.endIndex,
    summary: summary.replace(/\s+/g, ' ').trim(),
    context: contextOf(st),
    comment: leading(st)[0] || null,
  });
  const firstLine = st => st.text.split('\n')[0];
  function exprItem(expr) {
    return {
      id: `${expr.startIndex}:${expr.endIndex}`,
      line: line(expr),
      end: endLine(expr),
      sourceStart: expr.startIndex,
      sourceEnd: expr.endIndex,
      summary: firstLine(expr).trim(),
      context: contextOf(expr),
      comment: null,
      t: 'stmt',
      kind: 'expr',
      ...facts(expr),
    };
  }
  function contextOf(st) {
    const context = [];
    for (let child = st, a = st.parent; a && !same(a, fn); child = a, a = a.parent) {
      if (a.type === 'if_statement' && !same(a.childForFieldName('condition'), child))
        context.unshift({
          line: line(a),
          text: `if (${stripParens(a.childForFieldName('condition').text)}) · ${same(a.childForFieldName('alternative'), child) ? 'else' : 'then'}`,
        });
      else if (
        a.type === 'lambda_expression' ||
        (CALLABLE.has(a.type) &&
          a.parent?.type === 'class_body' &&
          a.parent.parent?.type === 'object_creation_expression')
      )
        context.unshift({
          line: line(a),
          text: (a.type === 'lambda_expression' ? 'lambda' : memberName(a)) + ' scope',
        });
      else if (
        ['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement'].includes(a.type) &&
        same(a.childForFieldName('body'), child)
      )
        context.unshift({ line: line(a), text: 'loop body' });
      else if (a.type === 'catch_clause') context.unshift({ line: line(a), text: 'catch handler' });
    }
    return context;
  }

  function item(st) {
    switch (st.type) {
      case 'labeled_statement':
        return { ...item(named(st).pop()), label: st.namedChildren[0].text };
      case 'if_statement': {
        const cond = st.childForFieldName('condition'),
          alt = st.childForFieldName('alternative');
        return {
          ...base(st, stripParens(cond.text)),
          t: 'if',
          ...facts(cond),
          then: seq(st.childForFieldName('consequence')),
          else: alt ? (alt.type === 'if_statement' ? [item(alt)] : seq(alt)) : null,
        };
      }
      case 'for_statement':
      case 'enhanced_for_statement':
      case 'while_statement':
      case 'do_statement': {
        const body = st.childForFieldName('body'),
          cond = st.childForFieldName('condition');
        return {
          ...base(
            st,
            st.type === 'while_statement' || st.type === 'do_statement' ? stripParens(cond.text) : firstLine(st),
          ),
          t: 'loop',
          doWhile: st.type === 'do_statement',
          ...facts(st, body),
          body: seq(body),
        };
      }
      case 'switch_expression': {
        const cond = st.childForFieldName('condition'),
          block = st.childForFieldName('body');
        const cases = named(block).map(g =>
          named(g)
            .filter(c => c.type !== 'switch_label')
            .flatMap(c => (c.type === 'block' ? seq(c) : [item(c)])),
        );
        const hasDefault = named(block).some(g =>
          named(g).some(c => c.type === 'switch_label' && c.children[0]?.type === 'default'),
        );
        return {
          ...base(st, stripParens(cond.text)),
          t: 'switch',
          hasDefault,
          arrow: named(block).some(g => g.type === 'switch_rule'),
          ...facts(cond),
          cases,
        };
      }
      case 'try_statement':
      case 'try_with_resources_statement': {
        const catches = st.namedChildren.filter(c => c.type === 'catch_clause'),
          fin = st.namedChildren.find(c => c.type === 'finally_clause');
        const catchTypes = catches.map(c =>
          (
            c.namedChildren
              .find(p => p.type === 'catch_formal_parameter')
              ?.namedChildren.find(p => p.type === 'catch_type')?.namedChildren || []
          ).map(t => simpleOf(t.text)),
        );
        // Several catch clauses become one fork with a lane per clause, so a trip enters exactly one of them.
        const clauses = catches.map(c => seq(c.childForFieldName('body')));
        const handler = !catches.length
          ? null
          : catches.length === 1
            ? clauses[0]
            : [
                {
                  ...base(catches[0], 'catch ' + catchTypes.map(t => t.join(' | ')).join(', ')),
                  t: 'switch',
                  catchSwitch: true,
                  hasDefault: true,
                  arrow: true,
                  calls: [],
                  writes: [],
                  fields: [],
                  cases: clauses,
                },
              ];
        return {
          ...base(st, firstLine(st)),
          t: 'try',
          catchTypes,
          body: seq(st.childForFieldName('body')),
          handler,
          finalizer: seq(fin?.namedChildren.find(c => c.type === 'block')),
        };
      }
      case 'synchronized_statement':
        return {
          ...base(st, 'synchronized ' + stripParens(st.namedChildren[0].text)),
          t: 'block',
          body: seq(st.namedChildren.find(c => c.type === 'block')),
        };
      case 'block':
        return { ...base(st, firstLine(st)), t: 'block', body: seq(st) };
    }
    const kind =
      st.type === 'return_statement'
        ? 'return'
        : st.type === 'throw_statement'
          ? 'throw'
          : st.type === 'local_variable_declaration' || st.type === 'local_class_declaration'
            ? 'decl'
            : ['break_statement', 'continue_statement', 'yield_statement'].includes(st.type)
              ? 'jump'
              : 'expr';
    const leaf = { ...base(st, firstLine(st)), t: 'stmt', kind, ...facts(st) };
    if (kind === 'throw') {
      const e = st.namedChildren[0];
      leaf.thrown = e?.type === 'object_creation_expression' ? simpleOf(e.childForFieldName('type')?.text || '') : null;
    }
    return leaf;
  }

  const body = seq(fnBody);
  // Neighbourhoods: a new one starts at each top-level statement with a leading comment; tiny ones merge backward.
  const hoods = [];
  body.forEach((st, k) => {
    if (!hoods.length || (st.comment && hoods[hoods.length - 1].items.length))
      hoods.push({ name: st.comment || (k === 0 ? 'entry' : `block ${hoods.length + 1}`), items: [] });
    hoods[hoods.length - 1].items.push(st);
  });
  const count = items =>
    items.reduce(
      (n, it) =>
        n +
        1 +
        (it.then ? count(it.then) : 0) +
        (it.else ? count(it.else) : 0) +
        (it.body ? count(it.body) : 0) +
        (it.cases ? it.cases.reduce((m, c) => m + count(c), 0) : 0) +
        (it.handler ? count(it.handler) : 0) +
        (it.finalizer ? count(it.finalizer) : 0),
      0,
    );
  const merged = [];
  hoods.forEach(h => {
    if (merged.length && count(h.items) < 2) merged[merged.length - 1].items.push(...h.items);
    else merged.push(h);
  });
  return { body, hoods: [...merged.map(h => ({ ...h, scope: fn.startIndex })), ...scopes.filter(h => h.items.length)] };
}

// ---------- highlighting ----------
export function javaTokens(tree) {
  const tokens = [];
  (function visit(n) {
    if (n.type === 'string_literal' || n.type === 'character_literal' || n.type === 'text_block') {
      tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-string' });
      return;
    }
    if (n.childCount) {
      for (const c of n.children) visit(c);
      return;
    }
    const t = n.type;
    if (/_literal$/.test(t) && /integer|floating/.test(t))
      tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-number' });
    else if (
      (!n.isNamed && /^[a-z]+$/.test(t)) ||
      t === 'this' ||
      t === 'super' ||
      t === 'true' ||
      t === 'false' ||
      t === 'null_literal'
    )
      tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-keyword' });
  })(tree.rootNode);
  return tokens;
}
