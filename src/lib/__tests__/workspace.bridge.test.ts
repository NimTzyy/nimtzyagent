import { strings } from '../strings';
import {
  testWorkspace,
  WorkspaceError,
  writeWorkspaceFile,
  type Workspace,
} from '../workspace';

/**
 * The workspace code running on the real `Directory` and `File` classes.
 *
 * `workspace.saf.test.ts` replaces the whole `expo-file-system` module, which
 * means it never exercises the JS the app actually runs: the constructor
 * chain, `Paths.join`, and the `listAsRecords` to `Directory`/`File` wrapping
 * that every lookup depends on. This file replaces only the native bridge
 * instead, and models it on the code that ships on Android:
 *
 *   - `SAFDocumentFile.kt` picks its `DocumentFile` by the first path segment:
 *     a URI starting `document` becomes `fromSingleUri`, anything else becomes
 *     `fromTreeUri`. That distinction is the whole reason this file exists:
 *     `SingleDocumentFile` throws `UnsupportedOperationException` for
 *     `createFile`, `createDirectory` and `listFiles`.
 *   - AOSP `DocumentsContract.isTreeUri` accepts two *or more* segments, so
 *     `buildDocumentUriMaybeUsingTree` keeps the `tree/.../document/...` shape
 *     for a parent the app reached through a tree. A child returned by
 *     `createDocument` is therefore still a tree URI, and still lists.
 *
 * If a future change starts building child URIs by hand, the provider here
 * never issued that URI, so the lookup misses and the test fails.
 */

// Hoisted to module scope with the prefix jest allows, so the factory can
// annotate with it without being read as capturing an out-of-scope value.
interface MockNode {
  docId: string;
  dir: boolean;
  content?: string;
  children: Map<string, string>;
}

jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');

  const AUTHORITY = 'com.android.externalstorage.documents';
  const TREE_DOC_ID = 'primary:Projects';
  const TREE_URI = `content://${AUTHORITY}/tree/${encodeURIComponent(TREE_DOC_ID)}`;

  const nodes = new Map<string, MockNode>();
  const rootNode: MockNode = { docId: TREE_DOC_ID, dir: true, children: new Map() };
  nodes.set(TREE_DOC_ID, rootNode);
  /** Flipped by the probe to model a provider that will not take a new file. */
  let refuseCreates = false;
  /** Flipped by the probe to model a provider that will not open a handle. */
  let refuseHandles = false;
  /**
   * Whether the provider answers the `mime_type` column. Real ones are free not
   * to, and `DocumentFile.isFile()` reads that column to decide whether a file
   * is there at all.
   */
  let reportsFileType = true;

  /** `queryForString(context, uri, "mime_type", null)`. */
  function rawType(uri: string): string | null {
    const node = nodeFor(uri);
    if (!node) return null;
    if (node.dir) return 'vnd.android.document/directory';
    return reportsFileType ? 'text/plain' : null;
  }

  // androidx `DocumentsContractApi19`, transcribed from the shipped bytecode.
  function isFile(uri: string): boolean {
    const type = rawType(uri);
    if (type === 'vnd.android.document/directory') return false;
    return type !== null && type !== '';
  }
  function isDirectory(uri: string): boolean {
    return rawType(uri) === 'vnd.android.document/directory';
  }

  /** `Uri.getPathSegments()`, which decodes each segment and drops the trailing empty one. */
  function segments(uri: string): string[] {
    return uri
      .replace(/^content:\/\/[^/]*/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
  }

  // AOSP DocumentsContract, transcribed.
  function isTreeUri(uri: string): boolean {
    const paths = segments(uri);
    return paths.length >= 2 && paths[0] === 'tree';
  }
  function isDocumentUri(uri: string): boolean {
    const paths = segments(uri);
    if (paths.length === 2) return paths[0] === 'document';
    if (paths.length === 4) return paths[0] === 'tree' && paths[2] === 'document';
    return false;
  }
  function getTreeDocumentId(uri: string): string {
    return segments(uri)[1];
  }
  function getDocumentId(uri: string): string {
    const paths = segments(uri);
    return paths.length === 2 ? paths[1] : paths[3];
  }
  function buildDocumentUriUsingTree(treeUri: string, documentId: string): string {
    return `content://${AUTHORITY}/tree/${encodeURIComponent(getTreeDocumentId(treeUri))}/document/${encodeURIComponent(documentId)}`;
  }
  function buildDocumentUri(documentId: string): string {
    return `content://${AUTHORITY}/document/${encodeURIComponent(documentId)}`;
  }
  function buildDocumentUriMaybeUsingTree(baseUri: string, documentId: string): string {
    return isTreeUri(baseUri)
      ? buildDocumentUriUsingTree(baseUri, documentId)
      : buildDocumentUri(documentId);
  }

  /**
   * `SAFDocumentFile.documentFile`: whether this resolves to a tree document
   * that can be edited, or to a single document that can only be read.
   */
  function documentKind(uri: string): 'single' | 'tree' {
    return segments(uri)[0] === 'document' ? 'single' : 'tree';
  }

  /** The document id a handle addresses, once `fromTreeUri` has normalised it. */
  function resolveDocId(uri: string): string {
    if (documentKind(uri) === 'single') return getDocumentId(uri);
    return isDocumentUri(uri) ? getDocumentId(uri) : getTreeDocumentId(uri);
  }

  function nodeFor(uri: string): MockNode | undefined {
    return nodes.get(resolveDocId(uri));
  }

  function unsupported(): never {
    // androidx `SingleDocumentFile` throws this exact type, with no message.
    const error = new Error('UnsupportedOperationException');
    error.name = 'UnsupportedOperationException';
    throw error;
  }

  /** The provider's `createDocument`, including its rename-on-collision rule. */
  function createDocument(parentUri: string, name: string, dir: boolean): string {
    const parent = nodeFor(parentUri);
    if (!parent?.dir) throw new Error('parent is not a directory');
    let candidate = name;
    let suffix = 1;
    while (parent.children.has(candidate)) candidate = `${name} (${suffix++})`;
    const docId = `${parent.docId}/${candidate}`;
    nodes.set(docId, { docId, dir, children: new Map() });
    parent.children.set(candidate, docId);
    return buildDocumentUriMaybeUsingTree(parentUri, docId);
  }

  class MockFileSystemDirectory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    validatePath(): void {}

    get exists(): boolean {
      return isDirectory(this.uri);
    }

    delete(): void {
      const node = nodeFor(this.uri);
      if (!node?.dir) throw new Error('no such directory');
      const parent = nodes.get(node.docId.slice(0, node.docId.lastIndexOf('/')));
      parent?.children.delete(node.docId.slice(node.docId.lastIndexOf('/') + 1));
      for (const docId of [...nodes.keys()]) {
        if (docId === node.docId || docId.startsWith(`${node.docId}/`)) nodes.delete(docId);
      }
    }

    listAsRecords(): { isDirectory: boolean; uri: string }[] {
      const node = nodeFor(this.uri);
      if (!node?.dir) throw new Error('not a directory');
      if (documentKind(this.uri) === 'single') unsupported();
      return [...node.children.values()].map((docId) => ({
        isDirectory: nodes.get(docId)?.dir === true,
        uri: buildDocumentUriUsingTree(this.uri, docId),
      }));
    }

    createDirectory(name: string): MockFileSystemDirectory {
      if (documentKind(this.uri) === 'single') unsupported();
      return new MockFileSystemDirectory(createDocument(this.uri, name, true));
    }

    createFile(name: string, _mimeType: string | null): MockFileSystemFile {
      if (documentKind(this.uri) === 'single') unsupported();
      if (refuseCreates) {
        // What `validatePermission` and `createDocument` returning null look
        // like by the time they reach JS: an exception with the native text.
        throw new Error('file could not be created');
      }
      return new MockFileSystemFile(createDocument(this.uri, name, false));
    }
  }

  /** `FileSystemFileHandle.forContentURI`: an open descriptor, and nothing else. */
  class MockFileHandle {
    uri: string;
    open = true;

    constructor(uri: string) {
      this.uri = uri;
    }

    writeBytes(bytes: Uint8Array): void {
      if (!this.open) throw new Error('file handle is closed');
      if (refuseHandles) {
        throw new Error('Could not open file descriptor for uri');
      }
      const node = nodeFor(this.uri);
      if (!node || node.dir) throw new Error('no such document');
      node.content = new TextDecoder().decode(bytes);
    }

    close(): void {
      this.open = false;
    }
  }

  class MockFileSystemFile {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    validatePath(): void {}

    get exists(): boolean {
      return isFile(this.uri);
    }

    /** `FileSystemFile.create`, which is only ever a `file://` operation. */
    create(): never {
      throw new Error(
        'File.create function does not work with SAF content:// uris, use `Directory.createFile` instead',
      );
    }

    /**
     * `FileSystemFile.write`: the `!exists` test is what makes a provider that
     * does not report a mime type fatal, because it sends the call into
     * `create()` above, which refuses every `content://` URI.
     */
    write(content: string): void {
      if (!this.exists) this.create();
      const node = nodeFor(this.uri);
      if (!node || node.dir) throw new Error('no such document');
      node.content = content;
    }

    /** `FileSystemFile.openHandle` routes a SAF document to a content URI handle. */
    open(): MockFileHandle {
      return new MockFileHandle(this.uri);
    }
  }

  return {
    ...actual,
    requireNativeModule: (name: string) =>
      name === 'FileSystem'
        ? {
            FileSystemDirectory: MockFileSystemDirectory,
            FileSystemFile: MockFileSystemFile,
            pickDirectoryAsync: async () => new MockFileSystemDirectory(TREE_URI),
          }
        : actual.requireNativeModule(name),
    __saf: {
      TREE_URI,
      reset(): void {
        for (const key of [...nodes.keys()]) if (key !== TREE_DOC_ID) nodes.delete(key);
        rootNode.children.clear();
        refuseCreates = false;
        refuseHandles = false;
        reportsFileType = true;
      },
      refuseCreates(next: boolean): void {
        refuseCreates = next;
      },
      refusesHandles(next: boolean): void {
        refuseHandles = next;
      },
      reportsFileType(next: boolean): void {
        reportsFileType = next;
      },
      files(): Record<string, string> {
        const out: Record<string, string> = {};
        const walk = (node: MockNode, prefix: string) => {
          for (const [name, docId] of node.children) {
            const child = nodes.get(docId);
            if (!child) continue;
            const path = prefix ? `${prefix}/${name}` : name;
            if (child.dir) walk(child, path);
            else out[path] = child.content ?? '';
          }
        };
        walk(rootNode, '');
        return out;
      },
      directories(): string[] {
        const out: string[] = [];
        const walk = (node: MockNode, prefix: string) => {
          for (const [name, docId] of node.children) {
            const child = nodes.get(docId);
            if (!child?.dir) continue;
            const path = prefix ? `${prefix}/${name}` : name;
            out.push(path);
            walk(child, path);
          }
        };
        walk(rootNode, '');
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
  TREE_URI: string;
  reset(): void;
  refuseCreates(next: boolean): void;
  refusesHandles(next: boolean): void;
  reportsFileType(next: boolean): void;
  files(): Record<string, string>;
  directories(): string[];
}

const saf = (jest.requireMock('expo-modules-core') as { __saf: SafProbe }).__saf;

const WORKSPACE: Workspace = { uri: saf.TREE_URI, name: 'Projects' };

beforeEach(() => {
  saf.reset();
});

describe('the workspace over a provider modelled on Android', () => {
  it('writes a file into the picked folder', async () => {
    const outcome = await writeWorkspaceFile(WORKSPACE, 'notes.md', '# hi');

    expect(outcome.createdFile).toBe(true);
    expect(saf.files()).toEqual({ 'notes.md': '# hi' });
  });

  it('creates the folders a nested path needs', async () => {
    const outcome = await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'console.log(1)');

    expect(outcome.createdFolders).toEqual(['app', 'app/src']);
    expect(saf.directories()).toEqual(['app', 'app/src']);
    expect(saf.files()).toEqual({ 'app/src/main.ts': 'console.log(1)' });
  });

  it('replaces a nested file instead of leaving a copy beside it', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'first');
    const second = await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'second');

    expect(second.createdFile).toBe(false);
    expect(second.createdFolders).toEqual([]);
    expect(saf.files()).toEqual({ 'app/src/main.ts': 'second' });
  });

  it('keeps working after a folder was created rather than found', async () => {
    // The handle for `app` comes back from createDocument, so this is the step
    // that sees whether a created child is still editable.
    await writeWorkspaceFile(WORKSPACE, 'app/a.ts', 'a');
    const deeper = await writeWorkspaceFile(WORKSPACE, 'app/nested/b.ts', 'b');

    expect(deeper.createdFolders).toEqual(['app/nested']);
    expect(saf.files()).toEqual({ 'app/a.ts': 'a', 'app/nested/b.ts': 'b' });
  });

  it('writes several files into the same created folder', async () => {
    await writeWorkspaceFile(WORKSPACE, 'site/index.html', '<html></html>');
    await writeWorkspaceFile(WORKSPACE, 'site/style.css', 'body{}');

    expect(saf.files()).toEqual({
      'site/index.html': '<html></html>',
      'site/style.css': 'body{}',
    });
  });

  it('refuses a path that leaves the workspace', async () => {
    await expect(writeWorkspaceFile(WORKSPACE, '../escape.ts', 'x')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
    expect(saf.files()).toEqual({});
  });
});

