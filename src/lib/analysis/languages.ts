/** Extension → language name. Keep names aligned with GitHub Linguist. */
const EXT_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  pyi: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  scala: 'Scala',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  clj: 'Clojure',
  dart: 'Dart',
  lua: 'Lua',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  proto: 'Protocol Buffers',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
  json: 'JSON',
  jsonc: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  xml: 'XML',
  md: 'Markdown',
  mdx: 'MDX',
  rst: 'reStructuredText',
  tf: 'HCL',
  hcl: 'HCL',
  dockerfile: 'Dockerfile',
  gradle: 'Gradle',
  make: 'Makefile',
  prisma: 'Prisma',
  env: 'Dotenv',
};

const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  rakefile: 'Ruby',
  gemfile: 'Ruby',
  procfile: 'Procfile',
  'cargo.lock': 'TOML',
  'go.mod': 'Go Module',
  'go.sum': 'Go Module',
};

/** Languages we run source-level rules against. */
export const CODE_LANGUAGES = new Set([
  'TypeScript',
  'JavaScript',
  'Python',
  'Ruby',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'Swift',
  'C',
  'C++',
  'C#',
  'PHP',
  'Scala',
  'Elixir',
  'Dart',
  'Vue',
  'Svelte',
  'Astro',
  'SQL',
  'Shell',
]);

/** Extensions we never decode as text. */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'svgz',
  'pdf', 'zip', 'gz', 'tar', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'flac', 'ogg',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'so', 'dylib', 'dll', 'exe', 'bin', 'wasm', 'class', 'pyc', 'o', 'a',
  'db', 'sqlite', 'sqlite3', 'parquet', 'avro',
]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.has(extensionOf(path));
}

export function detectLanguage(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (FILENAME_LANGUAGE[base]) return FILENAME_LANGUAGE[base];
  if (base.startsWith('dockerfile')) return 'Dockerfile';
  if (base.startsWith('.env')) return 'Dotenv';
  const ext = extensionOf(path);
  return EXT_LANGUAGE[ext] ?? (ext ? ext.toUpperCase() : 'Other');
}

/** Line-comment prefix per language, used by the AST-lite metrics pass. */
export function lineCommentToken(language: string): string {
  switch (language) {
    case 'Python':
    case 'Ruby':
    case 'Shell':
    case 'YAML':
    case 'TOML':
    case 'Dockerfile':
    case 'Makefile':
    case 'HCL':
      return '#';
    case 'SQL':
      return '--';
    case 'Lua':
      return '--';
    default:
      return '//';
  }
}

const VENDOR_SEGMENTS = [
  'node_modules',
  'vendor',
  'third_party',
  'thirdparty',
  'bower_components',
  '.venv',
  'venv',
  'site-packages',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  'bin',
  'obj',
  'coverage',
  '__pycache__',
  '.git',
  '.yarn',
  'Pods',
];

export function isVendorPath(path: string): boolean {
  const segments = path.split('/');
  return segments.some((segment) => VENDOR_SEGMENTS.includes(segment));
}

export function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)(\/|$)/.test(lower) ||
    /\.(test|spec)\.[a-z]+$/.test(lower) ||
    /(^|\/)test_[^/]+\.py$/.test(lower) ||
    /_test\.(go|py|rb|ts|js)$/.test(lower)
  );
}

export function isGeneratedPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /\.(min|bundle)\.(js|css)$/.test(lower) ||
    /\.(d\.ts)$/.test(lower) ||
    /(^|\/)(generated|__generated__|gen)(\/|$)/.test(lower) ||
    /\.(pb|_pb2)\.(go|py|ts|js)$/.test(lower) ||
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Gemfile\.lock|composer\.lock|cargo\.lock)$/i.test(
      lower,
    )
  );
}

export function isDocPath(path: string): boolean {
  return /\.(md|mdx|rst|txt|adoc)$/i.test(path) || /(^|\/)docs?(\/|$)/i.test(path);
}

export function isConfigPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return (
    /\.(json|ya?ml|toml|ini|conf|config|properties)$/.test(base) ||
    base.startsWith('.env') ||
    /^(dockerfile|docker-compose|makefile|procfile)/.test(base) ||
    /\.(tf|hcl)$/.test(base)
  );
}

/** Dependency manifests we know how to read. */
export const MANIFEST_FILES: Record<string, { ecosystem: string; label: string }> = {
  'package.json': { ecosystem: 'npm', label: 'npm' },
  'requirements.txt': { ecosystem: 'pypi', label: 'pip' },
  'pyproject.toml': { ecosystem: 'pypi', label: 'Python project' },
  'pipfile': { ecosystem: 'pypi', label: 'Pipenv' },
  'go.mod': { ecosystem: 'go', label: 'Go modules' },
  'cargo.toml': { ecosystem: 'cargo', label: 'Cargo' },
  gemfile: { ecosystem: 'rubygems', label: 'Bundler' },
  'composer.json': { ecosystem: 'other', label: 'Composer' },
  'pom.xml': { ecosystem: 'maven', label: 'Maven' },
  'build.gradle': { ecosystem: 'maven', label: 'Gradle' },
};
