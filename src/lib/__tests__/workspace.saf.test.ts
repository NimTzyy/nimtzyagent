import { WorkspaceError, createWorkspaceFolder, writeWorkspaceFile, type Workspace } from '../workspace';

/**
 * A stand-in for Android's Storage Access Framework.
 *
 * The point of the fake is to behave the way the real provider does in the two
 * ways that broke the agent: a child is addressed by a document id the provider
 * issued, so a URI built by joining a name onto its parent addresses nothing;
 * and `createDocument` on a name that is already there stores a second file
 * under an auto-renamed one, which is what left the user with `app (1)/src (1)`
 * copies of a project that was supposed to be updated in place.
 */
// Type-only, and named with the prefix the jest hoisting rule allows, so the
// factory below can annotate with it without being read as a captured value.
interface MockSafNode {
  name: string;
  uri: string;
  dir: boolean;
  children: Map<string, MockSafNode>;
  content?: string;
}

jest.mock('expo-file-system', () => {
  const TREE_URI = 'content://test.documents/tree/primary%3AProjects';
  const nodes = new Map<string, MockSafNode>();

  function nodeFor(uri: string): MockSafNode | undefined {
    return nodes.get(uri);
  }

  /** The provider's document id for a child: the parent's id plus its name. */
  function childUri(parent: MockSafNode, name: string): string {
    const id = decodeURIComponent(parent.uri.split('/').pop() ?? '');
    return `${TREE_URI}/document/${encodeURIComponent(`${id}/${name}`)}`;
  }

  function register(parent: MockSafNode, name: string, dir: boolean): MockSafNode {
    const uri = childUri(parent, name);
    const existing = nodes.get(uri);
    if (existing) return existing;
    const node: MockSafNode = { name, uri, dir, children: new Map() };
    nodes.set(uri, node);
    parent.children.set(name, node);
    return node;
  }

  const root: MockSafNode = { name: 'Projects', uri: TREE_URI, dir: true, children: new Map() };
  nodes.set(TREE_URI, root);

  class Directory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return nodeFor(this.uri)?.dir === true;
    }

    list(): (Directory | File)[] {
      const node = nodeFor(this.uri);
      if (!node?.dir) throw new Error('not a directory');
      return [...node.children.values()].map((child) =>
        child.dir ? new Directory(child.uri) : new File(child.uri),
      );
    }

    createDirectory(name: string): Directory {
      const node = nodeFor(this.uri);
      if (!node?.dir) throw new Error('not a directory');
      // The provider renames rather than failing when the name is taken.
      let candidate = name;
      let suffix = 1;
      while (node.children.has(candidate)) candidate = `${name} (${suffix++})`;
      return new Directory(register(node, candidate, true).uri);
    }

    createFile(name: string, _mime: string): File {
      const node = nodeFor(this.uri);
      if (!node?.dir) throw new Error('not a directory');
      let candidate = name;
      let suffix = 1;
      while (node.children.has(candidate)) candidate = `${name} (${suffix++})`;
      return new File(register(node, candidate, false).uri);
    }

    static async pickDirectoryAsync(): Promise<Directory> {
      return new Directory(TREE_URI);
    }
  }

  class File {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      const node = nodeFor(this.uri);
      return node !== undefined && !node.dir;
    }

    write(content: string): void {
      const node = nodeFor(this.uri);
      // The real API creates the document here, and that is what throws for a
      // content URI the provider never issued.
      if (!node || node.dir) throw new Error('no such document');
      node.content = content;
    }
  }

  return {
    Directory,
    File,
    __saf: {
      reset(): void {
        root.children.clear();
        for (const uri of [...nodes.keys()]) if (uri !== TREE_URI) nodes.delete(uri);
      },
      files(): Record<string, string> {
        const out: Record<string, string> = {};
        const walk = (node: MockSafNode, prefix: string) => {
          for (const child of node.children.values()) {
            const path = prefix ? `${prefix}/${child.name}` : child.name;
            if (child.dir) walk(child, path);
            else out[path] = child.content ?? '';
          }
        };
        walk(root, '');
        return out;
      },
      directories(): string[] {
        const out: string[] = [];
        const walk = (node: MockSafNode, prefix: string) => {
          for (const child of node.children.values()) {
            if (!child.dir) continue;
            const path = prefix ? `${prefix}/${child.name}` : child.name;
            out.push(path);
            walk(child, path);
          }
        };
        walk(root, '');
        return out.sort();
      },
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

interface SafProbe {
  reset(): void;
  files(): Record<string, string>;
  directories(): string[];
}

const saf = (jest.requireMock('expo-file-system') as { __saf: SafProbe }).__saf;

const WORKSPACE: Workspace = {
  uri: 'content://test.documents/tree/primary%3AProjects',
  name: 'Projects',
};

beforeEach(() => {
  saf.reset();
});

describe('writing into a SAF workspace', () => {
  it('creates the folders along the way and reports them', async () => {
    const outcome = await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'console.log(1)');

    expect(outcome.path).toBe('app/src/main.ts');
    expect(outcome.createdFile).toBe(true);
    expect(outcome.createdFolders).toEqual(['app', 'app/src']);
    expect(saf.directories()).toEqual(['app', 'app/src']);
    expect(saf.files()).toEqual({ 'app/src/main.ts': 'console.log(1)' });
  });

  it('replaces a file that is already there instead of leaving a copy', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'first');
    const second = await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'second');

    expect(second.createdFile).toBe(false);
    expect(second.createdFolders).toEqual([]);
    expect(saf.files()).toEqual({ 'app/src/main.ts': 'second' });
    expect(saf.directories()).toEqual(['app', 'app/src']);
  });

  it('reuses a folder that is already there', async () => {
    await createWorkspaceFolder(WORKSPACE, 'app/components');
    const again = await createWorkspaceFolder(WORKSPACE, 'app/components');
    const nested = await createWorkspaceFolder(WORKSPACE, 'app/components/button');

    expect(again.created).toBe(false);
    expect(nested.created).toBe(true);
    expect(saf.directories()).toEqual(['app', 'app/components', 'app/components/button']);
  });

  it('reports only the levels that were new, by their whole path', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/readme.md', '# x');
    const deeper = await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'x');

    // `app` was already there; `app/src` was not, and saying just `src` would
    // name a folder the model cannot find from the root.
    expect(deeper.createdFolders).toEqual(['app/src']);
  });

  it('matches an existing name that differs only in case', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/main.ts', 'first');
    const second = await writeWorkspaceFile(WORKSPACE, 'App/Main.ts', 'second');

    // Android's storage does not distinguish case, so this is the same file.
    expect(second.createdFile).toBe(false);
    expect(saf.files()).toEqual({ 'app/main.ts': 'second' });
  });

  it('refuses to write a file where a folder of that name is', async () => {
    await createWorkspaceFolder(WORKSPACE, 'app/src');

    await expect(writeWorkspaceFile(WORKSPACE, 'app/src', 'x')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('refuses to walk a path through a file', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/main.ts', 'x');

    await expect(writeWorkspaceFile(WORKSPACE, 'app/main.ts/nested.ts', 'x')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('refuses a path that leaves the workspace', async () => {
    await expect(writeWorkspaceFile(WORKSPACE, '../escape.ts', 'x')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
    expect(saf.files()).toEqual({});
  });

  it('refuses a workspace whose grant is gone', async () => {
    const missing: Workspace = { uri: 'content://test.documents/tree/gone%3A', name: 'Gone' };

    await expect(writeWorkspaceFile(missing, 'app/main.ts', 'x')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });
});