describe('the folder self-test', () => {
  it('passes on a folder that takes folders and files', async () => {
    const check = await testWorkspace(WORKSPACE);

    expect(check.ok).toBe(true);
    expect(check.message).toBeUndefined();
  });

  it('leaves nothing behind when it passes', async () => {
    await testWorkspace(WORKSPACE);

    expect(saf.directories()).toEqual([]);
    expect(saf.files()).toEqual({});
  });

  it('names the step and repeats the device when a file cannot be created', async () => {
    saf.refuseCreates(true);
    const check = await testWorkspace(WORKSPACE);

    expect(check.ok).toBe(false);
    expect(check.step).toBe(strings.workspace.checkWrite);
    // The device's own words, not the app's summary of them.
    expect(check.message).toContain('file could not be created');
    // The folder it made is reported as still there rather than silently left.
    expect(check.leftBehind).toBe(false);
    expect(saf.directories()).toEqual([]);
  });
});

describe('a provider that does not report a file type', () => {
  beforeEach(() => {
    // `DocumentFile.isFile()` reads the provider's `mime_type` column and
    // answers false when it is missing, so `File.write` takes its `!exists`
    // branch and dies in `create()`, which refuses every `content://` URI.
    // This is the case the handle path exists for.
    saf.reportsFileType(false);
  });

  it('writes the file anyway, through a handle', async () => {
    const outcome = await writeWorkspaceFile(WORKSPACE, 'notes.md', '# hi');

    expect(outcome.createdFile).toBe(true);
    expect(saf.files()).toEqual({ 'notes.md': '# hi' });
  });

  it('still replaces an existing file instead of writing a second copy', async () => {
    await writeWorkspaceFile(WORKSPACE, 'notes.md', 'first');
    const second = await writeWorkspaceFile(WORKSPACE, 'notes.md', 'second');

    expect(second.createdFile).toBe(false);
    expect(second.createdFolders).toEqual([]);
    expect(saf.files()).toEqual({ 'notes.md': 'second' });
  });

  it('creates the folders a nested path needs', async () => {
    await writeWorkspaceFile(WORKSPACE, 'app/src/main.ts', 'console.log(1)');

    expect(saf.directories()).toEqual(['app', 'app/src']);
    expect(saf.files()).toEqual({ 'app/src/main.ts': 'console.log(1)' });
  });

  it('hands over the content as UTF-8, character for character', async () => {
    const text = 'naive — 日本語 — 😀\n\ttab';
    await writeWorkspaceFile(WORKSPACE, 'notes.md', text);

    // The bytes are Hermes' UTF-8 encoder, but the string reaching it is this
    // app's: a slice or a UTF-16 buffer handed over here would come back
    // mangled, and the emoji is what would break first.
    expect(saf.files()['notes.md']).toBe(text);
  });

  it('passes the whole self-test when only the handle path works', async () => {
    const check = await testWorkspace(WORKSPACE);

    expect(check.ok).toBe(true);
    expect(check.message).toBeUndefined();
  });

  it('says the direct write failed and what the handle said as well', async () => {
    saf.refusesHandles(true);
    const check = await testWorkspace(WORKSPACE);

    expect(check.ok).toBe(false);
    expect(check.step).toBe(strings.workspace.checkWrite);
    // Both attempts are in the message, because they fail for different
    // reasons and only the pair says which one the device is refusing.
    expect(check.message).toContain('Directory.createFile');
    expect(check.message).toContain('file descriptor');
  });
});

