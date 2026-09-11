import { formatSearchOutcome, searchWeb, SearchError, type SearchProvider } from './search';
import type { ToolDef } from './types';
import {
  createWorkspaceFolder,
  writeWorkspaceFile,
  WorkspaceError,
  type Workspace,
} from '@/lib/workspace';

import { strings } from '@/lib/strings';

/**
 * The functions this app offers the model.
 *
 * DeepSeek relays these definitions and returns calls, but nothing is executed
 * on the server: every call comes back here and runs on the device. That means
 * the guarantees are ours to keep — a file tool can only ever touch the folder
 * the user picked, and a search tool only ever spends its provider's quota.
 */

export const TOOL_NAMES = {
  search: 'search_web',
  folder: 'create_folder',
  write: 'write_file',
} as const;

export interface ToolAvailability {
  /** Web search, when a provider is configured. */
  research: boolean;
  /** File tools, when the user has turned agent mode on and picked a folder. */
  files: boolean;
}

export interface ToolContext extends ToolAvailability {
  searchProvider: SearchProvider;
  searchApiKey: string;
  workspace: Workspace | null;
  /** Aborted when the user stops the turn, so a slow call does not hold it open. */
  signal?: AbortSignal;
}

export interface ToolOutcome {
  status: 'ok' | 'error';
  /** What the model gets back as the tool message. */
  result: string;
}

const SEARCH_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: TOOL_NAMES.search,
    description:
      'Search the web and get back a few sources with short excerpts. Use it when the answer depends on facts that may have changed since training, such as current events, releases, prices, or documentation, and whenever the user asks you to look something up.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, written as a few specific keywords.',
        },
      },
      required: ['query'],
    },
  },
};

const FOLDER_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: TOOL_NAMES.folder,
    description:
      "Create a folder inside the user's workspace folder, including parents that do not exist yet. Use it when you want an empty folder or want the structure in place before writing files; write_file creates parents on its own, so it is not needed before every file.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Folder path relative to the workspace root, such as "notes" or "app/src".',
        },
      },
      required: ['path'],
    },
  },
};

const WRITE_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: TOOL_NAMES.write,
    description:
      "Write one text file inside the user's workspace folder, creating any missing parent folders and replacing the file if it already exists. Write the complete contents in a single call — files are not appended to. Call it once per file.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'File path relative to the workspace root, such as "app/src/main.ts". Absolute paths and ".." are refused.',
        },
        content: {
          type: 'string',
          description: 'The complete contents of the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
};

export function buildTools(availability: ToolAvailability): ToolDef[] {
  const tools: ToolDef[] = [];
  if (availability.research) tools.push(SEARCH_TOOL);
  if (availability.files) tools.push(FOLDER_TOOL, WRITE_TOOL);
  return tools;
}

/**
 * What the model is told it can do, sent ahead of every turn that has tools.
 *
 * A tool definition describes one function; it does not tell the model that
 * the app wants a project written to disk rather than pasted into the reply.
 * Left to itself a chat model answers a request for a website with a fenced
 * code block, which looks like the file tools being ignored. This is the app
 * stating the intent, and it is only sent when the matching tools are actually
 * attached, so it never describes something the model cannot do.
 *
 * Returns `null` when no tools are on, which keeps an ordinary chat's system
 * prompt exactly as the user wrote it.
 */
export function toolPreamble(
  availability: ToolAvailability,
  workspace: Workspace | null,
): string | null {
  const parts: string[] = [];
  if (availability.files) {
    parts.push(strings.agent.filePreamble(workspace?.name ?? strings.agent.none));
  }
  if (availability.research) parts.push(strings.agent.researchPreamble);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const BAD_ARGUMENTS = 'The arguments were not valid JSON. Call the tool again with correct arguments.';

async function runSearch(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const query = asString(args.query);
  if (query === null || query.trim().length === 0) {
    return { status: 'error', result: 'The "query" argument is required.' };
  }
  try {
    const outcome = await searchWeb(
      query,
      context.searchProvider,
      context.searchApiKey,
      context.signal,
    );
    return { status: 'ok', result: formatSearchOutcome(outcome) };
  } catch (error) {
    // A stopped turn is not a failure of the provider, and the model should
    // not be told to retry something the user cancelled.
    if (context.signal?.aborted) return { status: 'error', result: strings.agent.stopped };
    if (error instanceof SearchError) return { status: 'error', result: error.message };
    return { status: 'error', result: strings.research.failed };
  }
}

function requireWorkspace(context: ToolContext): Workspace {
  if (!context.workspace) throw new WorkspaceError(strings.workspace.missing);
  return context.workspace;
}

async function runCreateFolder(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const path = asString(args.path);
  if (path === null) return { status: 'error', result: 'The "path" argument is required.' };
  try {
    const outcome = await createWorkspaceFolder(requireWorkspace(context), path);
    return {
      status: 'ok',
      result: outcome.created ? `Created the folder "${outcome.path}".` : `The folder "${outcome.path}" already exists.`,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) return { status: 'error', result: error.message };
    return {
      status: 'error',
      result: error instanceof Error && error.message ? error.message : strings.agent.stepFailed,
    };
  }
}

async function runWriteFile(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const path = asString(args.path);
  if (path === null) return { status: 'error', result: 'The "path" argument is required.' };
  const content = asString(args.content);
  if (content === null) return { status: 'error', result: 'The "content" argument is required.' };

  try {
    const outcome = await writeWorkspaceFile(requireWorkspace(context), path, content);
    const parts = [
      outcome.createdFile ? `Created "${outcome.path}".` : `Updated "${outcome.path}".`,
      `${outcome.chars} characters written.`,
    ];
    if (outcome.createdFolders.length > 0) {
      parts.push(`Folders created: ${outcome.createdFolders.join(', ')}.`);
    }
    return { status: 'ok', result: parts.join(' ') };
  } catch (error) {
    if (error instanceof WorkspaceError) return { status: 'error', result: error.message };
    return {
      status: 'error',
      result: error instanceof Error && error.message ? error.message : strings.agent.stepFailed,
    };
  }
}

/**
 * Run one call. Failures come back as an error outcome rather than an
 * exception: the model is told what went wrong and gets to try again, and a
 * single bad call never ends the turn.
 */
export async function executeTool(
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolOutcome> {
  const args = parseArguments(rawArguments);
  if (!args) return { status: 'error', result: BAD_ARGUMENTS };

  switch (name) {
    case TOOL_NAMES.search:
      return runSearch(args, context);
    case TOOL_NAMES.folder:
      return runCreateFolder(args, context);
    case TOOL_NAMES.write:
      return runWriteFile(args, context);
    default:
      return { status: 'error', result: `There is no tool named "${name}".` };
  }
}

/** A short line describing a call, for the step chips under a message. */
export function describeToolCall(name: string, rawArguments: string): string {
  const args = parseArguments(rawArguments);
  if (name === TOOL_NAMES.search) {
    const query = args ? asString(args.query) : null;
    return query ? strings.agent.searched(query) : strings.agent.toolSearch;
  }
  const path = args ? asString(args.path) : null;
  const label = name === TOOL_NAMES.write ? strings.agent.toolWrite : strings.agent.toolFolder;
  return path ? `${label} · ${path}` : label;
}
