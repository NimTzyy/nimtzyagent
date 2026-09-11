import { extractHtmlBlocks, frameForPreview } from '../html';

describe('extractHtmlBlocks', () => {
  it('finds a fenced html block', () => {
    const blocks = extractHtmlBlocks('Here you go:\n\n```html\n<p>hi</p>\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('<p>hi</p>');
    expect(blocks[0].language).toBe('html');
  });

  it('accepts htm and xhtml, and an uppercase info string', () => {
    expect(extractHtmlBlocks('```htm\n<b>x</b>\n```')[0].language).toBe('htm');
    expect(extractHtmlBlocks('```XHTML\n<b>x</b>\n```')[0].language).toBe('xhtml');
  });

  it('accepts a tilde fence', () => {
    expect(extractHtmlBlocks('~~~html\n<b>x</b>\n~~~')[0].content).toBe('<b>x</b>');
  });

  it('ignores other languages', () => {
    expect(extractHtmlBlocks('```python\nprint(1)\n```')).toHaveLength(0);
    expect(extractHtmlBlocks('```\nplain\n```')).toHaveLength(0);
  });

  it('keeps a longer fence from being closed early by its own backticks', () => {
    const markdown = '````html\n<script>const s = "```";</script>\n````';
    const blocks = extractHtmlBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('const s = "```"');
  });

  it('ignores an unterminated block, which is a reply still arriving', () => {
    expect(extractHtmlBlocks('```html\n<p>half')).toHaveLength(0);
  });

  it('numbers several blocks in order', () => {
    const markdown = '```html\n<p>one</p>\n```\ntext\n```html\n<p>two</p>\n```';
    const blocks = extractHtmlBlocks(markdown);
    expect(blocks.map((block) => block.index)).toEqual([0, 1]);
    expect(blocks.map((block) => block.content)).toEqual(['<p>one</p>', '<p>two</p>']);
  });

  it('names a block after its title', () => {
    const blocks = extractHtmlBlocks('```html\n<html><head><title>My Page</title></head></html>\n```');
    expect(blocks[0].title).toBe('My Page');
  });

  it('falls back to the first heading, without its tags', () => {
    const blocks = extractHtmlBlocks('```html\n<h1 class="x">Bold <em>Heading</em></h1>\n```');
    expect(blocks[0].title).toBe('Bold Heading');
  });

  it('leaves the title unset when the document names itself nowhere', () => {
    expect(extractHtmlBlocks('```html\n<p>just a paragraph</p>\n```')[0].title).toBeUndefined();
  });

  it('decodes entities in the title and truncates a long one', () => {
    expect(extractHtmlBlocks('```html\n<title>Tom &amp; Jerry</title>\n```')[0].title).toBe(
      'Tom & Jerry',
    );
    const long = extractHtmlBlocks(`\`\`\`html\n<title>${'word '.repeat(30)}</title>\n\`\`\``)[0];
    expect(long.title?.length).toBeLessThanOrEqual(60);
    expect(long.title?.endsWith('...')).toBe(true);
  });

  it('tolerates an indented fence', () => {
    expect(extractHtmlBlocks('  ```html\n<b>x</b>\n  ```')).toHaveLength(1);
  });
});

describe('frameForPreview', () => {
  const viewport = 'name="viewport"';

  it('wraps a fragment in a document of its own', () => {
    const framed = frameForPreview('<p>hi</p>');
    expect(framed).toContain('<!doctype html>');
    expect(framed).toContain('<p>hi</p>');
    expect(framed).toContain(viewport);
  });

  it('puts the viewport into an existing head', () => {
    const framed = frameForPreview('<html><head><title>T</title></head><body>x</body></html>');
    expect(framed).toContain('<head><meta name="viewport"');
    expect(framed).toContain('<title>T</title>');
    expect(framed.match(/name="viewport"/g)).toHaveLength(1);
  });

  it('supplies a head when the document has none', () => {
    const framed = frameForPreview('<html><body>x</body></html>');
    expect(framed).toContain('<html><head><meta name="viewport"');
    expect(framed).toContain('<body>x</body>');
  });

  it('keeps the document attributes when it has to add a head', () => {
    const framed = frameForPreview('<html lang="en"><body>x</body></html>');
    expect(framed).toContain('<html lang="en"><head>');
  });
});
