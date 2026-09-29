/**
 * Local Keycloak for development, without Docker (ADR-0014).
 *
 *   node infra/keycloak/keycloak.mjs install   download and unpack Keycloak (once)
 *   node infra/keycloak/keycloak.mjs start     install if needed, load our realms, start it
 *
 * `pnpm dev` runs `start` together with the other processes. Keycloak then listens on
 * http://localhost:8080 (admin console login: admin / admin, development only).
 *
 * Keycloak, its development data and a private Java 21 live in .local/ at the repository root
 * (git-ignored). Delete .local/keycloak-<version>/data to start again with fresh realms and
 * no test users.
 *
 * Why a private Java: Keycloak supports specific Java versions (21 for this version), and a
 * developer's own Java may be newer or older. Using our own copy means Keycloak always starts,
 * and the system Java is never changed.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Pinned version: everyone gets the same Keycloak. Change it deliberately, and test. */
const VERSION = '26.3.3';
const DOWNLOAD_URL = `https://github.com/keycloak/keycloak/releases/download/${VERSION}/keycloak-${VERSION}.zip`;

/** The Java version this Keycloak version supports. */
const JAVA_VERSION = 21;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const localDir = join(repoRoot, '.local');
const home = process.env.KEYCLOAK_HOME ?? join(localDir, `keycloak-${VERSION}`);
const javaDir = join(localDir, `java-${JAVA_VERSION}`);
const realmsDir = join(here, 'realms');
const isWindows = process.platform === 'win32';
const kcScript = join(home, 'bin', isWindows ? 'kc.bat' : 'kc.sh');

/** Downloads a file to `target`, streaming it (Keycloak and Java are large). */
async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}) from ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

/** Unpacks a .zip or .tar.gz archive into `targetDir`. */
function unpack(archive, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  // Windows 10+ ships bsdtar, which reads zip and tar.gz; elsewhere zip needs unzip.
  const result =
    archive.endsWith('.zip') && !isWindows
      ? spawnSync('unzip', ['-q', '-o', archive, '-d', targetDir], { stdio: 'inherit' })
      : spawnSync('tar', ['-xf', archive, '-C', targetDir], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Could not unpack ${archive}`);
  rmSync(archive);
}

/** Folder of the private Java, e.g. .local/java-21/jdk-21.0.8+9 (null if not installed). */
function javaHome() {
  if (!existsSync(javaDir)) return null;
  const jdk = readdirSync(javaDir).find((name) => name.startsWith('jdk'));
  if (!jdk) return null;
  // macOS archives nest the JDK under Contents/Home.
  const macHome = join(javaDir, jdk, 'Contents', 'Home');
  return existsSync(macHome) ? macHome : join(javaDir, jdk);
}

async function installJava() {
  if (javaHome()) return;
  const os = isWindows ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const extension = isWindows ? 'zip' : 'tar.gz';
  // Eclipse Temurin: free, open-source builds of Java from the Adoptium project.
  const url = `https://api.adoptium.net/v3/binary/latest/${JAVA_VERSION}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;
  const archive = join(localDir, `java-${JAVA_VERSION}.${extension}`);
  console.log(`Downloading Java ${JAVA_VERSION} for Keycloak (about 200 MB)…`);
  await download(url, archive);
  console.log('Unpacking…');
  unpack(archive, javaDir);
}

async function installKeycloak() {
  if (existsSync(kcScript)) return;
  const archive = join(localDir, `keycloak-${VERSION}.zip`);
  console.log(`Downloading Keycloak ${VERSION} (about 200 MB)…`);
  await download(DOWNLOAD_URL, archive);
  console.log('Unpacking…');
  unpack(archive, localDir);
}

async function install() {
  mkdirSync(localDir, { recursive: true });
  await installJava();
  await installKeycloak();
  console.log(`Keycloak ${VERSION} ready in ${home} (Java: ${javaHome()})`);
}

async function start() {
  await install();

  // Keycloak imports realms from data/import at startup; realms that already exist are kept
  // as they are, so test users and changes made in the admin console survive restarts.
  const importDir = join(home, 'data', 'import');
  mkdirSync(importDir, { recursive: true });
  for (const file of readdirSync(realmsDir).filter((f) => f.endsWith('.json'))) {
    copyFileSync(join(realmsDir, file), join(importDir, file));
  }

  const keycloak = spawn(kcScript, ['start-dev', '--http-port=8080', '--import-realm'], {
    stdio: 'inherit',
    shell: isWindows, // .bat files need a shell on Windows
    env: {
      ...process.env,
      JAVA_HOME: javaHome(), // Keycloak's scripts use JAVA_HOME before the PATH
      KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
      KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
      KC_HEALTH_ENABLED: 'true',
    },
  });
  keycloak.on('exit', (code) => process.exit(code ?? 0));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => keycloak.kill(signal));
  }
}

const command = process.argv[2];
const commands = { install, start };
if (!commands[command]) {
  console.error('Usage: node infra/keycloak/keycloak.mjs <install|start>');
  process.exit(1);
}
commands[command]().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
