import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, FileMode } from 'expo-file-system';

import { strings } from './strings';

/**
 * The folder agent mode writes into.
 *
 * Android hands back a Storage Access Framework tree URI and keeps the grant
 * across restarts (`takePersistableUriPermission`). iOS hands back a
 * security-scoped bookmark that only lives for the session, so a stored
 * workspace has to be re-picked after the app restarts — `checkWorkspaceAccess`
 * is what surfaces that.
 */
const WORKSPACE_KEY = 'nimtzyagent.workspace.v1';

/** Bounds on a model-supplied path, so a bad argument cannot walk out or go deep. */
const MAX_PATH_CHARS = 200;
const MAX_SEGMENT_CHARS = 64;
const MAX_SEGMENTS = 12;

/** Output limits keep a single write small enough to render progress for. */
export const MAX_WRITE_CHARS = 512 * 1024;

export interface Workspace {
  /** The directory URI exactly as the picker returned it. */
  uri: string;
  /** Display name, captured at pick time so Settings renders without native calls. */
  name: string;
}

export type PickWorkspaceResult =
  | { status: 'picked'; workspace: Workspace }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface WriteOutcome {
  /** Sanitized path relative to the workspace root. */
  path: string;
  /** Folders created along the way, as paths relative to the root. */
  createdFolders: string[];
  /** Whether the file itself was created rather than overwritten. */
  createdFile: boolean;
  chars: number;
}

/** A directory reached below the workspace root, and which levels were new. */
interface ResolvedDirectory {
  directory: Directory;
  /**
   * The levels that did not exist and were created, as paths relative to the
   * root, in order. Each is the whole path, not just the level's own name, so
   * `app/components` is reported as itself and not as `components` — the model
   * reads these back and has to be able to act on them.
   */
  created: string[];
  /** What the directory held when it was reached, keyed by display name. */
  children: Map<string, Directory | File>;
}

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/**
 * Reduce a model-supplied path to a safe relative one, or reject it.
 *
 * This is the only gate between the model and the device's file system, so it
 * is deliberately strict: anything absolute, anything that climbs (`..`), and
 * anything carrying a URI scheme or control character is refused outright
 * rather than sanitized into something that happens to be safe. The native
 * layer checks for escapes again on real paths; on a SAF tree it cannot, so
 * the rule has to hold here.
 *
 * Returns `null` for a rejected path.
 */
export function sanitizeRelativePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_PATH_CHARS) return null;
  for (const character of trimmed) {
    const code = character.charCodeAt(0);
    // Control characters have no place in a file name, and a document
    // provider may truncate the name at one.
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (trimmed.includes('://')) return null;

  // Backslashes are separators on the platforms the model likes to imitate.
  const normalized = trimmed.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('~')) return null;
  if (/^[a-zA-Z]:\//.test(normalized)) return null;

  const segments: string[] = [];
  for (const raw of normalized.split('/')) {
    const segment = raw.trim();
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    if (segment.length > MAX_SEGMENT_CHARS) return null;
    segments.push(segment);
  }

  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  return segments.join('/');
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  const text = `${error.name} ${error.message} ${typeof code === 'string' ? code : ''}`;
  return /cancel/i.test(text);
}

/**
 * The name a provider knows a file or folder by, read off its URI.
 *
 * SAF addresses a child by document id, not by path, and the id is the parent's
 * id plus the child's display name — `primary:Download/app/src` for a folder
 * called `src`. There is no other way back to the name: the `name` accessor on
 * a `Directory` or `File` is the raw last path segment, which for SAF is the
 * whole still-encoded document id.
 *
 * Everything after the final slash is the name, except for the picked folder
 * itself, whose id carries a leading volume prefix (`primary:`).
 */
export function nameFromUri(uri: string): string | null {
  const last = uri.split('/').filter(Boolean).pop();
  if (!last) return null;

  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // A malformed escape is not worth failing an operation over; use it raw.
  }

  const tail = decoded.split('/').filter(Boolean).pop() ?? '';
  if (tail.length === 0) return null;

  // Only the first component of a document id has the volume in front of it.
  if (uri.startsWith('content:') && !decoded.includes('/')) {
    const withoutVolume = tail.replace(/^[a-zA-Z][\w-]*:/, '');
    return withoutVolume.length > 0 ? withoutVolume : null;
  }
  return tail;
}

