// zip-dir.mjs — a minimal, spec-correct ZIP writer.
//
// Exists because neither `zip` nor 7-Zip is on this machine, and the two obvious fallbacks are
// both wrong: PowerShell's Compress-Archive writes entry names with BACKSLASH separators, which
// the ZIP spec forbids (APPNOTE 4.4.17.1 requires forward slashes) and which makes some extractors
// produce a literal file called "src\data\levels.json" instead of a folder — the game would then
// fail to find its level data. GNU tar cannot write ZIP at all; `tar -a -cf out.zip` silently
// produces a tar with a .zip name.
//
// Deliberately stores no directory entries and uses a fixed timestamp, so the same input always
// produces byte-identical output.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { resolve, relative } from 'node:path';

const deflate = promisify(deflateRaw);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// A fixed DOS timestamp (1 Jan 2026, 00:00) keeps the archive reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

async function walk(dir, base = dir) {
  const out = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ full, name: relative(base, full).split(/[\/]/).join('/') });
  }
  return out;
}

/** Zip every file under `dir` with paths relative to it. Returns {files, bytes}. */
export async function zipDir(dir, outFile) {
  const entries = await walk(dir);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { full, name } of entries) {
    const data = await readFile(full);
    const comp = await deflate(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(8, 8);           // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    locals.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk number start
    cd.writeUInt16LE(0, 36);             // internal attrs
    cd.writeUInt32LE(0, 38);             // external attrs
    cd.writeUInt32LE(offset, 42);        // offset of local header
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...locals, cdBuf, end]);
  await writeFile(outFile, archive);
  return { files: entries.map((e) => e.name), bytes: archive.length };
}
