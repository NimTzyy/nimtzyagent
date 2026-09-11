import { nameFromUri, sanitizeRelativePath } from '../workspace';

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

describe('sanitizeRelativePath', () => {
  it('keeps a plain relative path', () => {
    expect(sanitizeRelativePath('src/app/index.tsx')).toBe('src/app/index.tsx');
  });

  it('trims and collapses redundant separators', () => {
    expect(sanitizeRelativePath('  src//app/./index.tsx  ')).toBe('src/app/index.tsx');
  });

  it('treats backslashes as separators', () => {
    expect(sanitizeRelativePath('src\\app\\main.ts')).toBe('src/app/main.ts');
  });

  it('keeps a dotfile, which a project needs', () => {
    expect(sanitizeRelativePath('app/.gitignore')).toBe('app/.gitignore');
  });

  it('drops a trailing slash so a folder path and its name agree', () => {
    expect(sanitizeRelativePath('notes/')).toBe('notes');
  });

  it('refuses to climb out of the workspace', () => {
    expect(sanitizeRelativePath('../secrets')).toBeNull();
    expect(sanitizeRelativePath('src/../../etc/passwd')).toBeNull();
    expect(sanitizeRelativePath('..\\windows')).toBeNull();
  });

  it('refuses an absolute path', () => {
    expect(sanitizeRelativePath('/etc/passwd')).toBeNull();
    expect(sanitizeRelativePath('~/Documents')).toBeNull();
    expect(sanitizeRelativePath('/sdcard/Download/x')).toBeNull();
  });

  it('refuses a drive-letter path', () => {
    expect(sanitizeRelativePath('C:/Users/me/file.txt')).toBeNull();
    expect(sanitizeRelativePath('C:\\Users\\me\\file.txt')).toBeNull();
  });

  it('refuses another URI scheme', () => {
    expect(sanitizeRelativePath('content://com.android/whatever')).toBeNull();
    expect(sanitizeRelativePath('file:///etc/passwd')).toBeNull();
  });

  it('refuses control characters', () => {
    expect(sanitizeRelativePath('name\u0000.txt')).toBeNull();
    expect(sanitizeRelativePath('line\nbreak.txt')).toBeNull();
    expect(sanitizeRelativePath('bell\u0007.txt')).toBeNull();
  });

  it('refuses a path that is only separators or dots', () => {
    expect(sanitizeRelativePath('')).toBeNull();
    expect(sanitizeRelativePath('   ')).toBeNull();
    expect(sanitizeRelativePath('./')).toBeNull();
    expect(sanitizeRelativePath('/')).toBeNull();
  });

  it('refuses a path that is too deep', () => {
    const deep = Array.from({ length: 13 }, (_, index) => `d${index}`).join('/');
    expect(sanitizeRelativePath(deep)).toBeNull();
    const allowed = Array.from({ length: 12 }, (_, index) => `d${index}`).join('/');
    expect(sanitizeRelativePath(allowed)).toBe(allowed);
  });

  it('refuses an overlong path or segment', () => {
    expect(sanitizeRelativePath('a'.repeat(65))).toBeNull();
    expect(sanitizeRelativePath(`${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}/${'d'.repeat(20)}`)).toBeNull();
  });
});

describe('nameFromUri', () => {
  // Android addresses a document by id, and the id is the parent's path. These
  // are real SAF shapes: the tail is all the app ever gets to match on.
  const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADownload';

  it('reads the name off the tail of a document id', () => {
    expect(nameFromUri(`${TREE}/document/primary%3ADownload%2Fapp%2Fmain.ts`)).toBe('main.ts');
    expect(nameFromUri(`${TREE}/document/primary%3ADownload%2Fapp`)).toBe('app');
    expect(nameFromUri(`${TREE}/document/primary%3ADownload%2Fapp%2Fsrc%2Fcomponents`)).toBe(
      'components',
    );
  });

  it('drops the volume prefix on the picked folder itself', () => {
    expect(nameFromUri(TREE)).toBe('Download');
    // A volume root has no name of its own; the caller falls back to a label.
    expect(nameFromUri('content://com.android.externalstorage.documents/tree/primary%3A')).toBeNull();
  });

  it('decodes a name the provider escaped', () => {
    expect(nameFromUri(`${TREE}/document/primary%3ADownload%2Fhello%20world.html`)).toBe(
      'hello world.html',
    );
  });

  it('keeps the raw segment when an escape is malformed', () => {
    const uri = `${TREE}/document/primary%3ADownload%2F100%25bad%ZZ`;
    expect(() => nameFromUri(uri)).not.toThrow();
    expect(nameFromUri(uri)).not.toBeNull();
  });

  it('takes the last segment of a plain file URI too', () => {
    expect(nameFromUri('file:///data/user/0/app/index.tsx')).toBe('index.tsx');
  });

  it('returns null when there is no name to read', () => {
    expect(nameFromUri('')).toBeNull();
    expect(nameFromUri('content://')).toBeNull();
  });
});