/** A display name for the picked folder, for Settings to show. */
function displayNameFor(uri: string): string {
  return nameFromUri(uri) ?? strings.workspace.defaultName;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * What a directory holds, keyed by the name each entry is known by.
 *
 * This listing is how the workspace finds out whether something is already
 * there. Asking a joined-up URI instead — `new Directory(parent, name).exists`
 * — is not an option on Android: a SAF child has a document id that a string
 * join cannot build, and the URI it produces is one no provider answers for,
 * so every lookup would come back empty and every write would make a second
 * copy of what it was meant to replace.
 */
function childrenOf(directory: Directory): Map<string, Directory | File> {
  let entries: (Directory | File)[];
  try {
    entries = directory.list();
  } catch (error) {
    throw new WorkspaceError(
      `Could not read the contents of the folder: ${messageOf(error, 'the device refused it')}`,
    );
  }

  const children = new Map<string, Directory | File>();
  for (const entry of entries) {
    const name = nameFromUri(entry.uri);
    // The first entry to claim a name wins, which is what a lookup by name
    // means on a real file system.
    if (name !== null && !children.has(name)) children.set(name, entry);
  }
  return children;
}

/**
 * Find an entry by name, preferring an exact match.
 *
 * The fallback matters on Android: its storage is case-insensitive, so a model
 * that writes `App.tsx` where `app.tsx` already exists would otherwise miss it
 * and the provider would keep both. The scan only runs when the exact name is
 * absent, so the usual lookup is still a map hit. Providers that do
 * distinguish case keep both files, because the exact match is tried first.
 */
function lookupChild(
  children: Map<string, Directory | File>,
  name: string,
): Directory | File | undefined {
  const exact = children.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, entry] of children) {
    if (key.toLowerCase() === lower) return entry;
  }
  return undefined;
}

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    if (typeof parsed?.uri !== 'string' || parsed.uri.length === 0) return null;
    return {
      uri: parsed.uri,
      name:
        typeof parsed.name === 'string' && parsed.name.length > 0
          ? parsed.name
          : strings.workspace.defaultName,
    };
  } catch {
    return null;
  }
}

async function saveWorkspace(workspace: Workspace): Promise<void> {
  await AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}

export async function pickWorkspace(): Promise<PickWorkspaceResult> {
  try {
    const directory = await Directory.pickDirectoryAsync();
    const workspace: Workspace = { uri: directory.uri, name: displayNameFor(directory.uri) };
    await saveWorkspace(workspace);
    return { status: 'picked', workspace };
  } catch (error) {
    if (isCancellation(error)) return { status: 'cancelled' };
    return {
      status: 'error',
      message: error instanceof Error && error.message ? error.message : strings.workspace.pickFailed,
    };
  }
}

export async function clearWorkspace(): Promise<void> {
  await AsyncStorage.removeItem(WORKSPACE_KEY);
}

/**
 * Whether the folder can still be written to. Android keeps the grant, so this
 * is normally true; on iOS the grant dies with the session and the answer is
 * false until the user picks again.
 */
export async function checkWorkspaceAccess(workspace: Workspace): Promise<boolean> {
  try {
    return new Directory(workspace.uri).exists;
  } catch {
    return false;
  }
}

/**
 * Walk to a directory below the picked root, creating each level only when it
 * is missing.
 *
 * Levels are resolved one at a time against a listing of the level above, and
 * every object that comes back is one the API produced rather than one built
 * here. That matters on Android: a SAF child is addressed by a document id
 * that only the provider knows, so the object handed back by `createDirectory`
 * or found in a listing is the only handle that reaches the same folder later.
 */
