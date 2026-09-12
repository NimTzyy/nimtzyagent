import * as DocumentPicker from 'expo-document-picker';

import { strings } from '../strings';
import { MAX_TEXT_ATTACHMENT_BYTES, pickTextFile } from '../files';

/**
 * What the system picker hands back, keyed by URI.
 *
 * `size: null` is the case that matters: Android providers are free not to
 * report a size, and the file then has to be measured rather than trusted.
 */
interface MockPickedFile {
  size: number | null;
  text?: string;
  unreadable?: boolean;
}

const mockFiles = new Map<string, MockPickedFile>();

jest.mock('expo-file-system', () => {
  class File {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get size(): number | null {
      return mockFiles.get(this.uri)?.size ?? null;
    }

    async text(): Promise<string> {
      const file = mockFiles.get(this.uri);
      if (!file || file.unreadable || file.text === undefined) {
        throw new Error('could not read');
      }
      return file.text;
    }
  }

  return { File };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const mockPick = DocumentPicker.getDocumentAsync as jest.MockedFunction<
  typeof DocumentPicker.getDocumentAsync
>;

function pickerReturns(asset: {
  name: string;
  uri?: string;
  mimeType?: string;
  size?: number | null;
  text?: string;
  unreadable?: boolean;
}): void {
  const uri = asset.uri ?? `file:///cache/${asset.name}`;
  mockFiles.set(uri, {
    size: asset.size === undefined ? (asset.text?.length ?? null) : asset.size,
    text: asset.text,
    unreadable: asset.unreadable,
  });
  mockPick.mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size ?? undefined,
      },
    ],
  } as Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>);
}

beforeEach(() => {
  mockFiles.clear();
  mockPick.mockReset();
});

describe('pickTextFile', () => {
  // The bug this replaced: the picker was given a MIME list, and the system
  // applied it. Files this app reads fine — code, markdown, logs — were shown
  // greyed out and could not be chosen at all, which reads as the attach
  // button being broken.
  it('asks the system picker for any file, and decides for itself', async () => {
    pickerReturns({ name: 'notes.txt', mimeType: 'text/plain', text: 'hello' });

    await pickTextFile();

    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({ type: '*/*', copyToCacheDirectory: true, multiple: false }),
    );
  });

  it('accepts a code file the provider calls octet-stream', async () => {
    pickerReturns({ name: 'main.ts', mimeType: 'application/octet-stream', text: 'export {};' });

    const outcome = await pickTextFile();

    expect(outcome.error).toBeUndefined();
    expect(outcome.attachment).toMatchObject({
      kind: 'text',
      name: 'main.ts',
      text: 'export {};',
    });
  });

  it('accepts a file with no MIME type when the name says what it is', async () => {
    pickerReturns({ name: 'release-notes.md', mimeType: undefined, text: '# Notes' });

    const outcome = await pickTextFile();

    expect(outcome.attachment?.text).toBe('# Notes');
  });

  it('refuses a file that is not text, and says so', async () => {
    pickerReturns({ name: 'photo.png', mimeType: 'image/png', text: 'binary' });

    const outcome = await pickTextFile();

    expect(outcome.attachment).toBeUndefined();
    expect(outcome.error).toBe(strings.chat.unsupportedFile);
  });

  it('refuses an over-sized file without reading it', async () => {
    // `text` is present, so a read would succeed — the point is that it never
    // happens. Reading first and checking after is how a large file becomes a
    // crash rather than a message.
    pickerReturns({ name: 'huge.log', size: MAX_TEXT_ATTACHMENT_BYTES + 1, text: 'x' });

    const outcome = await pickTextFile();

    expect(outcome.error).toBe(strings.chat.fileTooLarge);
  });

  it('measures a file the provider did not size', async () => {
    pickerReturns({
      name: 'huge.log',
      size: null,
      text: 'x'.repeat(MAX_TEXT_ATTACHMENT_BYTES + 1),
    });

    const outcome = await pickTextFile();

    expect(outcome.error).toBe(strings.chat.fileTooLarge);
  });

  it('accepts a file the provider did not size but that is small enough', async () => {
    pickerReturns({ name: 'small.txt', size: null, text: 'ok' });

    const outcome = await pickTextFile();

    expect(outcome.attachment?.text).toBe('ok');
  });

  it('separates a file it cannot read from one it will not read', async () => {
    pickerReturns({ name: 'locked.txt', mimeType: 'text/plain', size: null, unreadable: true });

    const outcome = await pickTextFile();

    expect(outcome.error).toBe(strings.chat.unreadableFile);
  });

  it('says nothing at all when the picker was cancelled', async () => {
    mockPick.mockResolvedValueOnce({ canceled: true, assets: null } as Awaited<
      ReturnType<typeof DocumentPicker.getDocumentAsync>
    >);

    const outcome = await pickTextFile();

    expect(outcome).toEqual({});
  });
});
