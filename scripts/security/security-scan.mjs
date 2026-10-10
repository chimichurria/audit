#!/usr/bin/env node
// Escaneo estático de seguridad (heurístico, sin dependencias). No reemplaza a Semgrep ni a gitleaks: los complementa.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const redact = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…(${s.length} car.)`);

export const SECRET_RULES = [
  { id: 'secret-aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS access key id' },
  { id: 'secret-private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, label: 'Clave privada' },
  { id: 'secret-stripe-live', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g, label: 'Stripe live key' },
  { id: 'secret-github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b/g, label: 'GitHub token' },
  { id: 'secret-slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g, label: 'Slack token' },
  { id: 'secret-llm-api-key', re: /\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{32,}\b/g, label: 'API key de LLM' }
];

export function findSecrets(text) {
  const out = [];
  for (const r of SECRET_RULES) {
    for (const m of text.matchAll(r.re)) out.push({ id: r.id, label: r.label, index: m.index, value: m[0] });
  }
  for (const m of text.matchAll(/\beyJ[\w-]{10,}\.([\w-]{10,})\.[\w-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') out.push({ id: 'secret-supabase-service-role', label: 'Supabase service_role JWT', index: m.index, value: m[0] });
    } catch { /* no es un JWT legible */ }
  }
  return out;
}

const isClient = (text) => /^\s*['"]use client['"]/m.test(text);

export const RULES = [
  { id: 'public-env-secret', severity: 'P0', owasp: ['A02:2025', 'A04:2025'], re: /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)[A-Z0-9_]*/g, msg: 'Variable NEXT_PUBLIC_* con nombre de secreto: se incrusta en el bundle del navegador.' },
  { id: 'service-role-in-client', severity: 'P0', owasp: ['A01:2025', 'A02:2025'], re: /SUPABASE_SERVICE_ROLE_KEY|service_role/g, when: (f, t) => isClient(t), msg: 'service_role en un componente de cliente: saltea RLS para cualquiera que abra el bundle.' },
  { id: 'eval-dynamic', severity: 'P1', owasp: ['A05:2025'], re: /\beval\s*\(|new\s+Function\s*\(/g, msg: 'Ejecución dinámica de código.' },
  { id: 'sql-concat', severity: 'P1', owasp: ['A05:2025'], re: /(?:\.(?:query|execute|raw)|queryRawUnsafe|executeRawUnsafe)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/g, msg: 'SQL armado por concatenación/interpolación: usá consultas parametrizadas.' },
  { id: 'shell-injection', severity: 'P1', owasp: ['A05:2025'], re: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/g, msg: 'Comando de shell con interpolación: usá execFile/spawn con array de argumentos.' },
  { id: 'tls-verify-off', severity: 'P1', owasp: ['A04:2025'], re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/g, msg: 'Validación TLS desactivada.' },
  { id: 'cookie-httponly-off', severity: 'P1', owasp: ['A07:2025'], re: /httpOnly\s*:\s*false/g, msg: 'Cookie legible desde JS: si es de sesión, activá httpOnly.' },
  { id: 'dangerous-html', severity: 'P2', owasp: ['A05:2025'], re: /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(/g, msg: 'Inyección de HTML: sanitizá (DOMPurify) o evitá si el contenido no es 100% propio.' },
  { id: 'weak-random', severity: 'P2', owasp: ['A04:2025'], re: /Math\.random\(\)[^\n;]{0,80}(?:token|secret|password|session|otp|code)|(?:token|secret|password|session|otp|code)[^\n;]{0,80}Math\.random\(\)/gi, msg: 'Math.random no es criptográfico: usá crypto.randomUUID()/crypto.getRandomValues().' },
  { id: 'cors-wildcard', severity: 'P2', owasp: ['A02:2025'], re: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]|origin\s*:\s*(?:true|['"]\*['"])/g, msg: 'CORS abierto: restringí a orígenes propios, nunca con credenciales.' },
  { id: 'token-in-webstorage', severity: 'P2', owasp: ['A07:2025'], re: /(?:localStorage|sessionStorage)\.setItem\(\s*['"][^'"]*(?:token|jwt|session)[^'"]*['"]/gi, msg: 'Token en Web Storage: accesible por cualquier XSS.' },
  { id: 'cookie-secure-off', severity: 'P2', owasp: ['A07:2025'], re: /\bsecure\s*:\s*false/g, msg: 'Cookie sin Secure.' },
  { id: 'jwt-decode-no-verify', severity: 'P2', owasp: ['A07:2025'], re: /jwt\.decode\s*\(/g, msg: 'jwt.decode no verifica la firma.' },
  { id: 'server-getsession', severity: 'P2', owasp: ['A07:2025'], re: /auth\.getSession\s*\(\s*\)/g, when: (f, t) => !isClient(t), msg: 'En servidor usá auth.getUser() (valida el token); getSession() lee la cookie sin revalidarla. Verificalo en la doc vigente de Supabase.' },
  { id: 'open-redirect', severity: 'P2', owasp: ['A01:2025'], re: /(?:redirect\(|router\.(?:push|replace)\(|location(?:\.href)?\s*=)\s*[^)\n;]*(?:searchParams\.get|req\.query|req\.nextUrl|params\.)/g, msg: 'Redirección con destino controlado por el usuario: validá contra una allowlist de rutas.' },
  { id: 'log-sensitive', severity: 'P2', owasp: ['A09:2025'], re: /console\.(?:log|info|debug)\([^)]*(?:password|passwd|secret|token|authorization|apikey)/gi, msg: 'Posible log de dato sensible.' },
  { id: 'empty-catch', severity: 'P3', owasp: ['A10:2025'], re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g, msg: 'Excepción tragada: falla en silencio (A10:2025, manejo de condiciones excepcionales).' }
];

const AUTH_WORDS = /getUser|getSession|auth\(|requireAuth|verifyToken|jwt|authorization|cookies\(|createServerClient|currentUser|clerk|nextauth|getServerSession|\b(?:require|assert|ensure|check|verify|with)(?:Auth|User|Staff|Admin|Role|Session|Permission|Access|Login|Owner)\w*\s*\(|\bget(?:Staff|Admin)Profile\s*\(/i;
const VALIDATION_WORDS = /zod|safeParse|\.parse\(|valibot|yup|joi|v\.object/i;

export const FILE_RULES = [
  { id: 'env-file', severity: 'P0', owasp: ['A02:2025'], test: (f) => /^\.env(\..+)?$/.test(path.posix.basename(f)) && !/\.(example|sample|template)$/.test(f), msg: 'Archivo .env: no debe estar versionado. Si está trackeado, rotá todo lo que contiene y purgá el historial.' },
  { id: 'webhook-no-signature', severity: 'P1', owasp: ['A08:2025', 'A07:2025'], test: (f, t) => /webhook/i.test(f) && /route\.(?:ts|js)$|pages\/api|\/api\//.test(f) && !/timingSafeEqual|createHmac|signature|svix|webhooks\.construct/i.test(t), msg: 'Webhook sin verificación de firma/HMAC visible: cualquiera puede invocarlo.' },
  { id: 'api-route-no-auth', severity: 'P2', owasp: ['A01:2025'], test: (f, t) => /(?:app\/api\/.*route|pages\/api\/.*)\.(?:ts|js)$/.test(f) && !AUTH_WORDS.test(t), msg: 'Ruta de API sin control de acceso visible. Revisá a mano: ¿es pública a propósito? (BOLA/BFLA)' },
  { id: 'server-action-no-auth', severity: 'P2', owasp: ['A01:2025'], test: (f, t) => /['"]use server['"]/.test(t) && !AUTH_WORDS.test(t), msg: 'Server Action sin autenticación visible: es un endpoint público.' },
  { id: 'server-action-no-validation', severity: 'P2', owasp: ['A05:2025'], test: (f, t) => /['"]use server['"]/.test(t) && !VALIDATION_WORDS.test(t), msg: 'Server Action sin validación de entrada visible.' }
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Las reglas de código solo aplican a código de aplicación: no a tests, documentación ni prompts de agentes.
// Los secretos se buscan en todos los archivos de texto (también en tests y docs).
const CODE_FILE = /\.(?:js|mjs|cjs|jsx|ts|tsx|html|vue|svelte|astro)$/;
const TEST_FILE = /\.(?:test|spec)\.|(?:^|\/)(?:tests?|__tests__|__mocks__|fixtures|e2e)\//;
const appCode = (f) => CODE_FILE.test(f) && !TEST_FILE.test(f);

export function scanText(text, file = '') {
  const f = file.replaceAll('\\', '/');
  const lines = text.split('\n');
  const hits = [];
  const ignored = (line, id) => /security-audit-ignore:\s*([\w-]+)\s*[—-]\s*\S+/.exec(lines[line - 2] ?? '')?.[1] === id;
  for (const s of findSecrets(text)) {
    const line = lineOf(text, s.index);
    if (!ignored(line, s.id)) hits.push({ id: s.id, severity: 'P0', owasp: ['A02:2025', 'A04:2025'], line, msg: `${s.label} en el código. Rotalo y purgá el historial.`, evidence: redact(s.value) });
  }
  for (const r of RULES) {
    if (!appCode(f) || (r.when && !r.when(f, text))) continue;
    for (const m of text.matchAll(r.re)) {
      const line = lineOf(text, m.index);
      if (ignored(line, r.id)) continue;
      hits.push({ id: r.id, severity: r.severity, owasp: r.owasp, line, msg: r.msg, evidence: (lines[line - 1] ?? '').trim().slice(0, 120) });
    }
  }
  for (const r of FILE_RULES) {
    if (r.id !== 'env-file' && !appCode(f)) continue;
    if (r.test(f, text)) hits.push({ id: r.id, severity: r.severity, owasp: r.owasp, line: 1, msg: r.msg, evidence: '' });
  }
  return hits.sort((a, b) => a.line - b.line);
}

const EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|json|html|sql|ya?ml|toml|sh|py|md|mdx|txt)$|(?:^|\/)\.env(?:\..+)?$/;
const SKIP_FILES = /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

export const DEFAULT_IGNORE = ['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.vercel', '.codex', '.cursor', '.claude', '.agents', '.windsurf', '.ui-audit', '.security-audit', '.ux-audit', '.audit'];

// Archivos y carpetas que git ignora (.env.local, builds, etc.): no se versionan, así que no son una fuga por commit.
// Un .env trackeado por error NO está en esta lista y se sigue marcando.
export function gitIgnoredPaths(root) {
  const r = spawnSync('git', ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return () => false;
  const all = r.stdout.split('\0').filter(Boolean);
  const dirs = all.filter((p) => p.endsWith('/'));
  const files = new Set(all.filter((p) => !p.endsWith('/')));
  return (rel) => files.has(rel) || dirs.some((d) => rel.startsWith(d));
}

export function scanTree(root, ignoreDirs = DEFAULT_IGNORE) {
  const findings = [];
  const ignoreCount = { n: 0 };
  const isIgnored = gitIgnoredPaths(root);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!ignoreDirs.includes(e.name)) walk(full); continue; }
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (!EXT.test(rel) || SKIP_FILES.test(rel) || isIgnored(rel)) continue;
      if (fs.statSync(full).size > 1_500_000) continue;
      const text = fs.readFileSync(full, 'utf8');
      ignoreCount.n += (text.match(/security-audit-ignore:/g) ?? []).length;
      for (const h of scanText(text, rel)) findings.push({ source: 'security-scan', file: rel, ...h });
    }
  };
  walk(root);
  return { findings, ignores: ignoreCount.n };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2] ?? '.';
  const { findings, ignores } = scanTree(root);
  for (const f of findings) console.log(`[${f.severity}] ${f.file}:${f.line} ${f.id} (${f.owasp.join(',')}) ${f.msg}${f.evidence ? ` -> ${f.evidence}` : ''}`);
  console.log(`\n${findings.length} hallazgos, ${ignores} security-audit-ignore.`);
  process.exit(findings.some((f) => ['P0', 'P1'].includes(f.severity)) ? 1 : 0);
}
