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
  // `*/*`, deliberately: any file can be chosen, and the app decides what it
  // can read. A MIME list here is enforced by the system picker rather than by
  // this app, and it hides files this app reads perfectly well — Android's
  // providers report code, markdown and log files as `application/octet-stream`,
  // which matches none of `text/*`, `application/json`, `application/xml` or
  // `application/javascript`, and iOS matches a listed type against its own
  // declarations, so `text/*` there means only what declares text conformance.
  // Either way the result is the same one users report: files they can see but
  // cannot choose. The checks below are the ones that should decide.
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return {};

  const asset = result.assets[0];
  const name = asset.name || 'file.txt';
  const mime = asset.mimeType ?? 'text/plain';
  const looksTextual = mime.startsWith('text/') || mime === 'application/json' || isTextFilename(name);
  if (!looksTextual) return { error: strings.chat.unsupportedFile };

  const file = new File(asset.uri);
  // Not every provider announces a size, and the one that does not is the one
  // whose file would otherwise be read into memory whole before being refused.
  let size = asset.size ?? 0;
  if (size === 0) {
    try {
      size = file.size ?? 0;
    } catch {
      size = 0;
    }
  }
  if (size > MAX_TEXT_ATTACHMENT_BYTES) return { error: strings.chat.fileTooLarge };

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { error: strings.chat.unreadableFile };
  }
  if (text.length > MAX_TEXT_ATTACHMENT_BYTES) return { error: strings.chat.fileTooLarge };

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
