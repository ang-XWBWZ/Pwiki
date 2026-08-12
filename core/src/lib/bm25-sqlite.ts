// bm25-sqlite.ts — BM25 v4 SQLite 持久化
//
// 使用标准未加密 SQLite 数据库：
//   - full refresh 在单事务中替换全部文档与 postings；
//   - CRUD/编译只删除并写入一个文档；
//   - 搜索只读取查询 term 对应的 postings，不反序列化全库词表；
//   - 首次访问时可从 v3 JSON 快照一次性迁移，旧文件原样保留。

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import {
  bm25DbFile,
  bm25DocsFile,
  bm25MetaFile,
  bm25TermsFile,
  registerWikiHomeChangeHandler,
} from "../config.js";
import { analyze } from "./tokenizer.js";
import { BM25_INDEX_VERSION } from "./bm25-schema.js";
import type {
  Bm25DocRecord,
  Bm25Index,
  Bm25Posting,
  Bm25TermEntry,
} from "./bm25.js";
import type { TokenSource } from "./analyzer/types.js";

const LEGACY_JSON_VERSION = 3;
const SQLITE_VARIABLE_CHUNK = 400;
const writableDatabases = new Map<string, Database.Database>();

const SCHEMA_SQL = `
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE documents (
    doc_id TEXT PRIMARY KEY,
    len INTEGER NOT NULL,
    fields_json TEXT NOT NULL,
    terms_json TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE postings (
    term TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    field TEXT NOT NULL,
    tf INTEGER NOT NULL,
    token_weight REAL NOT NULL,
    positions_json TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    PRIMARY KEY (term, doc_id, field),
    FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
  ) WITHOUT ROWID;

  CREATE INDEX postings_doc_id_idx ON postings(doc_id);
`;

interface MetadataRow {
  key: string;
  value: string;
}

interface DocumentRow {
  doc_id: string;
  len: number;
  fields_json: string;
  terms_json: string;
}

interface PostingRow {
  term: string;
  doc_id: string;
  field: string;
  tf: number;
  token_weight: number;
  positions_json: string;
  sources_json: string;
}

interface QueryPostingRow extends PostingRow, DocumentRow {}

interface DfRow {
  term: string;
  df: number;
}

interface AggregateRow {
  N: number;
  avgdl: number | null;
}

function configureWritable(db: Database.Database): void {
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
}

function writableDatabase(sourceId?: string): Database.Database {
  const path = bm25DbFile(sourceId);
  const cached = writableDatabases.get(path);
  if (cached?.open) return cached;
  const db = new Database(path);
  configureWritable(db);
  writableDatabases.set(path, db);
  return db;
}

function closeWritableDatabase(path: string): void {
  const db = writableDatabases.get(path);
  if (db?.open) db.close();
  writableDatabases.delete(path);
}

