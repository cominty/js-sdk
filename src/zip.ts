/**
 * A minimal ZIP writer: stored (uncompressed) entries, UTF-8 names, no ZIP64.
 *
 * Enough for a skill archive, which the API caps at 30 MB, without a runtime
 * dependency. Entries carry a fixed timestamp so the same files always make the
 * same bytes.
 */

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const VERSION = 20
/** Bit 11: the entry name is UTF-8. */
const UTF8_FLAG = 0x0800
/** 1980-01-01 00:00, the earliest DOS date. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const DOS_TIME = 0

export interface ZipEntry {
    /** Path inside the archive, `/`-separated. */
    name: string
    data: Uint8Array
}

export function zip(entries: readonly ZipEntry[]): Uint8Array {
    const encoder = new TextEncoder()
    const locals: Uint8Array[] = []
    const centrals: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
        const name = encoder.encode(entry.name)
        const crc = crc32(entry.data)
        const size = entry.data.length

        const local = new DataView(new ArrayBuffer(30))
        local.setUint32(0, LOCAL_HEADER, true)
        local.setUint16(4, VERSION, true)
        local.setUint16(6, UTF8_FLAG, true)
        local.setUint16(8, 0, true) // stored
        local.setUint16(10, DOS_TIME, true)
        local.setUint16(12, DOS_DATE, true)
        local.setUint32(14, crc, true)
        local.setUint32(18, size, true)
        local.setUint32(22, size, true)
        local.setUint16(26, name.length, true)
        local.setUint16(28, 0, true)
        locals.push(new Uint8Array(local.buffer), name, entry.data)

        const central = new DataView(new ArrayBuffer(46))
        central.setUint32(0, CENTRAL_HEADER, true)
        central.setUint16(4, VERSION, true)
        central.setUint16(6, VERSION, true)
        central.setUint16(8, UTF8_FLAG, true)
        central.setUint16(10, 0, true)
        central.setUint16(12, DOS_TIME, true)
        central.setUint16(14, DOS_DATE, true)
        central.setUint32(16, crc, true)
        central.setUint32(20, size, true)
        central.setUint32(24, size, true)
        central.setUint16(28, name.length, true)
        // Extra field, comment, disk number, internal and external attributes: none.
        central.setUint32(42, offset, true)
        centrals.push(new Uint8Array(central.buffer), name)

        offset += 30 + name.length + size
    }

    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, END_OF_CENTRAL_DIRECTORY, true)
    end.setUint16(8, entries.length, true)
    end.setUint16(10, entries.length, true)
    end.setUint32(12, centralSize, true)
    end.setUint32(16, offset, true)

    return concat([...locals, ...centrals, new Uint8Array(end.buffer)])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

let table: Uint32Array | undefined

export function crc32(data: Uint8Array): number {
    if (table === undefined) {
        table = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c >>> 0
        }
    }
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}