function resolveDirectory(root: Directory, segments: string[]): ResolvedDirectory {
  let current = root;
  let children = childrenOf(root);
  const created: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const match = lookupChild(children, segment);
    if (match instanceof Directory) {
      current = match;
    } else if (match) {
      throw new WorkspaceError(
        `"${segment}" is a file, so it cannot be used as a folder.`,
      );
    } else {
      try {
        current = current.createDirectory(segment);
        created.push(segments.slice(0, index + 1).join('/'));
      } catch (error) {
        throw new WorkspaceError(
          `Could not create the folder "${segment}": ${messageOf(error, 'the device refused it')}`,
        );
      }
    }
    children = childrenOf(current);
  }

  return { directory: current, created, children };
}

function rootFor(workspace: Workspace): Directory {
  const root = new Directory(workspace.uri);
  let accessible = false;
  try {
    accessible = root.exists;
  } catch {
    accessible = false;
  }
  if (!accessible) throw new WorkspaceError(strings.workspace.accessLost);
  return root;
}

function splitFor(relativePath: string, label: string): string[] {
  const safe = sanitizeRelativePath(relativePath);
  if (!safe) throw new WorkspaceError(strings.workspace.badPath(label));
  return safe.split('/');
}

/**
 * Write a whole file through a file handle instead of `File.write`.
 *
 * On Android `FileSystemFile.write` opens with `if (!exists) { create() }`, and
 * `create()` refuses every `content://` URI outright — it is only there for
 * `file://` paths. `exists` comes from `DocumentFile.isFile()`, which in the
 * shipped androidx bytecode reads the provider's `mime_type` column and answers
 * false when that column is missing or unreadable:
 *
 *     val type = getRawType(context, self)
 *     if (MIME_TYPE_DIR == type) return false
 *     if (TextUtils.isEmpty(type)) return false
 *     return true
 *
 * So a provider that does not answer `mime_type` makes a file it is holding
 * itself read as missing, and the write throws inside `create()` before a byte
 * is written. From up here that is indistinguishable from a provider refusing
 * the write, which is why it is worth a second attempt rather than a better
 * error message.
 *
 * A handle goes straight to `contentResolver.openFileDescriptor(uri, "w")`,
 * which asks nothing about whether the document exists, and is the one write
 * path that cannot land in that branch. It only runs after the ordinary write
 * has already thrown, so a folder that works never reaches it.
 */
function writeThroughHandle(file: File, content: string): void {
  const handle = file.open(FileMode.WriteOnly);
  try {
    handle.writeBytes(new TextEncoder().encode(content));
  } finally {
    handle.close();
  }
}

export interface FolderOutcome {
  /** Sanitized path relative to the workspace root. */
  path: string;
  /** Whether the folder was created rather than already present. */
  created: boolean;
}

export async function createWorkspaceFolder(
  workspace: Workspace,
  relativePath: string,
): Promise<FolderOutcome> {
  const segments = splitFor(relativePath, 'folder');
  const root = rootFor(workspace);
  const resolved = resolveDirectory(root, segments);

  // The question is about the folder that was asked for, not about its
  // parents: `app/components/button` is a new folder even when `app` is not.
  const path = segments.join('/');
  return { path, created: resolved.created.includes(path) };
}

export async function writeWorkspaceFile(
  workspace: Workspace,
  relativePath: string,
  content: string,
): Promise<WriteOutcome> {
  if (content.length > MAX_WRITE_CHARS) throw new WorkspaceError(strings.workspace.tooLarge);

  const segments = splitFor(relativePath, 'file');
  const fileName = segments.pop();
  if (!fileName) throw new WorkspaceError(strings.workspace.badPath('file'));

  const root = rootFor(workspace);
  const resolved = resolveDirectory(root, segments);
  const parent = resolved.directory;

  // Writing a file that is already there replaces it. Finding it in the
  // parent's listing is what makes that work: a name addressed by joining it
  // onto the parent's URI answers for nothing, so the old contents would never
  // be found and every write would leave a second copy beside the first.
  const match = lookupChild(resolved.children, fileName);
  let file: File;
  let createdFile = false;

  if (match instanceof File) {
    file = match;
  } else if (match) {
    throw new WorkspaceError(`"${fileName}" is a folder, so it cannot be written as a file.`);
  } else {
    try {
      file = parent.createFile(fileName, mimeFor(fileName));
      createdFile = true;
    } catch (error) {
      throw new WorkspaceError(
        `Could not create "${fileName}": ${messageOf(error, 'the device refused it')}`,
      );
    }
  }

  try {
    file.write(content);
  } catch (error) {
    const direct = messageOf(error, 'the device refused it');
    try {
      writeThroughHandle(file, content);
    } catch (handleError) {
      const throughHandle = messageOf(handleError, '');
      throw new WorkspaceError(
        throughHandle && throughHandle !== direct
          ? `Could not write "${fileName}": ${direct} (a file handle failed too: ${throughHandle})`
          : `Could not write "${fileName}": ${direct}`,
      );
    }
  }

  return {
    path: [...segments, fileName].join('/'),
    createdFolders: resolved.created,
    createdFile,
    chars: content.length,
  };
}

