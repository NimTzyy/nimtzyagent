import {
  createWorkspaceFolder,
  writeWorkspaceFile,
  WorkspaceError,
  type Workspace,
} from '@/lib/workspace';

import { strings } from '@/lib/strings';

import { searchWeb } from '../search';
import {
  buildTools,
  describeToolCall,
  executeTool,
  toolPreamble,
  TOOL_NAMES,
  type ToolContext,
} from '../tools';

jest.mock('@/lib/workspace', () => ({
  createWorkspaceFolder: jest.fn(),
  writeWorkspaceFile: jest.fn(),
  WorkspaceError: class WorkspaceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WorkspaceError';
    }
  },
}));

jest.mock('../search', () => ({
  ...jest.requireActual('../search'),
  searchWeb: jest.fn(),
}));

const mockSearch = searchWeb as jest.MockedFunction<typeof searchWeb>;
const mockWrite = writeWorkspaceFile as jest.MockedFunction<typeof writeWorkspaceFile>;
const mockFolder = createWorkspaceFolder as jest.MockedFunction<typeof createWorkspaceFolder>;

const workspace: Workspace = { uri: 'content://tree/picked', name: 'picked' };

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    research: true,
    files: true,
    searchProvider: 'wikipedia',
    searchApiKey: '',
    workspace,
    ...overrides,
  };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockWrite.mockReset();
  mockFolder.mockReset();
});

describe('buildTools', () => {
  it('offers nothing when both capabilities are off', () => {
    expect(buildTools({ research: false, files: false })).toEqual([]);
  });

  it('offers only the search tool for research', () => {
    const names = buildTools({ research: true, files: false }).map((tool) => tool.function.name);
    expect(names).toEqual([TOOL_NAMES.search]);
  });

  it('offers both file tools for agent mode', () => {
    const names = buildTools({ research: false, files: true }).map((tool) => tool.function.name);
    expect(names).toEqual([TOOL_NAMES.folder, TOOL_NAMES.write]);
  });

  it('describes every tool and marks the required arguments', () => {
    for (const tool of buildTools({ research: true, files: true })) {
      expect(tool.type).toBe('function');
      expect(tool.function.description.length).toBeGreaterThan(20);
      const parameters = tool.function.parameters as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(parameters.required.length).toBeGreaterThan(0);
      for (const name of parameters.required) {
        expect(parameters.properties[name]).toBeDefined();
      }
    }
  });
});

describe('describeToolCall', () => {
  it('names the search and quotes its query', () => {
    expect(describeToolCall(TOOL_NAMES.search, '{"query":"deepseek v4"}')).toBe(
      'Searched "deepseek v4"',
    );
  });

  it('shows the path for a write', () => {
    expect(describeToolCall(TOOL_NAMES.write, '{"path":"app/main.ts","content":"x"}')).toBe(
      'Write file · app/main.ts',
    );
  });

  it('falls back to the bare label when the arguments are unreadable', () => {
    expect(describeToolCall(TOOL_NAMES.write, '{oops')).toBe('Write file');
  });
});

