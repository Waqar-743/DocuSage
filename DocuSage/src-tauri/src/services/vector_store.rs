//! SQLite Hybrid Vector + FTS5 Store (`vectors.db`).
//!
//! Replaces LanceDB + Arrow + FastEmbed with a single embedded SQLite database
//! running in WAL mode with FTS5 full-text search and in-Rust cosine similarity
//! merged via Reciprocal Rank Fusion (RRF).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const RRF_K: f32 = 60.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDocument {
    pub id: String,
    pub path: String,
    pub name: String,
    pub chunk_count: usize,
    pub char_count: usize,
    pub embedding_model: Option<String>,
    pub has_embeddings: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInput {
    pub content: String,
    pub chunk_index: usize,
    pub token_count: usize,
    pub embedding: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MatchSource {
    Hybrid,
    Vector,
    Keyword,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedChunk {
    pub document_name: String,
    pub source_path: String,
    pub content: String,
    pub chunk_index: usize,
    pub score: f32,
    pub token_count: usize,
    pub match_source: MatchSource,
}

#[derive(Debug, Clone)]
pub struct HybridSearchResult {
    pub chunks: Vec<RetrievedChunk>,
    pub used_vectors: bool,
    pub used_fts: bool,
}

pub struct VectorStore {
    db_path: PathBuf,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Pack a slice of `f32` values into little-endian bytes for compact SQLite BLOB storage.
pub fn encode_embedding(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for &v in vec {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

/// Unpack little-endian `f32` bytes back into a `Vec<f32>`.
pub fn decode_embedding(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(out)
}

/// Compute cosine similarity between two equal-length vectors directly against
/// a little-endian BLOB to avoid allocating a `Vec<f32>` per row during scans.
pub fn cosine_similarity_blob(query: &[f32], blob: &[u8]) -> Option<f32> {
    if query.is_empty() || blob.len() != query.len() * 4 {
        return None;
    }
    let mut dot = 0.0f32;
    let mut norm_q = 0.0f32;
    let mut norm_b = 0.0f32;
    for (q, chunk) in query.iter().zip(blob.chunks_exact(4)) {
        let b = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        dot += q * b;
        norm_q += q * q;
        norm_b += b * b;
    }
    let denom = norm_q.sqrt() * norm_b.sqrt();
    if denom <= f32::EPSILON || !denom.is_finite() {
        return Some(0.0);
    }
    Some((dot / denom).clamp(-1.0, 1.0))
}

/// Build a safe FTS5 MATCH expression from arbitrary natural-language user input.
/// Strips syntax operators and quotes each token so punctuation never causes SQL errors.
pub fn sanitize_fts_query(raw: &str) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in raw.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.push(ch);
        } else if !current.is_empty() {
            let tok = std::mem::take(&mut current);
            if tok.chars().count() >= 2 {
                tokens.push(tok.to_lowercase());
            }
        }
    }
    if !current.is_empty() && current.chars().count() >= 2 {
        tokens.push(current.to_lowercase());
    }

    // Drop very common stop words if other informative terms exist.
    const STOP: &[&str] = &[
        "the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "have", "has",
        "had", "what", "when", "where", "which", "who", "how", "why", "can", "could", "would",
        "should", "about", "into", "your", "does", "did", "not", "but", "you",
    ];
    let filtered: Vec<String> = tokens
        .iter()
        .filter(|t| !STOP.contains(&t.as_str()))
        .cloned()
        .collect();
    let chosen = if filtered.is_empty() { tokens } else { filtered };

    let mut seen = HashSet::new();
    let mut quoted = Vec::new();
    for tok in chosen {
        if seen.insert(tok.clone()) {
            quoted.push(format!("\"{}\"", tok.replace('"', "\"\"")));
        }
        if quoted.len() >= 16 {
            break;
        }
    }

    if quoted.is_empty() {
        None
    } else {
        Some(quoted.join(" OR "))
    }
}

impl VectorStore {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    fn open(&self) -> Result<Connection, String> {
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create vector store directory: {e}"))?;
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Cannot open SQLite vector store: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| format!("Failed to configure SQLite PRAGMAs: {e}"))?;
        self.ensure_schema(&conn)?;
        Ok(conn)
    }

    fn ensure_schema(&self, conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                id              TEXT PRIMARY KEY,
                source_path     TEXT UNIQUE NOT NULL,
                document_name   TEXT NOT NULL,
                char_count      INTEGER NOT NULL DEFAULT 0,
                chunk_count     INTEGER NOT NULL DEFAULT 0,
                embedding_model TEXT,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id     TEXT NOT NULL,
                document_name   TEXT NOT NULL,
                source_path     TEXT NOT NULL,
                content         TEXT NOT NULL,
                embedding       BLOB,
                embedding_model TEXT,
                chunk_index     INTEGER NOT NULL,
                token_count     INTEGER NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_source_path ON chunks(source_path);
            CREATE INDEX IF NOT EXISTS idx_chunks_embedding_model ON chunks(embedding_model);

            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content,
                document_name,
                content='chunks',
                content_rowid='id',
                tokenize='porter unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
                INSERT INTO chunks_fts(rowid, content, document_name)
                VALUES (new.id, new.content, new.document_name);
            END;

            CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content, document_name)
                VALUES ('delete', old.id, old.content, old.document_name);
            END;

            CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content, document_name)
                VALUES ('delete', old.id, old.content, old.document_name);
                INSERT INTO chunks_fts(rowid, content, document_name)
                VALUES (new.id, new.content, new.document_name);
            END;",
        )
        .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;
        Ok(())
    }

    /// Replace all chunks for `source_path` atomically in a single transaction.
    pub fn upsert_document(
        &self,
        source_path: &str,
        document_name: &str,
        char_count: usize,
        embedding_model: Option<&str>,
        chunks: &[ChunkInput],
    ) -> Result<String, String> {
        let mut conn = self.open()?;
        let now = unix_now();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {e}"))?;

        let existing_id: Option<String> = tx
            .query_row(
                "SELECT id FROM documents WHERE source_path = ?1",
                params![source_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to check existing document: {e}"))?;

        let doc_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());

        // Clear old chunks (triggers cleanly remove old FTS5 rows).
        tx.execute("DELETE FROM chunks WHERE document_id = ?1", params![&doc_id])
            .map_err(|e| format!("Failed to clear old chunks: {e}"))?;

        tx.execute(
            "INSERT INTO documents (id, source_path, document_name, char_count, chunk_count, embedding_model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(source_path) DO UPDATE SET
               document_name = excluded.document_name,
               char_count = excluded.char_count,
               chunk_count = excluded.chunk_count,
               embedding_model = excluded.embedding_model,
               updated_at = excluded.updated_at",
            params![
                &doc_id,
                source_path,
                document_name,
                char_count as i64,
                chunks.len() as i64,
                embedding_model,
                now,
                now
            ],
        )
        .map_err(|e| format!("Failed to upsert document metadata: {e}"))?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO chunks (document_id, document_name, source_path, content, embedding, embedding_model, chunk_index, token_count, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(|e| format!("Failed to prepare chunk insert: {e}"))?;

            for chunk in chunks {
                let blob = chunk.embedding.as_deref().map(encode_embedding);
                let model = if blob.is_some() { embedding_model } else { None };
                stmt.execute(params![
                    &doc_id,
                    document_name,
                    source_path,
                    &chunk.content,
                    blob,
                    model,
                    chunk.chunk_index as i64,
                    chunk.token_count as i64,
                    now
                ])
                .map_err(|e| format!("Failed to insert chunk {}: {e}", chunk.chunk_index))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit document upsert: {e}"))?;
        Ok(doc_id)
    }

    pub fn delete_document(&self, source_path: &str) -> Result<(), String> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM documents WHERE source_path = ?1",
            params![source_path],
        )
        .map_err(|e| format!("Failed to delete document: {e}"))?;
        Ok(())
    }

    pub fn list_documents(&self) -> Result<Vec<IndexedDocument>, String> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.source_path, d.document_name, d.chunk_count, d.char_count,
                        d.embedding_model, d.updated_at,
                        EXISTS(SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.embedding IS NOT NULL)
                 FROM documents d
                 ORDER BY d.updated_at DESC, d.document_name ASC",
            )
            .map_err(|e| format!("Failed to prepare list_documents: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(IndexedDocument {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    chunk_count: row.get::<_, i64>(3)?.max(0) as usize,
                    char_count: row.get::<_, i64>(4)?.max(0) as usize,
                    embedding_model: row.get(5)?,
                    updated_at: row.get(6)?,
                    has_embeddings: row.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(|e| format!("Failed to query indexed documents: {e}"))?;

        let mut docs = Vec::new();
        for row in rows {
            docs.push(row.map_err(|e| format!("Failed to decode document row: {e}"))?);
        }
        Ok(docs)
    }

    pub fn has_document(&self, source_path: &str) -> Result<bool, String> {
        if !self.db_path.exists() {
            return Ok(false);
        }
        let conn = self.open()?;
        let exists: i64 = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE source_path = ?1)",
                params![source_path],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to check document existence: {e}"))?;
        Ok(exists != 0)
    }

    /// Hybrid retrieval: always runs FTS5 BM25 keyword search, and when
    /// `query_embedding` + `embedding_model` are provided and matching vectors exist,
    /// scores ONLY `(id, embedding)` in Rust with cosine similarity, merges via
    /// Reciprocal Rank Fusion (RRF), and fetches `content` solely for top-K winners.
    pub fn hybrid_search(
        &self,
        query: &str,
        query_embedding: Option<&[f32]>,
        embedding_model: Option<&str>,
        source_paths: Option<&[String]>,
        top_k: usize,
        token_budget: usize,
    ) -> Result<HybridSearchResult, String> {
        if top_k == 0 {
            return Ok(HybridSearchResult {
                chunks: Vec::new(),
                used_vectors: false,
                used_fts: false,
            });
        }
        if !self.db_path.exists() {
            return Ok(HybridSearchResult {
                chunks: Vec::new(),
                used_vectors: false,
                used_fts: false,
            });
        }

        let conn = self.open()?;
        let fetch_k = (top_k * 4).max(20);
        let source_filter_set: Option<HashSet<&str>> = source_paths
            .filter(|s| !s.is_empty())
            .map(|s| s.iter().map(String::as_str).collect());

        // 1. FTS5 BM25 keyword search (100% offline, zero ML dependency).
        let mut fts_ranks: Vec<i64> = Vec::new();
        if let Some(fts_query) = sanitize_fts_query(query) {
            let sql = "SELECT c.id, c.source_path
                       FROM chunks_fts f
                       JOIN chunks c ON c.id = f.rowid
                       WHERE chunks_fts MATCH ?1
                       ORDER BY bm25(chunks_fts) ASC
                       LIMIT ?2";
            let overfetch = if source_filter_set.is_some() {
                (fetch_k * 5) as i64
            } else {
                fetch_k as i64
            };
            if let Ok(mut stmt) = conn.prepare(sql) {
                if let Ok(rows) = stmt.query_map(params![fts_query, overfetch], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                }) {
                    for row in rows.flatten() {
                        let (id, src) = row;
                        if let Some(ref allowed) = source_filter_set {
                            if !allowed.contains(src.as_str()) {
                                continue;
                            }
                        }
                        fts_ranks.push(id);
                        if fts_ranks.len() >= fetch_k {
                            break;
                        }
                    }
                }
            }
        }

        // 2. Vector cosine similarity scan (loads ONLY id + embedding BLOB, never content).
        let mut vec_scored: Vec<(i64, f32)> = Vec::new();
        if let (Some(q_vec), Some(model_name)) = (query_embedding, embedding_model) {
            if !q_vec.is_empty() && !model_name.is_empty() {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, source_path, embedding
                         FROM chunks
                         WHERE embedding IS NOT NULL AND embedding_model = ?1",
                    )
                    .map_err(|e| format!("Failed to prepare vector scan: {e}"))?;

                let rows = stmt
                    .query_map(params![model_name], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Vec<u8>>(2)?,
                        ))
                    })
                    .map_err(|e| format!("Failed to scan embeddings: {e}"))?;

                for row in rows.flatten() {
                    let (id, src, blob) = row;
                    if let Some(ref allowed) = source_filter_set {
                        if !allowed.contains(src.as_str()) {
                            continue;
                        }
                    }
                    if let Some(sim) = cosine_similarity_blob(q_vec, &blob) {
                        if sim > 0.05 {
                            vec_scored.push((id, sim));
                        }
                    }
                }
                vec_scored.sort_by(|a, b| b.1.total_cmp(&a.1));
                vec_scored.truncate(fetch_k);
            }
        }

        let used_fts = !fts_ranks.is_empty();
        let used_vectors = !vec_scored.is_empty();

        // 3. Reciprocal Rank Fusion (RRF).
        let mut scores: HashMap<i64, (f32, bool, bool)> = HashMap::new();
        for (rank, id) in fts_ranks.iter().enumerate() {
            let entry = scores.entry(*id).or_insert((0.0, false, false));
            entry.0 += 1.0 / (RRF_K + rank as f32 + 1.0);
            entry.1 = true;
        }
        for (rank, (id, _sim)) in vec_scored.iter().enumerate() {
            let entry = scores.entry(*id).or_insert((0.0, false, false));
            entry.0 += 1.0 / (RRF_K + rank as f32 + 1.0);
            entry.2 = true;
        }

        // If neither FTS nor vector matched (e.g., query uses words absent from short doc),
        // fall back to leading chunks of the requested sources so the assistant still has context.
        let mut ranked_ids: Vec<(i64, f32, MatchSource)> = if scores.is_empty() {
            let mut fallback = Vec::new();
            let mut stmt = conn
                .prepare("SELECT id, source_path FROM chunks ORDER BY chunk_index ASC LIMIT ?1")
                .map_err(|e| format!("Failed to prepare fallback scan: {e}"))?;
            let rows = stmt
                .query_map(params![(fetch_k * 3) as i64], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed fallback scan: {e}"))?;
            for row in rows.flatten() {
                if let Some(ref allowed) = source_filter_set {
                    if !allowed.contains(row.1.as_str()) {
                        continue;
                    }
                }
                fallback.push((row.0, 0.005, MatchSource::Keyword));
                if fallback.len() >= top_k {
                    break;
                }
            }
            fallback
        } else {
            let mut list: Vec<(i64, f32, MatchSource)> = scores
                .into_iter()
                .map(|(id, (score, in_fts, in_vec))| {
                    let src = match (in_fts, in_vec) {
                        (true, true) => MatchSource::Hybrid,
                        (false, true) => MatchSource::Vector,
                        _ => MatchSource::Keyword,
                    };
                    (id, score, src)
                })
                .collect();
            list.sort_by(|a, b| b.1.total_cmp(&a.1));
            list.truncate((top_k * 3).max(top_k + 4));
            list
        };

        // 4. Fetch content ONLY for winning IDs.
        let mut stmt = conn
            .prepare(
                "SELECT document_name, source_path, content, chunk_index, token_count
                 FROM chunks WHERE id = ?1",
            )
            .map_err(|e| format!("Failed to prepare winner fetch: {e}"))?;

        let mut raw_winners = Vec::new();
        for (id, score, match_source) in ranked_ids.drain(..) {
            if let Ok(Some(row)) = stmt
                .query_row(params![id], |row| {
                    Ok(RetrievedChunk {
                        document_name: row.get(0)?,
                        source_path: row.get(1)?,
                        content: row.get(2)?,
                        chunk_index: row.get::<_, i64>(3)?.max(0) as usize,
                        score,
                        token_count: row.get::<_, i64>(4)?.max(1) as usize,
                        match_source: match_source.clone(),
                    })
                })
                .optional()
            {
                raw_winners.push(row);
            }
        }

        // 5. Deduplicate near-duplicates and enforce token_budget + top_k.
        let chunks = dedup_and_budget(raw_winners, top_k, token_budget);
        Ok(HybridSearchResult {
            chunks,
            used_vectors,
            used_fts,
        })
    }
}

