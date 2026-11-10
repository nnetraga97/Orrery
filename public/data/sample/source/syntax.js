// The shared model for languages parsed with tree-sitter (languages.js, frontEnd 'syntax'): used by the
// analyzer (engine/analyzer/syntax-dataset.mjs) and the viewer (towns.js), with no DOM and no filesystem.
//   createSyntaxParser(id, base)            → { parse(source) → tree }
//   syntaxSymbols(tree, id, { resolve })    → { decls, calls, refs, names }, the per-file data symbols.mjs writes
//   extractSyntaxFlow(tree, source, member, id) → { body, hoods }, the control-flow tree towns.js lays out
//   syntaxTokens(tree)                      → syntax-highlight ranges for the source panel
// Grammars name the same constructs alike (if_statement, call_expression…), so one vocabulary covers most of
// them; RULES holds what differs per language: declarations, names, visibility and receivers.
import { LANGUAGES } from './languages.js';
import { createParser } from './tree-sitter.js';

export function createSyntaxParser(id, base) {
  const language = LANGUAGES.find(l => l.id === id);
  if (!language?.grammar) throw new Error(`No tree-sitter grammar for ${id}.`);
  return createParser(language.grammar, base);
}

// ---------- the shared vocabulary ----------
const set = (...names) => new Set(names);
const IF = set('if_statement', 'if_expression', 'if', 'unless');
const ELSE_IF = set('elif_clause', 'else_if_clause', 'elsif', 'elseif_statement');
const ELSE = set('else_clause', 'else', 'else_statement');
const LOOP = set(
  'for_statement',
  'for_expression',
  'for_in_statement',
  'for_range_loop',
  'foreach_statement',
  'while_statement',
  'while_expression',
  'while',
  'until',
  'for',
  'do_statement',
  'do_while_statement',
  'loop_expression',
  'repeat_statement',
);
const DO_WHILE = set('do_statement', 'do_while_statement', 'repeat_statement');
const SWITCH = set(
  'switch_statement',
  'switch_expression',
  'match_expression',
  'match_statement',
  'case',
  'when_expression',
  'expression_switch_statement',
  'type_switch_statement',
  'select_statement',
);
const CASE = set(
  'case_clause',
  'expression_case',
  'type_case',
  'communication_case',
  'default_case',
  'case_statement',
  'default_statement',
  'switch_section',
  'match_arm',
  'when',
  'when_entry',
);
const TRY = set('try_statement', 'try_expression', 'begin');
const CATCH = set('except_clause', 'catch_clause', 'rescue', 'catch_block');
const FINALLY = set('finally_clause', 'ensure', 'finally_block');
const RETURN = set('return_statement', 'return_expression', 'return');
const THROW = set('throw_statement', 'throw_expression', 'raise_statement');
const JUMP = set(
  'break_statement',
  'continue_statement',
  'break_expression',
  'continue_expression',
  'break',
  'next',
  'redo',
  'retry',
  'goto_statement',
  'fallthrough_statement',
);
const DECL = set(
  'let_declaration',
  'short_var_declaration',
  'var_declaration',
  'const_declaration',
  'local_declaration_statement',
  'declaration',
  'variable_declaration',
  'property_declaration',
  'val_definition',
  'var_definition',
  'local_variable_declaration',
);
const BLOCK = set(
  'block',
  'compound_statement',
  'statement_list',
  'statement_block',
  'body_statement',
  'then',
  'do',
  'block_body',
  'function_body',
  'control_structure_body',
);
const CALL = set(
  'call',
  'call_expression',
  'invocation_expression',
  'function_call',
  'function_call_expression',
  'member_call_expression',
  'scoped_call_expression',
  'nullsafe_member_call_expression',
);
const BRANCH = new Set([
  ...IF,
  ...ELSE_IF,
  ...LOOP,
  ...CATCH,
  ...[...CASE].filter(t => t !== 'default_case' && t !== 'default_statement'),
  'conditional_expression',
  'ternary_expression',
  'conditional',
  'if_modifier',
  'unless_modifier',
  'while_modifier',
  'until_modifier',
]);
const LOGICAL = set('&&', '||', 'and', 'or');
const ASSIGN = set(
  'assignment',
  'assignment_expression',
  'augmented_assignment',
  'operator_assignment',
  'compound_assignment_expr',
  'assignment_statement',
  'augmented_assignment_expression',
);
const RECEIVER_FIELDS = ['object', 'operand', 'value', 'argument', 'expression', 'table', 'scope', 'receiver'];
const MEMBER_FIELDS = ['field', 'name', 'attribute', 'method'];
const SELF = set('self', 'this', '$this', 'this_expression', 'self_expression');
const COMMENT = /comment/;
const STRING =
  /^(string|string_literal|interpreted_string_literal|raw_string_literal|char_literal|character_literal|rune_literal|encapsed_string|heredoc|nowdoc|verbatim_string_literal|interpolated_string_expression|line_string_literal|multi_line_string_literal|interpolated_string|raw_string|template_string|string_value)$/;