function openReadable(path: string): Database.Database {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

function isCurrentDatabase(path: string): boolean {
  if (writableDatabases.get(path)?.open) return true;
  if (!existsSync(path)) return false;
  let db: Database.Database | null = null;
  try {
    db = openReadable(path);
    if (Number(db.pragma("user_version", { simple: true })) !== BM25_INDEX_VERSION) return false;
    const row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    return Number(row?.value) === BM25_INDEX_VERSION;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function readLegacyJsonIndex(sourceId?: string): Bm25Index | null {
  const docsPath = bm25DocsFile(sourceId);
  const termsPath = bm25TermsFile(sourceId);
  const metaPath = bm25MetaFile(sourceId);
  if (!existsSync(docsPath) || !existsSync(termsPath) || !existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      version?: number;
      N?: number;
      avgdl?: number;
    };
    if (meta.version !== LEGACY_JSON_VERSION) return null;
    const docs = JSON.parse(readFileSync(docsPath, "utf-8")) as Record<string, Bm25DocRecord>;
    const terms = JSON.parse(readFileSync(termsPath, "utf-8")) as Record<string, Bm25TermEntry>;
    if (!docs || typeof docs !== "object" || !terms || typeof terms !== "object") return null;
    return {
      version: BM25_INDEX_VERSION,
      N: Number(meta.N ?? Object.keys(docs).length),
      avgdl: Number(meta.avgdl ?? 0),
      docs,
      terms,
    };
  } catch {
    return null;
  }
}

function ensureDatabase(sourceId?: string): boolean {
  const path = bm25DbFile(sourceId);
  if (isCurrentDatabase(path)) return true;
  if (existsSync(path)) return false;

  const legacy = readLegacyJsonIndex(sourceId);
  if (!legacy) return false;
  writeBm25Index(legacy, sourceId);
  return true;
}

function readMetadata(db: Database.Database): { N: number; avgdl: number } | null {
  const rows = db.prepare("SELECT key, value FROM metadata").all() as MetadataRow[];
  const metadata = Object.fromEntries(rows.map(row => [row.key, row.value]));
  if (Number(metadata.schema_version) !== BM25_INDEX_VERSION) return null;
  const N = Number(metadata.N);
  const avgdl = Number(metadata.avgdl);
  if (!Number.isFinite(N) || !Number.isFinite(avgdl)) return null;
  return { N, avgdl };
}

function parseDocument(row: DocumentRow): Bm25DocRecord {
  return {
    relPath: row.doc_id,
    len: row.len,
    fields: JSON.parse(row.fields_json) as Record<string, number>,
    terms: JSON.parse(row.terms_json) as string[],
  };
}

function parsePosting(row: PostingRow): Bm25Posting {
  return {
    docId: row.doc_id,
    field: row.field,
    tf: row.tf,
    tokenWeight: row.token_weight,
    positions: JSON.parse(row.positions_json) as number[],
    sources: JSON.parse(row.sources_json) as TokenSource[],
  };
}

function bindChunks<T>(values: T[], fn: (chunk: T[], placeholders: string) => void): void {
  for (let offset = 0; offset < values.length; offset += SQLITE_VARIABLE_CHUNK) {
    const chunk = values.slice(offset, offset + SQLITE_VARIABLE_CHUNK);
    fn(chunk, chunk.map(() => "?").join(", "));
  }
}

function insertIndexRows(db: Database.Database, index: Bm25Index): void {
  const insertMetadata = db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)");
  insertMetadata.run("schema_version", String(BM25_INDEX_VERSION));
  insertMetadata.run("N", String(index.N));
  insertMetadata.run("avgdl", String(index.avgdl));

  const insertDocument = db.prepare(`
    INSERT INTO documents(doc_id, len, fields_json, terms_json)
    VALUES (?, ?, ?, ?)
  `);
  for (const doc of Object.values(index.docs)) {
    insertDocument.run(doc.relPath, doc.len, JSON.stringify(doc.fields), JSON.stringify(doc.terms ?? []));
  }

  const insertPosting = db.prepare(`
    INSERT INTO postings(
      term, doc_id, field, tf, token_weight, positions_json, sources_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [term, termEntry] of Object.entries(index.terms)) {
    for (const posting of termEntry.postings) {
      if (!index.docs[posting.docId]) continue;
      insertPosting.run(
        term,
        posting.docId,
        posting.field,
        posting.tf,
        posting.tokenWeight,
        JSON.stringify(posting.positions),
        JSON.stringify(posting.sources),
      );
    }
  }
}

/** 是否已有可用的 v4 SQLite 索引；必要时会从 v3 JSON 原地迁移。 */
export function hasBm25Index(sourceId?: string): boolean {
  return ensureDatabase(sourceId);
}

/** 关闭复用的 WAL 写连接；切换 home、卸载 source 和全量重建前调用。 */
export function closeBm25Databases(sourceId?: string): void {
  if (sourceId !== undefined) {
    closeWritableDatabase(bm25DbFile(sourceId));
    return;
  }
  for (const db of writableDatabases.values()) {
    if (db.open) db.close();
  }
  writableDatabases.clear();
}

/** 完整读取仅供维护、兼容 API 和测试使用；正常搜索走 readBm25QueryIndex。 */
export function readBm25Index(sourceId?: string): Bm25Index | null {
  if (!ensureDatabase(sourceId)) return null;
  let db: Database.Database | null = null;
  try {
    db = openReadable(bm25DbFile(sourceId));
    const metadata = readMetadata(db);
    if (!metadata) return null;

    const docs: Record<string, Bm25DocRecord> = {};
    for (const row of db.prepare(
      "SELECT doc_id, len, fields_json, terms_json FROM documents",
    ).all() as DocumentRow[]) {
      docs[row.doc_id] = parseDocument(row);
    }

    const terms: Record<string, Bm25TermEntry> = {};
    const termDocs = new Map<string, Set<string>>();
    for (const row of db.prepare(`
      SELECT term, doc_id, field, tf, token_weight, positions_json, sources_json
      FROM postings
      ORDER BY term, doc_id, field
    `).all() as PostingRow[]) {
      (terms[row.term] ??= { df: 0, postings: [] }).postings.push(parsePosting(row));
      let docIds = termDocs.get(row.term);
      if (!docIds) termDocs.set(row.term, (docIds = new Set()));
      docIds.add(row.doc_id);
    }
    for (const [term, docIds] of termDocs) terms[term].df = docIds.size;

    return { version: BM25_INDEX_VERSION, ...metadata, docs, terms };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * 只读取本次查询所需的 postings 和匹配文档。
 * N/avgdl 与 df 仍取整个 source shard，保证评分和完整索引一致。
 */
export function readBm25QueryIndex(query: string, sourceId?: string): Bm25Index | null {
  if (!ensureDatabase(sourceId)) return null;
  let db: Database.Database | null = null;
  try {
    db = openReadable(bm25DbFile(sourceId));
    const metadata = readMetadata(db);
    if (!metadata) return null;

    const queryTerms = [...new Set(analyze(query).map(token => token.normalized))];
    const docs: Record<string, Bm25DocRecord> = {};
    const terms: Record<string, Bm25TermEntry> = {};
    if (queryTerms.length === 0) {
      return { version: BM25_INDEX_VERSION, ...metadata, docs, terms };
    }

    bindChunks(queryTerms, (chunk, placeholders) => {
      const rows = db!.prepare(`
        SELECT
          p.term, p.doc_id, p.field, p.tf, p.token_weight, p.positions_json, p.sources_json,
          d.len, d.fields_json, d.terms_json
        FROM postings p
        JOIN documents d ON d.doc_id = p.doc_id
        WHERE p.term IN (${placeholders})
        ORDER BY p.term, p.doc_id, p.field
      `).all(...chunk) as QueryPostingRow[];
      for (const row of rows) {
        docs[row.doc_id] ??= parseDocument(row);
        (terms[row.term] ??= { df: 0, postings: [] }).postings.push(parsePosting(row));
      }

      const dfRows = db!.prepare(`
        SELECT term, COUNT(DISTINCT doc_id) AS df
        FROM postings
        WHERE term IN (${placeholders})
        GROUP BY term
      `).all(...chunk) as DfRow[];
      for (const row of dfRows) {
        if (terms[row.term]) terms[row.term].df = row.df;
      }
    });

    return { version: BM25_INDEX_VERSION, ...metadata, docs, terms };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** 全量替换 SQLite 索引，用于 refresh/rebuild 和首次 JSON 迁移。 */
export function writeBm25Index(index: Bm25Index, sourceId?: string): void {
  const path = bm25DbFile(sourceId);
  closeWritableDatabase(path);
  const db = new Database(path);
  try {
    configureWritable(db);
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS postings;
        DROP TABLE IF EXISTS documents;
        DROP TABLE IF EXISTS metadata;
      `);
      db.exec(SCHEMA_SQL);
      db.pragma(`user_version = ${BM25_INDEX_VERSION}`);
      insertIndexRows(db, index);
    })();
  } finally {
    db.close();
  }
}

