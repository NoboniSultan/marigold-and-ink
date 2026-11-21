/**
 * Helpers for the owner-edited JSON files in content/. Problems are collected into one
 * ContentError so a single run of the seed shows everything that needs fixing.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export class ContentError extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[] = [], options?: ErrorOptions) {
    super(problems.length ? `${message}\n- ${problems.join('\n- ')}` : message, options);
    this.name = 'ContentError';
    this.problems = problems;
  }
}

/** Reads a JSON file and validates it, turning every failure into a readable ContentError. */
export async function readContentFile<T extends z.ZodType>(
  file: string,
  schema: T,
): Promise<z.infer<T>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new ContentError(`Can't read ${file}`, [], { cause: err });
  }
  return parseContent(text, schema, file);
}

export function parseContent<T extends z.ZodType>(
  text: string,
  schema: T,
  source: string,
): z.infer<T> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ContentError(`${source} is not valid JSON`, [], { cause: err });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ContentError(
      `${source} is invalid:`,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`),
    );
  }
  return result.data;
}
