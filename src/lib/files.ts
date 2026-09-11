import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { isTextFilename } from '@/core/language';
import type { Attachment } from '@/core/types';

import { createId } from './id';
import { strings } from './strings';

/** Text files are inlined into the prompt, so the cap keeps rows and requests small. */
export const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024;

export interface FileOutcome {
  attachment?: Attachment;
  error?: string;
}

export async function pickTextFile(): Promise<FileOutcome> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/*', 'application/json', 'application/xml', 'application/javascript'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return {};

  const asset = result.assets[0];
  const name = asset.name || 'file.txt';
  const mime = asset.mimeType ?? 'text/plain';
  const looksTextual = mime.startsWith('text/') || mime === 'application/json' || isTextFilename(name);
  if (!looksTextual) return { error: strings.chat.unsupportedFile };
  if ((asset.size ?? 0) > MAX_TEXT_ATTACHMENT_BYTES) return { error: strings.chat.fileTooLarge };

  let text: string;
  try {
    text = await new File(asset.uri).text();
  } catch {
    return { error: strings.chat.unsupportedFile };
  }

  return {
    attachment: {
      id: createId(),
      kind: 'text',
      name,
      mime,
      size: asset.size ?? text.length,
      uri: asset.uri,
      text,
    },
  };
}
