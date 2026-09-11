import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { Attachment } from '@/core/types';

import { createId } from './id';
import { strings } from './strings';

/**
 * Images are downscaled before they are stored or sent. This keeps every
 * request far inside the 48 MiB body limit, stays close to the size the model
 * actually resolves internally, and bounds what the app keeps on disk.
 */
const MAX_EDGE = 1300;
const JPEG_QUALITY = 0.8;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const ATTACHMENT_DIR = 'attachments';

export interface PickOutcome {
  attachments: Attachment[];
  error?: string;
}

type AssetWithMeta = ImagePicker.ImagePickerAsset & { fileSize?: number; mimeType?: string };

function attachmentDirectory(): Directory {
  const directory = new Directory(Paths.document, ATTACHMENT_DIR);
  if (!directory.exists) directory.create();
  return directory;
}

function scaledSize(width: number, height: number): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE || longest === 0) return null;
  const scale = MAX_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function store(sourceUri: string, name: string, width: number, height: number): Promise<Attachment> {
  const resize = scaledSize(width, height);
  const result = await manipulateAsync(sourceUri, resize ? [{ resize }] : [], {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const destination = new File(attachmentDirectory(), `${createId()}.jpg`);
  await new File(result.uri).move(destination);
  let size = 0;
  try {
    size = destination.size ?? 0;
  } catch {
    size = 0;
  }
  return {
    id: createId(),
    kind: 'image',
    name,
    mime: 'image/jpeg',
    size,
    uri: destination.uri,
  };
}

export async function pickImage(source: 'library' | 'camera'): Promise<PickOutcome> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { attachments: [], error: strings.chat.permissionDenied };
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: 4,
        });

  if (result.canceled) return { attachments: [] };

  const attachments: Attachment[] = [];
  for (const asset of result.assets as AssetWithMeta[]) {
    if (asset.fileSize && asset.fileSize > MAX_SOURCE_BYTES) {
      return { attachments, error: strings.chat.imageTooLarge };
    }
    attachments.push(
      await store(asset.uri, asset.fileName ?? 'image.jpg', asset.width, asset.height),
    );
  }
  return { attachments };
}

export async function pasteImageFromClipboard(): Promise<PickOutcome> {
  const hasImage = await Clipboard.hasImageAsync();
  if (!hasImage) return { attachments: [], error: strings.chat.clipboardEmpty };

  const image = await Clipboard.getImageAsync({ format: 'jpeg' });
  if (!image?.data) return { attachments: [], error: strings.chat.clipboardEmpty };

  const attachment = await store(
    `data:image/jpeg;base64,${image.data}`,
    'pasted-image.jpg',
    image.size.width,
    image.size.height,
  );
  return { attachments: [attachment] };
}

/**
 * The base64 payload is built when a message is sent rather than stored, so
 * the database never carries megabytes of encoded image data. Encoding is
 * cached per attachment id: resending a conversation must not re-read every
 * image from disk on each turn.
 */
const dataUrlCache = new Map<string, string>();

export async function toDataUrl(uri: string, mime: string): Promise<string> {
  const base64 = await new File(uri).base64();
  return `data:${mime};base64,${base64}`;
}

export async function hydrateAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  const hydrated: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') {
      hydrated.push(attachment);
      continue;
    }
    if (attachment.dataUrl) {
      hydrated.push(attachment);
      continue;
    }
    const cached = dataUrlCache.get(attachment.id);
    if (cached) {
      hydrated.push({ ...attachment, dataUrl: cached });
      continue;
    }
    const dataUrl = await toDataUrl(attachment.uri, attachment.mime);
    dataUrlCache.set(attachment.id, dataUrl);
    hydrated.push({ ...attachment, dataUrl });
  }
  return hydrated;
}