const NUMBER =
  /^(integer|float|number|int_literal|float_literal|integer_literal|float_literal|number_literal|real_literal|imaginary_literal|decimal_integer_literal|decimal_floating_point_literal|hex_literal)$/;
const IDENTIFIER =
  /^(identifier|type_identifier|constant|name|simple_identifier|field_identifier|package_identifier|namespace_identifier)$/;

const line = n => n.startPosition.row + 1;
const endLine = n => n.endPosition.row + 1;
const same = (a, b) => !!a && !!b && a.id === b.id;
const named = n => (n ? n.namedChildren.filter(c => !COMMENT.test(c.type)) : []);
const field = (n, ...names) => {
  for (const name of names) {
    const c = n?.childForFieldName(name);
    if (c) return c;
  }
  return null;
};
const firstLine = n => n.text.split('\n')[0].trim();
const stripParens = text =>
  text
    .replace(/^\(\s*/, '')
    .replace(/\s*\)$/, '')
    .replace(/\s+/g, ' ');
const simple = text =>
  String(text || '')
    .split(/::|\.|\\|:/)
    .pop();

// ---------- what differs per language ----------
const nameField = n => field(n, 'name')?.text || null;
const modifierWords = n =>
  n.children
    .filter(c => /modifier/.test(c.type))
    .flatMap(c => c.text.split(/\s+/))
    .concat(n.children.filter(c => !c.isNamed).map(c => c.type));
const javaLikeVisibility = fallback => node => {
  const words = modifierWords(node);
  return ['private', 'protected', 'public', 'internal'].find(w => words.includes(w)) || fallback;
};
// C and C++: the function's name sits inside its declarator, qualified for out-of-class definitions.
function cName(node) {
  let d = field(node, 'declarator');
  while (d && d.type !== 'function_declarator') d = field(d, 'declarator');
  const inner = field(d, 'declarator');
  if (!inner) return null;
  if (inner.type === 'qualified_identifier')
    return { name: field(inner, 'name')?.text || simple(inner.text), owner: simple(field(inner, 'scope')?.text) };
  return { name: inner.text };
}
const typeOf = n => (field(n, 'type')?.text || '').replace(/<.*$/s, '').trim();