describe('executeTool', () => {
  it('refuses an unknown tool instead of guessing', async () => {
    const outcome = await executeTool('delete_everything', '{}', context());
    expect(outcome.status).toBe('error');
    expect(outcome.result).toMatch(/no tool named/i);
  });

  it('reports unreadable arguments back to the model', async () => {
    const outcome = await executeTool(TOOL_NAMES.search, '{"query": ', context());
    expect(outcome.status).toBe('error');
    expect(outcome.result).toMatch(/valid JSON/i);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns the formatted sources for a search', async () => {
    mockSearch.mockResolvedValue({
      provider: 'wikipedia',
      query: 'deepseek',
      results: [{ title: 'DeepSeek', url: 'https://x.test', snippet: 'A company.' }],
    });

    const signal = new AbortController().signal;
    const outcome = await executeTool(
      TOOL_NAMES.search,
      '{"query":"deepseek"}',
      context({ signal }),
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.result).toContain('[1] DeepSeek');
    // The turn's signal reaches the request, so stopping cancels the search
    // rather than leaving it to time out on its own.
    expect(mockSearch).toHaveBeenCalledWith('deepseek', 'wikipedia', '', signal);
  });

  it('passes the key and provider through to the search', async () => {
    mockSearch.mockResolvedValue({
      provider: 'serper',
      query: 'x',
      results: [{ title: 'A', url: '', snippet: 's' }],
    });
    await executeTool(
      TOOL_NAMES.search,
      '{"query":"x"}',
      context({ searchProvider: 'serper', searchApiKey: 'k' }),
    );
    expect(mockSearch).toHaveBeenCalledWith('x', 'serper', 'k', undefined);
  });

  it('turns a search failure into a result the model can react to', async () => {
    mockSearch.mockRejectedValue(new Error('nope'));
    const outcome = await executeTool(TOOL_NAMES.search, '{"query":"x"}', context());
    expect(outcome.status).toBe('error');
    expect(outcome.result.length).toBeGreaterThan(0);
  });

  it('requires a query', async () => {
    const outcome = await executeTool(TOOL_NAMES.search, '{}', context());
    expect(outcome.status).toBe('error');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('writes a file and reports what happened', async () => {
    mockWrite.mockResolvedValue({
      path: 'app/main.ts',
      createdFolders: ['app'],
      createdFile: true,
      chars: 12,
    });

    const outcome = await executeTool(
      TOOL_NAMES.write,
      '{"path":"app/main.ts","content":"console.log(1)"}',
      context(),
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.result).toContain('Created "app/main.ts"');
    expect(outcome.result).toContain('Folders created: app');
    expect(mockWrite).toHaveBeenCalledWith(workspace, 'app/main.ts', 'console.log(1)');
  });

  it('says updated rather than created when the file was already there', async () => {
    mockWrite.mockResolvedValue({
      path: 'a.txt',
      createdFolders: [],
      createdFile: false,
      chars: 3,
    });
    const outcome = await executeTool(TOOL_NAMES.write, '{"path":"a.txt","content":"abc"}', context());
    expect(outcome.result).toContain('Updated "a.txt"');
  });

  it('requires both path and content', async () => {
    const missingContent = await executeTool(TOOL_NAMES.write, '{"path":"a.txt"}', context());
    expect(missingContent.status).toBe('error');
    const missingPath = await executeTool(TOOL_NAMES.write, '{"content":"x"}', context());
    expect(missingPath.status).toBe('error');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses file tools when no folder has been chosen', async () => {
    const outcome = await executeTool(
      TOOL_NAMES.write,
      '{"path":"a.txt","content":"x"}',
      context({ workspace: null }),
    );
    expect(outcome.status).toBe('error');
    expect(outcome.result).toMatch(/Settings/i);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('reports a refused path in the model\'s own terms', async () => {
    mockWrite.mockRejectedValue(new WorkspaceError('That file path was refused.'));
    const outcome = await executeTool(
      TOOL_NAMES.write,
      '{"path":"../../etc/passwd","content":"x"}',
      context(),
    );
    expect(outcome.status).toBe('error');
    expect(outcome.result).toBe('That file path was refused.');
  });

  it('creates a folder and reports whether it was new', async () => {
    mockFolder.mockResolvedValue({ path: 'app/src', created: true });
    const created = await executeTool(TOOL_NAMES.folder, '{"path":"app/src"}', context());
    expect(created.status).toBe('ok');
    expect(created.result).toContain('Created the folder "app/src"');

    mockFolder.mockResolvedValue({ path: 'app/src', created: false });
    const existing = await executeTool(TOOL_NAMES.folder, '{"path":"app/src"}', context());
    expect(existing.result).toContain('already exists');
  });

  it('requires a path for a folder', async () => {
    const outcome = await executeTool(TOOL_NAMES.folder, '{}', context());
    expect(outcome.status).toBe('error');
    expect(mockFolder).not.toHaveBeenCalled();
  });
});

describe('toolPreamble', () => {
  const workspace: Workspace = { uri: 'content://x/tree/y', name: 'Projects' };

  it('says nothing when no tool is on', () => {
    expect(toolPreamble({ research: false, files: false }, workspace)).toBeNull();
  });

  it('names the folder and asks for files to be written rather than printed', () => {
    const preamble = toolPreamble({ research: false, files: true }, workspace);

    expect(preamble).toContain('Projects');
    expect(preamble).toContain('write_file');
    expect(preamble).toContain('instead of printing');
  });

  it('still describes the file tools when no folder is set', () => {
    // The tools are not offered without a folder, so this is the defensive
    // case: the sentence must not read "the workspace folder "null"".
    const preamble = toolPreamble({ research: false, files: true }, null);
    expect(preamble).toContain(strings.agent.none);
  });

  it('adds a search paragraph when research is on', () => {
    const preamble = toolPreamble({ research: true, files: false }, workspace);
    expect(preamble).toContain('search_web');
    expect(preamble).not.toContain('write_file');
  });
});
