#!/usr/bin/env node
/*
 * JetPhotos+ · Gerador do pacote de teste
 * ---------------------------------------
 * Gera um .zip com o conteúdo de extension/ pronto pra ser carregado no
 * navegador via "Carregar sem compactação" (é só descompactar e apontar
 * pra pasta).
 *
 * Uso:
 *   node scripts/build-zip.mjs
 *
 * O nome do arquivo sai da versão que está em extension/manifest.json:
 *   zips/jetphotosplus-v2.0.0.zip
 * Como a versão só muda quando o usuário mandar (ver AGENTS.md), vários
 * testes podem sair com a mesma versão — nesse caso o script NÃO sobrescreve:
 * se o zip já existir, acrescenta um sufixo de revisão (-r2, -r3, ...):
 *   zips/jetphotosplus-v2.0.1-r2.zip
 *
 * Requisitos: só o Node (sem dependências, sem npm install, sem `zip` do
 * sistema — por isso funciona igual no Linux, macOS e Windows).
 *
 * Detalhes que importam:
 *   · manifest.json fica na RAIZ do zip — se ficar dentro de uma pasta,
 *     o navegador rejeita a extensão.
 *   · Arquivos ocultos (.DS_Store, .git, etc.) são ignorados.
 *   · CHANGELOG.md fica DE FORA do zip: é documento do repositório, não
 *     arquivo de instalação (o usuário pediu pra não ir no pacote).
 *   · A saída vai pra zips/, que está no .gitignore (só é commitada com
 *     -f nas branches de sessão — ver AGENTS.md).
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SOURCE_DIR = join(ROOT, 'extension');
const OUTPUT_DIR = join(ROOT, 'zips');

// ---------------------------------------------------------------------------
// CRC32 (obrigatório no formato ZIP)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// Data/hora no formato MS-DOS que o ZIP exige.
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Arquivos de extension/ que NÃO entram no pacote de teste (relativos à
// raiz de extension/). São documentos do repositório, não da instalação.
const ZIP_EXCLUDE = new Set(['CHANGELOG.md']);

// ---------------------------------------------------------------------------
// Lista os arquivos, ignorando ocultos (dotfiles) e a própria pasta de saída
// ---------------------------------------------------------------------------
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      if (ZIP_EXCLUDE.has(relative(SOURCE_DIR, full).split(sep).join('/'))) continue;
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Escrita do ZIP (método deflate)
// ---------------------------------------------------------------------------
function buildZip(files, baseDir) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    // Caminho dentro do zip: relativo à pasta extension/, sempre com "/".
    const name = relative(baseDir, file).split(sep).join('/');
    const nameBuf = Buffer.from(name, 'utf8');
    const content = readFileSync(file);
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);
    const { time, day } = dosDateTime(statSync(file).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // assinatura
    local.writeUInt16LE(20, 4);         // versão necessária
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(8, 8);          // método: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // tamanho do campo extra

    const localRecord = Buffer.concat([local, nameBuf, compressed]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // assinatura
    central.writeUInt16LE(20, 4);         // versão que criou
    central.writeUInt16LE(20, 6);         // versão necessária
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(8, 10);         // método: deflate
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comentário
    central.writeUInt16LE(0, 34);         // disco
    central.writeUInt16LE(0, 36);         // atributos internos
    central.writeUInt32LE(0, 38);         // atributos externos
    central.writeUInt32LE(offset, 42);    // offset do header local
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // fim do diretório central
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comentário do arquivo

  return Buffer.concat([...locals, centralDir, end]);
}

// ---------------------------------------------------------------------------
function main() {
  const manifestPath = join(SOURCE_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;

  if (!version) {
    console.error('Não achei a "version" em extension/manifest.json');
    process.exit(1);
  }

  const files = listFiles(SOURCE_DIR);
  if (!files.some(file => relative(SOURCE_DIR, file).split(sep).join('/') === 'manifest.json')) {
    console.error('manifest.json não está na raiz de extension/ — o zip sairia inválido.');
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Nunca sobrescreve um zip anterior: se a versão repetir (o normal, já
  // que ela só muda quando o usuário mandar), gera -r2, -r3, ...
  let outputPath = join(OUTPUT_DIR, `jetphotosplus-v${version}.zip`);
  if (existsSync(outputPath)) {
    let revision = 2;
    while (existsSync(join(OUTPUT_DIR, `jetphotosplus-v${version}-r${revision}.zip`))) revision++;
    outputPath = join(OUTPUT_DIR, `jetphotosplus-v${version}-r${revision}.zip`);
  }

  writeFileSync(outputPath, buildZip(files, SOURCE_DIR));

  console.log(`✔ ${relative(ROOT, outputPath)}`);
  console.log(`  ${files.length} arquivo(s) · extensão v${version}`);
  console.log('  Para testar: descompacte e use "Carregar sem compactação" apontando pra pasta.');
}

main();