fn dedup_and_budget(
    candidates: Vec<RetrievedChunk>,
    top_k: usize,
    token_budget: usize,
) -> Vec<RetrievedChunk> {
    let mut selected_tokens: Vec<HashSet<String>> = Vec::new();
    let mut out = Vec::new();
    let mut used_tokens = 0usize;

    for chunk in candidates {
        if out.len() >= top_k {
            break;
        }
        if !out.is_empty() && token_budget > 0 && used_tokens + chunk.token_count > token_budget {
            continue;
        }
        let toks: HashSet<String> = chunk
            .content
            .split_whitespace()
            .take(80)
            .map(|t| t.to_lowercase())
            .collect();
        let dup = selected_tokens.iter().any(|prev| {
            let inter = toks.intersection(prev).count() as f32;
            let union = toks.union(prev).count().max(1) as f32;
            (inter / union) > 0.72
        });
        if !dup {
            used_tokens += chunk.token_count;
            selected_tokens.push(toks);
            out.push(chunk);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(label: &str) -> VectorStore {
        let dir = std::env::temp_dir().join(format!(
            "docusage-vs-{label}-{}",
            Uuid::new_v4()
        ));
        VectorStore::new(dir.join("vectors.db"))
    }

    #[test]
    fn encode_decode_and_cosine_similarity_work_accurately() {
        let a = vec![1.0f32, 0.0, 0.5, -0.5];
        let b = vec![1.0f32, 0.0, 0.5, -0.5];
        let c = vec![-1.0f32, 0.0, -0.5, 0.5];
        let blob_b = encode_embedding(&b);
        let blob_c = encode_embedding(&c);

        assert_eq!(decode_embedding(&blob_b).unwrap(), b);
        assert!((cosine_similarity_blob(&a, &blob_b).unwrap() - 1.0).abs() < 1e-5);
        assert!((cosine_similarity_blob(&a, &blob_c).unwrap() + 1.0).abs() < 1e-5);
        // Dimension mismatch returns None safely.
        assert!(cosine_similarity_blob(&[1.0, 2.0], &blob_b).is_none());
    }

    #[test]
    fn fts5_offline_search_and_delete_preserve_other_docs() {
        let store = temp_store("fts5");
        store
            .upsert_document(
                "/tmp/O'Brien.pdf",
                "O'Brien.pdf",
                120,
                None,
                &[
                    ChunkInput {
                        content: "The quantum calibration schedule runs every Friday morning.".into(),
                        chunk_index: 0,
                        token_count: 15,
                        embedding: None,
                    },
                    ChunkInput {
                        content: "Quarterly budget allocations for laboratory instruments.".into(),
                        chunk_index: 1,
                        token_count: 12,
                        embedding: None,
                    },
                ],
            )
            .unwrap();
        store
            .upsert_document(
                "/tmp/handbook.md",
                "handbook.md",
                80,
                None,
                &[ChunkInput {
                    content: "Onboarding checklist and emergency evacuation routes.".into(),
                    chunk_index: 0,
                    token_count: 10,
                    embedding: None,
                }],
            )
            .unwrap();

        assert_eq!(store.list_documents().unwrap().len(), 2);

        // Query with punctuation that would break unescaped FTS5 queries.
        let res = store
            .hybrid_search("What is the calibration schedule? (Friday!)", None, None, None, 5, 4000)
            .unwrap();
        assert!(res.used_fts);
        assert!(!res.used_vectors);
        assert_eq!(res.chunks[0].document_name, "O'Brien.pdf");
        assert!(res.chunks[0].content.contains("quantum calibration"));

        store.delete_document("/tmp/O'Brien.pdf").unwrap();
        let remaining = store.list_documents().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, "/tmp/handbook.md");

        let _ = std::fs::remove_dir_all(store.db_path().parent().unwrap());
    }

    #[test]
    fn hybrid_rrf_combines_fts_and_vectors_and_isolates_embedding_models() {
        let store = temp_store("rrf");
        store
            .upsert_document(
                "/tmp/spec.md",
                "spec.md",
                200,
                Some("bge-small"),
                &[
                    ChunkInput {
                        content: "Authentication tokens expire after 15 minutes.".into(),
                        chunk_index: 0,
                        token_count: 10,
                        embedding: Some(vec![0.9, 0.1, 0.0]),
                    },
                    ChunkInput {
                        content: "Database snapshots are stored encrypted at rest.".into(),
                        chunk_index: 1,
                        token_count: 10,
                        embedding: Some(vec![0.0, 0.9, 0.1]),
                    },
                ],
            )
            .unwrap();

        // Matching model produces Hybrid hit (both FTS5 and cosine match chunk 0).
        let res = store
            .hybrid_search(
                "authentication expire",
                Some(&[0.95, 0.05, 0.0]),
                Some("bge-small"),
                None,
                5,
                4000,
            )
            .unwrap();
        assert!(res.used_fts && res.used_vectors);
        assert_eq!(res.chunks[0].chunk_index, 0);
        assert_eq!(res.chunks[0].match_source, MatchSource::Hybrid);

        // Different embedding model name must NEVER compare incompatible vectors.
        let mismatch = store
            .hybrid_search(
                "encrypted snapshots",
                Some(&[0.0, 1.0, 0.0]),
                Some("gemini-embedding-001"),
                None,
                5,
                4000,
            )
            .unwrap();
        assert!(mismatch.used_fts);
        assert!(!mismatch.used_vectors);
        assert_eq!(mismatch.chunks[0].chunk_index, 1);

        let _ = std::fs::remove_dir_all(store.db_path().parent().unwrap());
    }
}