/** The folder the self-test makes and then removes. */
const PROBE_FOLDER = '.nimtzyagent-check';
const PROBE_FILE = 'check.txt';

export interface WorkspaceCheck {
  ok: boolean;
  /** The step that did not finish, in the app's words. */
  step?: string;
  /** What the device said, when it said anything. */
  message?: string;
  /** True when the probe folder is still there because removing it failed. */
  leftBehind?: boolean;
}

/** Removes the probe folder, and says whether it managed to. */
async function removeProbe(workspace: Workspace): Promise<boolean> {
  try {
    const root = rootFor(workspace);
    resolveDirectory(root, PROBE_FOLDER.split('/')).directory.delete();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the real write path against the picked folder and report where it stops.
 *
 * This exists because a folder that opens is not the same as a folder that
 * takes a file, and the two are far apart in the native code: listing a
 * directory, creating one, and writing a file each go through different
 * `DocumentFile` implementations, and on Android a `content://` URI that
 * cannot create documents is not a permission problem — the grant is fine and
 * the provider is answering. Nothing in the app can tell those apart by looking,
 * so the only honest answer is to make the attempt and hand back the device's
 * own words for what went wrong.
 *
 * It writes into a folder of its own and removes it again, so a failure here
 * never touches the user's files.
 */
export async function testWorkspace(workspace: Workspace): Promise<WorkspaceCheck> {
  const relativePath = `${PROBE_FOLDER}/${PROBE_FILE}`;
  const written = 'NimTzyAgent wrote this to check the folder.';

  try {
    rootFor(workspace);
  } catch (error) {
    return { ok: false, step: strings.workspace.checkOpen, message: messageOf(error, '') };
  }

  try {
    await createWorkspaceFolder(workspace, PROBE_FOLDER);
  } catch (error) {
    return { ok: false, step: strings.workspace.checkFolder, message: messageOf(error, '') };
  }

  try {
    await writeWorkspaceFile(workspace, relativePath, written);
  } catch (error) {
    return {
      ok: false,
      step: strings.workspace.checkWrite,
      message: messageOf(error, ''),
      leftBehind: !(await removeProbe(workspace)),
    };
  }

  try {
    // Rewriting is a different path from writing: the file is found in the
    // listing first, and a file that cannot be found is created a second time
    // under a renamed copy instead.
    await writeWorkspaceFile(workspace, relativePath, `${written} Rewritten.`);
  } catch (error) {
    return {
      ok: false,
      step: strings.workspace.checkReplace,
      message: messageOf(error, ''),
      leftBehind: !(await removeProbe(workspace)),
    };
  }

  return { ok: true, leftBehind: !(await removeProbe(workspace)) };
}

/**
 * The mime type a SAF provider stores alongside the file. It only affects how
 * other apps open the result, so anything unrecognised is plain text.
 */
function mimeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  switch (extension) {
    case 'html':
    case 'htm':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'text/javascript';
    case 'json':
      return 'application/json';
    case 'md':
      return 'text/markdown';
    case 'xml':
    case 'svg':
      return 'application/xml';
    case 'csv':
      return 'text/csv';
    case 'yml':
    case 'yaml':
      return 'text/yaml';
    default:
      return 'text/plain';
  }
}