const RULES = {
  python: {
    functions: set('function_definition'),
    types: { class_definition: 'class' },
    self: ['self', 'cls'],
    ctor: name => name === '__init__',
    visibility: (n, name) => (name.startsWith('_') && !/^__.+__$/.test(name) ? 'private' : 'public'),
    isStatic: n =>
      n.parent?.type === 'decorated_definition' &&
      n.parent.namedChildren.some(d => d.type === 'decorator' && /\b(staticmethod|classmethod)\b/.test(d.text)),
  },
  go: {
    functions: set('function_declaration', 'method_declaration'),
    types: { type_spec: 'type' },
    typeSub: n => ({ struct_type: 'struct', interface_type: 'interface' })[field(n, 'type')?.type] || 'type',
    owner: n => {
      const receiver = field(n, 'receiver');
      const type = receiver?.namedChildren[0] && field(receiver.namedChildren[0], 'type');
      return type ? type.text.replace(/^\*/, '').replace(/\[.*$/s, '') : null;
    },
    receiverNames: n => {
      const p = field(n, 'receiver')?.namedChildren[0];
      return p && field(p, 'name') ? [field(p, 'name').text] : [];
    },
    visibility: (n, name) => (/^[A-Z]/.test(name) ? 'public' : 'package'),
    throwCalls: ['panic'],
  },
  rust: {
    functions: set('function_item'),
    types: { impl_item: 'impl', trait_item: 'trait', struct_item: 'struct', enum_item: 'enum' },
    typeName: n => (n.type === 'impl_item' ? typeOf(n) : nameField(n)),
    self: ['self'],
    visibility: n =>
      n.type === 'impl_item' || n.children.some(c => c.type === 'visibility_modifier') ? 'public' : 'private',
    isStatic: n => !field(n, 'parameters')?.namedChildren.some(p => p.type === 'self_parameter'),
    throwCalls: ['panic', 'unreachable', 'todo', 'unimplemented'],
  },
  c: {
    functions: set('function_definition'),
    types: { struct_specifier: 'struct', union_specifier: 'union', enum_specifier: 'enum' },
    functionName: cName,
    visibility: n =>
      n.children.some(c => c.type === 'storage_class_specifier' && c.text === 'static') ? 'private' : 'public',
    throwCalls: ['abort', 'exit'],
  },
  cpp: {
    functions: set('function_definition'),
    types: { class_specifier: 'class', struct_specifier: 'struct', union_specifier: 'union', enum_specifier: 'enum' },
    functionName: cName,
    self: ['this'],
    defaultVisibility: type => (type.type === 'class_specifier' ? 'private' : 'public'),
    visibilitySwitch: c => (c.type === 'access_specifier' ? c.text.replace(':', '').trim() : null),
    isStatic: n => n.children.some(c => c.type === 'storage_class_specifier' && c.text === 'static'),
    ctor: (name, owner) => name === owner,
  },
  csharp: {
    functions: set('method_declaration', 'constructor_declaration', 'destructor_declaration', 'operator_declaration'),
    types: {
      class_declaration: 'class',
      struct_declaration: 'struct',
      interface_declaration: 'interface',
      record_declaration: 'record',
      enum_declaration: 'enum',
    },
    self: ['this'],
    visibility: javaLikeVisibility('private'),
    isStatic: n => modifierWords(n).includes('static'),
    ctor: (name, owner, n) => n.type === 'constructor_declaration',
  },
  ruby: {
    functions: set('method', 'singleton_method'),
    types: { class: 'class', module: 'module' },
    self: ['self'],
    defaultVisibility: () => 'public',
    visibilitySwitch: c =>
      c.type === 'identifier' && ['private', 'protected', 'public'].includes(c.text) ? c.text : null,
    isStatic: n => n.type === 'singleton_method',
    ctor: name => name === 'initialize',
    throwCalls: ['raise', 'fail'],
  },
  php: {
    functions: set('function_definition', 'method_declaration'),
    types: {
      class_declaration: 'class',
      interface_declaration: 'interface',
      trait_declaration: 'trait',
      enum_declaration: 'enum',
    },
    self: ['$this', 'self', 'static'],
    visibility: javaLikeVisibility('public'),
    isStatic: n => modifierWords(n).includes('static'),
    ctor: name => name === '__construct',
  },
  kotlin: {
    functions: set('function_declaration', 'secondary_constructor'),
    types: { class_declaration: 'class', object_declaration: 'object', companion_object: 'object' },
    typeName: n => nameField(n) || (n.type === 'companion_object' ? 'Companion' : null),
    functionName: n => ({ name: n.type === 'secondary_constructor' ? 'constructor' : nameField(n) }),
    self: ['this'],
    visibility: javaLikeVisibility('public'),
    isStatic: (n, owner) => owner?.sub === 'object',
    ctor: (name, owner, n) => n.type === 'secondary_constructor',
  },
  scala: {
    functions: set('function_definition'),
    types: {
      class_definition: 'class',
      object_definition: 'object',
      trait_definition: 'trait',
      enum_definition: 'enum',
    },
    self: ['this'],
    visibility: javaLikeVisibility('public'),
    isStatic: (n, owner) => owner?.sub === 'object',
  },
  lua: {
    functions: set('function_declaration'),
    types: {},
    functionName: n => {
      const target = field(n, 'name');
      if (!target) return null;
      if (target.type === 'dot_index_expression' || target.type === 'method_index_expression')
        return {
          name: field(target, 'field', 'method')?.text || simple(target.text),
          owner: field(target, 'table')?.text,
          static: target.type === 'dot_index_expression',
        };
      return { name: target.text };
    },
    self: ['self'],
    visibility: n => (n.parent?.type === 'local_declaration' || /^local\b/.test(n.text) ? 'private' : 'public'),
    throwCalls: ['error'],
  },
};
const hasBody = n =>
  n.type === 'type_spec' ||
  n.type === 'impl_item' ||
  !!field(n, 'body') ||
  n.namedChildren.some(c => /(_body|declaration_list)$/.test(c.type));
const rulesFor = id =>
  RULES[id] ||
  (() => {
    throw new Error(`No syntax rules for ${id}.`);
  })();

// Parameters, without the receiver some languages spell out (self, &self).
function paramCount(n, selfNames) {
  let holder = n;
  // C and C++ keep the parameter list on the function declarator.
  while (holder && !field(holder, 'parameters') && field(holder, 'declarator')) holder = field(holder, 'declarator');
  const list = field(holder, 'parameters') || n.namedChildren.find(c => /parameters$/.test(c.type));
  return named(list).filter(p => p.type !== 'self_parameter' && !selfNames.includes(p.text.replace(/[:\s].*$/s, '')))
    .length;
}

// What a call calls: { name, receiver } with receiver null for a bare call.
export function callee(n) {
  const receiver = field(n, 'object', 'receiver', 'scope');
  if (receiver) return { name: field(n, 'name', 'method')?.text || null, receiver };
  let fn = field(n, 'function', 'name', 'method') || named(n)[0];
  if (!fn) return { name: null, receiver: null };
  if (fn.type === 'generic_name' || fn.type === 'generic_function') fn = fn.namedChildren[0] || fn;
  if (IDENTIFIER.test(fn.type) || !fn.namedChildCount) return { name: simple(fn.text), receiver: null };
  const parts = named(fn);
  return {
    name: field(fn, ...MEMBER_FIELDS)?.text?.replace(/^[.:]+/, '') || simple(parts.at(-1)?.text || fn.text),
    receiver: field(fn, ...RECEIVER_FIELDS) || (parts.length > 1 ? parts[0] : null),
  };
}
const argCount = n => named(field(n, 'arguments') || n.namedChildren.find(c => /arguments$/.test(c.type))).length;
const isSelf = (node, selfNames) => !!node && (SELF.has(node.type) || selfNames.includes(node.text));

// ---------- symbols: declarations and per-function measurements ----------
// resolve(name) → path of the analyzed file that declares that name (or null).
export function syntaxSymbols(tree, id, { resolve = () => null } = {}) {
  const rules = rulesFor(id),
    root = tree.rootNode,
    decls = [],
    byName = new Map(),
    calledMembers = new Set(),
    names = new Set();
  const cache = new Map();
  const resolved = name => {
    if (!cache.has(name)) cache.set(name, resolve(name) || null);
    return cache.get(name);
  };

  function measure(body, selfNames) {
    let branches = 0;
    const uses = new Set(),
      selfCalls = new Set(),
      sigs = new Set();
    (function visit(n) {
      if (BRANCH.has(n.type)) branches++;
      else if (LOGICAL.has(field(n, 'operator')?.text || field(n, 'operator')?.type)) branches++;
      if (CALL.has(n.type)) {
        const { name, receiver } = callee(n);
        if (name) {
          if (receiver && !isSelf(receiver, selfNames)) calledMembers.add(name);
          else {
            selfCalls.add(name);
            sigs.add(name + '/' + argCount(n));
          }
        }
      } else if (IDENTIFIER.test(n.type) && !n.namedChildCount) {
        const hit = resolved(n.text);
        if (hit) uses.add(hit);
      }
      for (const c of n.namedChildren) visit(c);
    })(body);
    return { branches, uses: [...uses], selfCalls: [...selfCalls], sigs: [...sigs] };
  }

  function typeDecl(name, node, sub, vis) {
    let decl = byName.get(name);
    // An impl block and the struct or enum it implements are one planet region.
    if (decl && (sub === 'impl' || decl.sub === 'impl')) {
      if (decl.sub === 'impl') Object.assign(decl, { sub, exported: vis !== 'private' });
      decl.start = Math.min(decl.start, line(node));
      decl.end = Math.max(decl.end, endLine(node));
      return decl;
    }
    if (decl && decl.synthetic) {
      Object.assign(decl, { sub, start: line(node), end: endLine(node), exported: vis !== 'private' });
      delete decl.synthetic;
      return decl;
    }
    decl = {
      kind: 'class',
      sub,
      name,
      start: line(node),
      end: endLine(node),
      exported: vis !== 'private',
      members: [],
    };
    byName.set(name, decl);
    decls.push(decl);
    return decl;
  }
  // Methods declared outside their type (Go receivers, C++ Type::method, Lua tables) join that type's planet region.
  function ownerFor(name, node) {
    if (byName.has(name)) return byName.get(name);
    const decl = {
      kind: 'class',
      sub: 'type',
      name,
      start: line(node),
      end: endLine(node),
      exported: true,
      members: [],
    };
    decl.synthetic = true;
    byName.set(name, decl);
    decls.push(decl);
    return decl;
  }

  function declareFunction(n, owner, vis) {
    const info = rules.functionName ? rules.functionName(n) : { name: nameField(n) };
    if (!info?.name) return;
    const ownerName = info.owner || rules.owner?.(n);
    if (ownerName) owner = ownerFor(simple(ownerName), n);
    const body = field(n, 'body') || n.namedChildren.find(c => BLOCK.has(c.type));
    if (!body) return; // signatures without a body have no executable town
    const selfNames = [...(rules.self || []), ...(rules.receiverNames?.(n) || [])];
    const record = {
      name: info.name,
      start: line(n),
      end: endLine(n),
      sourceStart: n.startIndex,
      sourceEnd: n.endIndex,
      vis: rules.visibility ? rules.visibility(n, info.name) : vis || 'public',
      static: info.static ?? !!rules.isStatic?.(n, owner),
      params: paramCount(n, selfNames),
      ...measure(body, selfNames),
    };
    if (owner) {
      record.kind = rules.ctor?.(info.name, simple(owner.name), n) ? 'ctor' : 'method';
      owner.members.push(record);
      if (owner.end < record.end) owner.end = record.end;
    } else {
      record.kind = 'function';
      record.exported = record.vis !== 'private';
      decls.push(record);
      names.add(info.name);
    }
  }

  function visit(node, owner) {
    let vis = owner ? rules.defaultVisibility?.(owner.node) : null;
    for (const c of node.namedChildren) {
      if (COMMENT.test(c.type)) continue;
      const switched = owner && rules.visibilitySwitch?.(c);
      if (switched) {
        vis = switched;
        continue;
      }
      if (rules.functions.has(c.type)) {
        declareFunction(c, owner?.decl || null, vis);
        continue;
      }
      const sub = rules.types[c.type];
      const typeName = sub && (rules.typeName ? rules.typeName(c) : nameField(c));
      // A type reference such as `struct point p;` has no body; only definitions declare.
      if (typeName && hasBody(c)) {
        const qualified = owner && sub !== 'impl' ? owner.decl.name + '.' + simple(typeName) : simple(typeName);
        const decl = typeDecl(qualified, c, rules.typeSub?.(c) || sub, rules.visibility?.(c, simple(typeName)));
        if (!owner) names.add(simple(typeName));
        visit(c, { decl, node: c });
        continue;
      }
      visit(c, owner);
    }
  }
  visit(root, null);

  // A type with executable members is a planet region source; a bodiless one is a moon. Empty impl blocks and
  // modules that only group other declarations are neither.
  const out = decls.filter(
    d => d.kind !== 'class' || d.members.length || !['impl', 'module', 'object'].includes(d.sub),
  );
  for (const d of out) {
    delete d.synthetic;
    if (d.kind === 'class' && !d.members.length) {
      d.kind = ['interface', 'trait'].includes(d.sub) ? 'interface' : d.sub === 'enum' ? 'enum' : 'type';
      delete d.members;
    }
  }

  // Files this one refers to: [runtime, type-only, 0], like the TypeScript and Java models.
  const refs = {};
  (function count(n) {
    if (IDENTIFIER.test(n.type) && !n.namedChildCount) {
      const hit = resolved(n.text);
      if (hit) (refs[hit] ||= [0, 0, 0])[/type/.test(n.type) || /type/.test(n.parent?.type || '') ? 1 : 0]++;
    }
    for (const c of n.namedChildren) count(c);
  })(root);
  return { decls: out, calls: [...calledMembers], refs, names: [...names] };
}

// ---------- control flow of one function (the shape extractJavaFlow and towns.js use) ----------
export function extractSyntaxFlow(tree, source, member, id) {
  const rules = rulesFor(id);
  const lines = source.split('\n');
  let fn = null;
  (function find(n) {
    if (fn) return;
    if (rules.functions.has(n.type) && line(n) === member.start) {
      fn = n;
      return;
    }
    for (const c of n.namedChildren) if (line(c) <= member.start && endLine(c) >= member.start) find(c);
  })(tree.rootNode);
  const fnBody = fn && (field(fn, 'body') || fn.namedChildren.find(c => BLOCK.has(c.type)));
  if (!fnBody) return null;
  const selfNames = [...(rules.self || []), ...(rules.receiverNames?.(fn) || [])];
  const throwCalls = new Set(rules.throwCalls || []);

  const clean = raw =>
    raw
      .replace(/^(\/\/+|#+|--+|\/\*+)\s?|\*+\/$/g, '')
      .split('\n')
      .map(l => l.replace(/^\s*\*+\s?/, '').trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 90);
  const leading = st => {
    const out = [];
    let p = st.previousNamedSibling;
    while (p && COMMENT.test(p.type) && !lines[p.startPosition.row].slice(0, p.startPosition.column).trim()) {
      out.unshift(clean(p.text));
      p = p.previousNamedSibling;
    }
    return out.filter(Boolean);
  };

  function facts(n, skip) {
    const calls = [],
      writes = [],
      fields = new Set();
    (function visit(x) {
      if (skip && same(x, skip)) return;
      if (rules.functions.has(x.type) && !same(x, fn)) return;
      if (CALL.has(x.type)) {
        const { name, receiver } = callee(x);
        if (name)
          calls.push({
            name,
            self: !receiver || isSelf(receiver, selfNames),
            target: receiver && IDENTIFIER.test(receiver.type) ? receiver.text : null,
            argc: argCount(x),
          });
      } else if (ASSIGN.has(x.type)) {
        const left = field(x, 'left') || named(x)[0];
        if (left) writes.push(left.text);
      } else if (x.type === 'instance_variable') fields.add(x.text.replace(/^@/, ''));
      else {
        const receiver = field(x, ...RECEIVER_FIELDS);
        const member = receiver && field(x, 'field', 'attribute', 'name', 'property');
        if (member && isSelf(receiver, selfNames) && !CALL.has(x.parent?.type)) fields.add(member.text);
      }
      for (const c of x.namedChildren) if (!COMMENT.test(c.type)) visit(c);
    })(n);
    return { calls, writes, fields: [...fields] };
  }

  const base = (st, summary) => ({
    id: `${st.startIndex}:${st.endIndex}`,
    line: line(st),
    end: endLine(st),
    sourceStart: st.startIndex,
    sourceEnd: st.endIndex,
    summary: summary.replace(/\s+/g, ' ').trim(),
    context: [],
    comment: leading(st)[0] || null,
  });
  // Statements of a block, flattening wrapper lists (Go's statement_list, Kotlin's function_body).
  function seq(node) {
    if (!node) return [];
    if (!BLOCK.has(node.type)) return [item(node)];
    const only = named(node);
    if (only.length === 1 && BLOCK.has(only[0].type)) return seq(only[0]);
    return named(node).flatMap(c => (BLOCK.has(c.type) && c.type !== 'block' ? seq(c) : [item(c)]));
  }
  const bodyOf = n => field(n, 'body', 'consequence') || n.namedChildren.find(c => BLOCK.has(c.type)) || null;
  const conditionOf = n =>
    field(n, 'condition', 'value', 'subject') || n.namedChildren.find(c => c.type === 'when_subject') || null;

  // Python, PHP and Lua list elif/else clauses as siblings; each elif owns the clauses after it.
  function ifItem(st, inherited = null) {
    const cond = conditionOf(st);
    const rest = named(st).filter(c => !same(c, cond));
    const then = field(st, 'consequence', 'body') || rest[0] || null;
    let alternatives = inherited || st.childrenForFieldName('alternative').filter(Boolean);
    if (!alternatives.length && !ELSE_IF.has(st.type)) alternatives = rest.filter(c => !same(c, then));
    const elseItems = alternatives.flatMap((a, k) =>
      k > 0 && ELSE_IF.has(alternatives[0].type)
        ? []
        : ELSE_IF.has(a.type)
          ? [ifItem(a, alternatives.slice(k + 1))]
          : IF.has(a.type)
            ? [ifItem(a)]
            : ELSE.has(a.type)
              ? named(a).length === 1 && (IF.has(named(a)[0].type) || BLOCK.has(named(a)[0].type))
                ? IF.has(named(a)[0].type)
                  ? [ifItem(named(a)[0])]
                  : seq(named(a)[0])
                : field(a, 'body')
                  ? seq(field(a, 'body'))
                  : named(a).flatMap(c => seq(c))
              : seq(a),
    );
    return {
      ...base(st, cond ? stripParens(cond.text) : firstLine(st)),
      t: 'if',
      ...facts(cond || st, then),
      then: seq(then),
      else: alternatives.length ? elseItems : null,
    };
  }
  function caseBody(c) {
    if (c.type === 'match_arm') return seq(field(c, 'value'));
    const body = field(c, 'body', 'consequence');
    if (body) return seq(body);
    return named(c)
      .filter(x => !/pattern|label|condition|^when_condition$/.test(x.type))
      .filter(x => !same(x, field(c, 'value', 'pattern', 'condition')))
      .flatMap(x => (BLOCK.has(x.type) ? seq(x) : [item(x)]));
  }
  const isDefault = c =>
    c.type === 'default_case' ||
    c.type === 'default_statement' ||
    c.type === 'else' ||
    (c.type === 'when_entry' && !field(c, 'condition') && !c.namedChildren.some(x => /condition/.test(x.type))) ||
    /^(_|default)\b/.test(field(c, 'pattern')?.text || '') ||
    (c.type === 'switch_section' && /\bdefault\b/.test(firstLine(c))) ||
    (c.type === 'case_statement' && !field(c, 'value'));

  function item(st) {
    if (st.type === 'labeled_statement' && named(st).length > 1)
      return { ...item(named(st).at(-1)), label: named(st)[0].text };
    // An expression statement wrapping a compound expression (Rust, Kotlin) is that expression.
    const inner = st.type === 'expression_statement' && named(st).length === 1 ? named(st)[0] : null;
    if (inner && (IF.has(inner.type) || LOOP.has(inner.type) || SWITCH.has(inner.type) || TRY.has(inner.type)))
      return item(inner);
    if (IF.has(st.type) || ELSE_IF.has(st.type)) return ifItem(st);
    if (LOOP.has(st.type)) {
      const body = bodyOf(st),
        cond = field(st, 'condition');
      return {
        ...base(st, cond && !DO_WHILE.has(st.type) ? stripParens(cond.text) : firstLine(st)),
        t: 'loop',
        doWhile: DO_WHILE.has(st.type),
        ...facts(st, body),
        body: seq(body),
      };
    }
    if (SWITCH.has(st.type)) {
      const cond = conditionOf(st);
      const holder = field(st, 'body') || st;
      const cases = [];
      (function collect(n, depth) {
        for (const c of n.namedChildren) {
          if (CASE.has(c.type) || (c.type === 'else' && st.type === 'case')) cases.push(c);
          else if (depth < 2 && !same(c, cond)) collect(c, depth + 1);
        }
      })(holder, 0);
      return {
        ...base(st, cond ? stripParens(cond.text) : firstLine(st)),
        t: 'switch',
        hasDefault: cases.some(isDefault),
        arrow: st.type !== 'switch_statement',
        ...facts(cond || st, holder),
        cases: cases.map(caseBody),
      };
    }
    if (
      TRY.has(st.type) &&
      (st.type !== 'begin' || st.namedChildren.some(c => CATCH.has(c.type) || FINALLY.has(c.type)))
    ) {
      const catches = st.namedChildren.filter(c => CATCH.has(c.type)),
        fin = st.namedChildren.find(c => FINALLY.has(c.type));
      const body = field(st, 'body') || st.namedChildren.find(c => BLOCK.has(c.type));
      const bodyItems = body
        ? seq(body)
        : named(st)
            .filter(c => !CATCH.has(c.type) && !FINALLY.has(c.type) && !ELSE.has(c.type))
            .map(item);
      const clauses = catches.map(c => {
        const b = field(c, 'body') || c.namedChildren.find(x => BLOCK.has(x.type));
        if (b) return seq(b);
        const cases = c.namedChildren.find(x => x.type === 'case_block');
        return cases ? named(cases).flatMap(caseBody) : [];
      });
      return {
        ...base(st, firstLine(st)),
        t: 'try',
        catchTypes: catches.map(c => [
          firstLine(c)
            .replace(/[:{].*$/, '')
            .trim(),
        ]),
        body: bodyItems,
        handler: !clauses.length
          ? null
          : clauses.length === 1
            ? clauses[0]
            : [
                {
                  ...base(
                    catches[0],
                    catches
                      .map(c =>
                        firstLine(c)
                          .replace(/[:{].*$/, '')
                          .trim(),
                      )
                      .join(', '),
                  ),
                  t: 'switch',
                  catchSwitch: true,
                  hasDefault: true,
                  arrow: true,
                  calls: [],
                  writes: [],
                  fields: [],
                  cases: clauses,
                },
              ],
        finalizer: !fin
          ? []
          : field(fin, 'body') || fin.namedChildren.find(c => BLOCK.has(c.type))
            ? seq(field(fin, 'body') || fin.namedChildren.find(c => BLOCK.has(c.type)))
            : named(fin).map(item),
      };
    }
    if (BLOCK.has(st.type)) return { ...base(st, firstLine(st)), t: 'block', body: seq(st) };
    const found = facts(st);
    const type = (inner || st).type;
    const macro = (inner || st).type === 'macro_invocation' && field(inner || st, 'macro')?.text;
    const kind = RETURN.has(type)
      ? 'return'
      : THROW.has(type) || throwCalls.has(macro) || (found.calls[0]?.self && throwCalls.has(found.calls[0].name))
        ? 'throw'
        : DECL.has(type)
          ? 'decl'
          : JUMP.has(type)
            ? 'jump'
            : 'expr';
    return { ...base(st, firstLine(st)), t: 'stmt', kind, ...found, ...(kind === 'throw' ? { thrown: null } : {}) };
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
  return { body, hoods: merged.map(h => ({ ...h, scope: fn.startIndex })) };
}

// ---------- highlighting ----------
export function syntaxTokens(tree) {
  const tokens = [];
  (function visit(n) {
    if (STRING.test(n.type)) {
      tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-string' });
      return;
    }
    if (COMMENT.test(n.type)) return;
    if (n.childCount) {
      for (const c of n.children) visit(c);
      return;
    }
    if (NUMBER.test(n.type)) tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-number' });
    else if (
      (!n.isNamed && /^[a-z_]{2,}$/.test(n.type)) ||
      SELF.has(n.type) ||
      /^(true|false|nil|none|null)$/.test(n.type)
    )
      tokens.push({ start: n.startIndex, end: n.endIndex, cls: 'tok-keyword' });
  })(tree.rootNode);
  return tokens;
}
