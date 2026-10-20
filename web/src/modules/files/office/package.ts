// The archive of an Office document (M7 #02): its parts opened as XML trees and written back, with only the parts that were edited changed.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parseXml, serializeXml, type XmlDocument } from './xml.ts';

/** The most an archive may expand to: a small file that unpacks to gigabytes is not a document. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

/** File types that are compressed already: stored as they are rather than compressed again. */
const STORED = /\.(png|jpe?g|gif|webp|mp3|mp4|m4a|mov|zip|docx|xlsx|pptx|pdf|woff2?)$/i;

/** The parts of an archive, opened and written back: only the parts that were edited change. */
export class Package {
  readonly #files: Record<string, Uint8Array>;
  readonly #parsed = new Map<string, XmlDocument>();
  readonly #edited = new Set<string>();

  constructor(bytes: Uint8Array) {
    let unpacked = 0;
    try {
      this.#files = unzipSync(bytes, {
        filter: ({ originalSize }) => {
          unpacked += originalSize;
          if (unpacked > MAX_UNPACKED_BYTES) throw new Error('This document unpacks to far more than it should, so it is not opened.');
          return true;
        },
      });
    } catch (error) {
      throw new Error(error instanceof Error && /unpacks to far/.test(error.message) ? error.message : 'This file is not a readable Office document (it is not a valid zip archive).');
    }
  }

  has(name: string): boolean {
    return name in this.#files;
  }

  names(): string[] {
    return Object.keys(this.#files);
  }

  /** The XML of a part, or `undefined` when the archive has no such part. */
  xml(name: string): XmlDocument | undefined {
    const known = this.#parsed.get(name);
    if (known) return known;
    if (!(name in this.#files)) return undefined;
    const parsed = parseXml(strFromU8(this.#files[name]));
    this.#parsed.set(name, parsed);
    return parsed;
  }

  /** Records that a part's XML was changed, so that it is written back from the tree. */
  edited(name: string): void {
    this.#edited.add(name);
  }

  remove(name: string): void {
    delete this.#files[name];
    this.#parsed.delete(name);
    this.#edited.delete(name);
  }

  /** The archive with every edited part written back and every other part as it was. */
  save(): Uint8Array {
    const files: Zippable = {};
    for (const [name, data] of Object.entries(this.#files)) {
      const text = this.#edited.has(name) ? strToU8(serializeXml(this.#parsed.get(name)!)) : data;
      files[name] = [text, { level: STORED.test(name) ? 0 : 6 }];
    }
    return zipSync(files);
  }
}
