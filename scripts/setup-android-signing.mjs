// Run once on the owner's machine. The generated credentials never enter Git.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const folder = resolve('.artifacts/mobile-signing');
mkdirSync(folder, { recursive: true });
const secretsFile = resolve(folder, 'credentials.json');
const keystore = resolve(folder, 'even-tone-release.jks');
const execute = (command, args, options = {}) => {
  const r = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (r.status !== 0) throw new Error(`Signing setup failed: ${command} (credentials suppressed)`);
};
if (!existsSync(secretsFile)) {
  if (existsSync(keystore)) throw new Error('Existing keystore has no credential record; refusing to replace it.');
  const password = randomBytes(32).toString('base64url');
  writeFileSync(secretsFile, JSON.stringify({ ANDROID_KEYSTORE_PASSWORD: password, ANDROID_KEY_PASSWORD: password, ANDROID_KEY_ALIAS: 'even-tone' }), { mode: 0o600, flag: 'wx' });
}
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
if (!existsSync(keystore)) execute(process.env.KEYTOOL || 'keytool', [
  '-genkeypair', '-noprompt', '-keystore', keystore, '-storetype', 'JKS',
  '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', '-keypass:env', 'ANDROID_KEY_PASSWORD',
  '-alias', secrets.ANDROID_KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
  '-dname', 'CN=EVEN TONE, O=Independent Hackathon Project',
], { env: { ...process.env, ...secrets } });
secrets.ANDROID_KEYSTORE_BASE64 = readFileSync(keystore).toString('base64');
for (const [name, value] of Object.entries(secrets)) execute(process.env.GH_PATH || 'gh', [
  'secret', 'set', name, '--repo', 'chnoorlee/L-Or-al-Hackathon',
], { input: value });
console.log('Android release signing configured. Back up .artifacts/mobile-signing privately.');