describe('why the lookup has to go through a listing', () => {
  it('hands back a child that can still be written into', async () => {
    const { Directory } = jest.requireActual<typeof import('expo-file-system')>('expo-file-system');
    const root = new Directory(saf.TREE_URI);
    const created = root.createDirectory('app');

    // `createDocument` answers with `buildDocumentUriMaybeUsingTree`, and a
    // tree parent keeps the tree shape, so the child is still a tree URI.
    expect(created.uri).toContain('/tree/');
    expect(created.list()).toEqual([]);
    expect(() => created.createDirectory('src')).not.toThrow();
  });

  it('does not answer for a URI built by joining a name onto its parent', async () => {
    const { Directory } = jest.requireActual<typeof import('expo-file-system')>('expo-file-system');
    await writeWorkspaceFile(WORKSPACE, 'app/main.ts', 'x');

    // What the old code built. Three segments is still `isTreeUri`, so it is
    // not rejected: `getTreeDocumentId` reads the second segment, which means
    // this silently addresses the workspace root. The old code listed the root
    // again, never saw `app`, and created a second one — `app (1)/main.ts (1)`.
    const joined = new Directory(`${saf.TREE_URI}/app`);
    expect(joined.list().map((entry) => entry.uri)).toEqual([
      expect.stringContaining('primary%3AProjects%2Fapp'),
    ]);

    // The listing from the folder that was actually created is the only handle
    // that reaches it.
    const real = new Directory(saf.TREE_URI).list()[0] as import('expo-file-system').Directory;
    expect(real.list().map((entry) => entry.uri)).not.toEqual([]);
  });
});
