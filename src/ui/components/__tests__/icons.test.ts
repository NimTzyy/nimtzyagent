import fs from 'fs';
import path from 'path';

/**
 * lucide keeps a `.d.ts` alias for every icon it renames, so a stale subpath
 * typechecks cleanly and only fails at bundle time. This walks the imports in
 * `icons.tsx` and checks each one against the package's own export map, which
 * is what Metro resolves at build time.
 */

const ICONS_SOURCE = path.join(__dirname, '..', 'icons.tsx');
const IMPORT_PATTERN = /from\s+'lucide-react-native\/icons\/([a-z0-9-]+)'/g;

/** Conditions Metro may pick, most likely first. */
const CONDITIONS = ['react-native', 'import', 'browser', 'require', 'default'];

function packageRoot(): string {
  let dir = path.dirname(require.resolve('lucide-react-native'));
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('lucide-react-native package root not found');
}

function exportedSubpaths(): Record<string, string | Record<string, string>> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8'),
  ) as { exports?: Record<string, string | Record<string, string>> };
  return manifest.exports ?? {};
}

/** Resolves `lucide-react-native/icons/<name>` to a file, or null if nothing ships there. */
function resolveIconFile(name: string): string | null {
  const pattern = exportedSubpaths()['./icons/*'];
  if (!pattern) return null;
  const targets = typeof pattern === 'string' ? { default: pattern } : pattern;
  const root = packageRoot();
  for (const condition of CONDITIONS) {
    const target = targets[condition];
    if (!target) continue;
    const candidate = path.join(root, target.replace('*', name));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function importedIconNames(): string[] {
  const source = fs.readFileSync(ICONS_SOURCE, 'utf8');
  const names: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) names.push(match[1]);
  return names;
}

describe('icon imports', () => {
  it('parses the imports from icons.tsx', () => {
    expect(importedIconNames().length).toBeGreaterThan(10);
  });

  it('resolves every imported icon to a file that ships', () => {
    const missing = importedIconNames().filter((name) => resolveIconFile(name) === null);
    expect(missing).toEqual([]);
  });

  it('reports a name that does not ship', () => {
    // Guards the check itself: the export map matches any name, so a passing
    // result has to come from the file existing, not from the pattern matching.
    expect(resolveIconFile('not-an-icon-in-any-release')).toBeNull();
  });

  it('exports every icon it imports', () => {
    const source = fs.readFileSync(ICONS_SOURCE, 'utf8');
    for (const name of importedIconNames()) {
      const binding = source
        .match(new RegExp(`import\\s+(\\w+)\\s+from\\s+'lucide-react-native/icons/${name}'`))?.[1];
      expect(binding).toBeDefined();
      expect(source).toMatch(new RegExp(`\\b${binding}\\b,`));
    }
  });
});
