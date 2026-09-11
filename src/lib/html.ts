/**
 * Pulls renderable documents out of a model reply.
 *
 * The chat renders markdown, which leaves a fenced block as literal code. That
 * is the right default — the reply stays copyable — but an HTML page or a
 * canvas sketch is something the user wants to see run. This finds those
 * blocks so a preview can be offered alongside the code, without the renderer
 * ever treating model output as markup.
 */

export interface HtmlBlock {
  /** Position among the html blocks of this message, from zero. */
  index: number;
  /** The fence's info string, lowercased. */
  language: string;
  content: string;
  /** A name read out of the document itself, when it carries one. */
  title?: string;
}

const HTML_LANGUAGES = new Set(['html', 'htm', 'xhtml']);

/** ```` ```html ````, `~~~html`, indented by up to three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;

/**
 * Fenced blocks are matched line by line rather than with one expression: a
 * closing fence has to be at least as long as the one that opened it, which is
 * how a block containing its own ``` survives the trip.
 */
export function extractHtmlBlocks(content: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  let fenceChar = '';
  let fenceLength = 0;
  let language = '';
  let body: string[] = [];
  let open = false;

  for (const line of content.split('\n')) {
    const fence = FENCE.exec(line);

    if (!open) {
      if (fence) {
        open = true;
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
        language = fence[2].toLowerCase();
        body = [];
      }
      continue;
    }

    const closes =
      fence !== null && fence[1][0] === fenceChar && fence[1].length >= fenceLength && !fence[2];
    if (closes) {
      if (HTML_LANGUAGES.has(language) && body.length > 0) {
        const block = body.join('\n');
        blocks.push({ index: blocks.length, language, content: block, title: titleOf(block) });
      }
      open = false;
      continue;
    }

    body.push(line);
  }

  // An unterminated block is a reply still arriving; it is not previewable yet.
  return blocks;
}

/**
 * A document ready to render in the preview.
 *
 * Model output is usually a fragment, and a fragment has no viewport, so it
 * would render at desktop width on a phone. A full document keeps its own
 * head; one is supplied only when the block has none.
 */
export function frameForPreview(content: string): string {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/<html[\s>]/i.test(content)) {
    if (/<head[\s>]/i.test(content)) {
      return content.replace(/<head([^>]*)>/i, `<head$1>${viewport}`);
    }
    return content.replace(/<html([^>]*)>/i, `<html$1><head>${viewport}</head>`);
  }
  return `<!doctype html><html><head>${viewport}</head><body>${content}</body></html>`;
}

const TAG = /<[^>]*>/g;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

function clean(text: string): string {
  return decodeEntities(text.replace(TAG, ' ')).replace(/\s+/g, ' ').trim();
}

/** The document's own idea of its name: its title, else its first heading. */
function titleOf(block: string): string | undefined {
  for (const pattern of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const match = pattern.exec(block);
    if (match) {
      const title = clean(match[1]);
      if (title.length > 0) return title.length <= 60 ? title : `${title.slice(0, 57).trimEnd()}...`;
    }
  }
  return undefined;
}