/** 单文档事务更新；不会读取或重写其他文档的 postings。 */
export function upsertBm25Document(
  documentIndex: Bm25Index,
  relPath: string,
  sourceId?: string,
  previousRelPath?: string,
): void {
  if (!ensureDatabase(sourceId)) {
    throw new Error("BM25 SQLite index is missing; run a full refresh first");
  }

  const db = writableDatabase(sourceId);
  db.transaction(() => {
    const removeDocument = db.prepare("DELETE FROM documents WHERE doc_id = ?");
    if (previousRelPath && previousRelPath !== relPath) removeDocument.run(previousRelPath);
    removeDocument.run(relPath);

    const doc = documentIndex.docs[relPath];
    if (doc) {
      db.prepare(`
        INSERT INTO documents(doc_id, len, fields_json, terms_json)
        VALUES (?, ?, ?, ?)
      `).run(doc.relPath, doc.len, JSON.stringify(doc.fields), JSON.stringify(doc.terms ?? []));

      const insertPosting = db.prepare(`
        INSERT INTO postings(
          term, doc_id, field, tf, token_weight, positions_json, sources_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [term, termEntry] of Object.entries(documentIndex.terms)) {
        for (const posting of termEntry.postings) {
          if (posting.docId !== relPath) continue;
          insertPosting.run(
            term,
            posting.docId,
            posting.field,
            posting.tf,
            posting.tokenWeight,
            JSON.stringify(posting.positions),
            JSON.stringify(posting.sources),
          );
        }
      }
    }

    const aggregate = db.prepare(`
      SELECT COUNT(*) AS N, AVG(len) AS avgdl FROM documents
    `).get() as AggregateRow;
    const updateMetadata = db.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    updateMetadata.run("N", String(aggregate.N));
    updateMetadata.run("avgdl", String(aggregate.avgdl ?? 0));
  })();
}

registerWikiHomeChangeHandler(() => closeBm25Databases());
