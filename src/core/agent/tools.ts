// The agent's tools: their JSON Schemas (strict: every property listed, nothing extra), and a validator for the small
// part of JSON Schema they use. Inputs that fail come back as an error string, which becomes an error tool result:
// the model sees what was wrong and can try again.
import type { ToolSpec } from './wire.ts';

type Schema = {
  type?: 'object' | 'string' | 'integer' | 'array';
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  maxItems?: number;
  minItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  enum?: string[];
};

const str = (description: string, extra: Partial<Schema> = {}): Schema => ({ type: 'string', description, ...extra });
const int = (description: string): Schema => ({ type: 'integer', description, minimum: 1 });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const SCHEMAS: Record<string, { description: string; schema: Schema }> = {
  list_files: { description: 'List every file in the project, one path per line.', schema: obj({}) },
  read_file: {
    description: 'Read a file, or some of its lines. Lines are numbered from 1; the result shows each line with its number.',
    schema: obj({ path: str('The file, relative to the project root.'), start_line: int('First line to read.'), end_line: int('Last line to read.') }, ['path']),
  },
  search: {
    description: 'Find lines containing some exact text in the project (plain text, matched as written, upper and lower case included; no regular expressions). At most 200 results.',
    schema: obj({ pattern: str('The exact text to find.', { minLength: 1 }), path: str('A folder to search under, or one file.') }, ['pattern']),
  },
  find_function: {
    description: "Look a function up in the galaxy's own map of the project: where it is, which functions call it and which it calls. The map holds each file's most important functions; use search for anything it does not have.",
    schema: obj({ name: str('The function name, or part of it ("containsPosition", "Range.lift").', { minLength: 1 }) }),
  },
  replace_in_file: {
    description: 'Replace text that occurs exactly once in a file. Include enough surrounding text to make old_text unique. The user is shown the change as a diff and approves or declines it before this returns.',
    schema: obj({ path: str('The file.'), old_text: str('The exact text to replace.', { minLength: 1 }), new_text: str('The replacement.') }),
  },
  write_file: { description: 'Write a whole file, creating it if needed. The user approves or declines it before this returns.', schema: obj({ path: str('The file.'), content: str('Its full text.') }) },
  show_user: {
    description: "Point the user at a place in the code: the scene moves to the file, the function's code opens at the line and your message shows with it. Only the latest place stays open, so point at one place per step. Use it before explaining code.",
    schema: obj({ file: str('The file.'), line: int('The line to show.'), message: str('What to look at, in one or two sentences.', { minLength: 1, maxLength: 280 }) }, ['file', 'message']),
  },
  ask_user: {
    description: 'Ask the user one or more questions, each with options they can pinch. They may also answer by voice.',
    schema: obj({
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: obj(
          {
            id: str('A short id for the answer.', { minLength: 1 }),
            question: str('The question.', { minLength: 1 }),
            header: str('A two- or three-word heading.'),
            options: { type: 'array', maxItems: 12, items: obj({ label: str('The choice.', { minLength: 1 }), description: str('What it means.') }, ['label']) },
          },
          ['id', 'question'],
        ),
      },
    }),
  },
  update_plan: {
    description: 'Show or update your plan as a checklist. Send every step each time.',
    schema: obj({
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: obj({ text: str('The step.', { minLength: 1 }), status: { type: 'string', enum: ['pending', 'inProgress', 'completed'] } }),
      },
    }),
  },
  run_replay: {
    description: "Replay the open problem's recorded run step by step in the scene: 'failing' while the problem is open, 'fixed' once an approved edit has closed it. It is refused when the project has no problem card, or when 'fixed' is asked while the problem is still open.",
    schema: obj({ which: { type: 'string', enum: ['failing', 'fixed'] } }),
  },
};

export const TOOL_NAMES = Object.keys(SCHEMAS);
export type ToolName = keyof typeof SCHEMAS;

/** The tool list sent with every request, in a fixed order (byte-stable, so a provider can cache it). */
export const TOOLS: ToolSpec[] = TOOL_NAMES.map(name => ({
  name,
  description: SCHEMAS[name].description,
  input_schema: SCHEMAS[name].schema as Record<string, unknown>,
}));

function check(value: unknown, schema: Schema, at: string): string | null {
  if (schema.enum && !schema.enum.includes(value as string)) return `${at} must be one of ${schema.enum.join(', ')}.`;
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return `${at} must be text.`;
      if (schema.minLength != null && value.length < schema.minLength) return `${at} must not be empty.`;
      if (schema.maxLength != null && value.length > schema.maxLength) return `${at} must be at most ${schema.maxLength} characters.`;
      return null;
    case 'integer':
      if (!Number.isInteger(value)) return `${at} must be a whole number.`;
      if (schema.minimum != null && (value as number) < schema.minimum) return `${at} must be at least ${schema.minimum}.`;
      return null;
    case 'array': {
      if (!Array.isArray(value)) return `${at} must be a list.`;
      if (schema.minItems != null && value.length < schema.minItems) return `${at} must have at least ${schema.minItems} item.`;
      if (schema.maxItems != null && value.length > schema.maxItems) return `${at} must have at most ${schema.maxItems} items.`;
      for (let i = 0; i < value.length; i++) {
        const e = check(value[i], schema.items ?? {}, `${at}[${i}]`);
        if (e) return e;
      }
      return null;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${at} must be an object.`;
      const v = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (v[key] === undefined) return `${at === 'input' ? '' : at + '.'}${key} is required.`;
      for (const key of Object.keys(v)) {
        const sub = schema.properties?.[key];
        if (!sub) return `${at === 'input' ? '' : at + '.'}${key} is not a field of this tool.`;
        const e = check(v[key], sub, at === 'input' ? key : `${at}.${key}`);
        if (e) return e;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The input if it fits the tool's schema, else a sentence saying what is wrong. */
export function validateInput(name: string, input: unknown): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const spec = SCHEMAS[name];
  if (!spec) return { ok: false, error: `There is no tool called ${name}.` };
  const error = check(input, spec.schema, 'input');
  if (error) return { ok: false, error };
  const v = input as Record<string, unknown>;
  if (name === 'read_file' && v.start_line != null && v.end_line != null && (v.end_line as number) < (v.start_line as number))
    return { ok: false, error: 'end_line must not be before start_line.' };
  return { ok: true, input: v };
}

/** show_user's place, checked against the file's text: the file must exist and the line be in it. */
export function checkShowUser(input: { file: string; line?: number }, text: string | null): string | null {
  if (text == null) return `There is no file ${input.file}.`;
  const lines = text.split('\n').length;
  if (input.line != null && input.line > lines) return `${input.file} has ${lines} lines; line ${input.line} is past its end.`;
  return null;
}

/** A file's lines with their numbers, as read_file returns them. */
export function numbered(text: string, start = 1, end?: number): string {
  const lines = text.split('\n');
  const last = Math.min(end ?? lines.length, lines.length);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = Math.max(1, start); n <= last; n++) out.push(`${String(n).padStart(width)}\t${lines[n - 1]}`);
  return out.join('\n');
}
