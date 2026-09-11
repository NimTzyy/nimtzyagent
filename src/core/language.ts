const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  swiftui: 'swift',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  scala: 'scala',
};

export function languageFromFilename(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return undefined;
  return EXTENSION_LANGUAGE[name.slice(dot + 1).toLowerCase()];
}

/** Language ids accepted by highlight.js, mapped from common fence labels. */
const FENCE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  objc: 'objectivec',
};

export function languageFromFence(info: string): string | undefined {
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return undefined;
  return FENCE_ALIASES[first] ?? first;
}

export function isTextFilename(name: string): boolean {
  return languageFromFilename(name) !== undefined || /\.(txt|log|csv|tsv|env|conf|cfg)$/i.test(name);
}
