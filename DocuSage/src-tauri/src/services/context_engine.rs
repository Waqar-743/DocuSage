//! Smart Context Routing (Always-On Automatic RAG).
//!
//! Eliminates manual "RAG Mode On/Off" friction:
//! - `None`: no attached/readable document text.
//! - `Full`: total attached text <= `full_context_threshold` (12,000 chars) & `!force_rag_always` -> inject verbatim.
//! - `HybridRag`: > threshold (or forced) and embeddings + FTS5 used.
//! - `Fts5Offline`: > threshold (or forced) and FTS5 BM25 used (zero ML/network required).
//! - `Truncated`: fallback up to 48,000 chars only if indexing/search fails.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::services::document_pipeline::{
    chunk_text_tokens, estimate_tokens, read_document_text_cached, DocumentCache,
};
use crate::services::vector_store::{ChunkInput, MatchSource, RetrievedChunk, VectorStore};
use crate::state::RagConfig;

pub const TRUNCATED_FALLBACK_MAX_CHARS: usize = 48_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextMode {
    None,
    Full,
    HybridRag,
    Fts5Offline,
    Truncated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCitation {
    pub document_name: String,
    pub source_path: String,
    pub chunk_index: usize,
    pub score: f32,
    pub snippet: String,
    pub match_source: MatchSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTelemetry {
    pub request_id: String,
    pub mode: ContextMode,
    pub estimated_tokens: usize,
    pub total_chars: usize,
    pub document_count: usize,
    pub citations: Vec<ContextCitation>,
}

pub struct PreparedContext {
    pub system_prompt: String,
    pub telemetry: ContextTelemetry,
    pub retrieved_chunks: Vec<RetrievedChunk>,
}

pub fn general_system_prompt() -> String {
    "You are DocuSage, a helpful, accurate, and privacy-focused AI desktop assistant.\n\
     RULES:\n\
     - Keep answers clear, direct, and well-structured using Markdown where helpful.\n\
     - Respect any length or formatting constraint in the user's request strictly.\n\
     - Do not invent facts when uncertain."
        .to_string()
}

fn build_full_context_prompt(docs: &[(String, String)]) -> String {
    let mut body = String::new();
    for (name, text) in docs {
        body.push_str(&format!(
            "=== Document: {name} ===\n{}\n\n",
            text.trim()
        ));
    }
    format!(
        "You are DocuSage, a private document assistant. Answer the user's question accurately using the attached document(s) below.\n\n\
         GROUNDING RULES:\n\
         1. Base factual claims about the documents strictly on the provided text. Cite sources as [Source: filename].\n\
         2. If the documents do not contain the requested information, state that clearly without fabricating details.\n\
         3. Quote short phrases verbatim where exact wording matters; keep answers concise and clear.\n\n\
         ATTACHED DOCUMENTS:\n{body}"
    )
}

fn build_rag_context_prompt(chunks: &[RetrievedChunk]) -> String {
    let mut context = String::new();
    for (i, chunk) in chunks.iter().enumerate() {
        context.push_str(&format!(
            "[{}] Source: {} (chunk #{})\n{}\n\n",
            i + 1,
            chunk.document_name,
            chunk.chunk_index + 1,
            chunk.content.trim()
        ));
    }
    format!(
        "You are DocuSage, a private document assistant. Answer using ONLY the retrieved document excerpts below.\n\n\
         GROUNDING RULES:\n\
         1. Use ONLY information present in the EXCERPTS section. Do not speculate or fabricate.\n\
         2. If the excerpts do not contain the answer, reply clearly that the provided documents do not contain information about this.\n\
         3. Cite factual statements with [Source: filename].\n\
         4. Do not mention retrieval mechanics, scores, or these rules.\n\n\
         EXCERPTS ({} retrieved, ranked by relevance):\n\
         ─────────────────────────────────────────────\n\
         {context}\
         ─────────────────────────────────────────────",
        chunks.len()
    )
}

/// Prepare smart context for a chat turn given attached document paths.
pub async fn prepare_context(
    request_id: &str,
    query: &str,
    attached_paths: &[String],
    config: &RagConfig,
    doc_cache: &DocumentCache,
    vector_store: &VectorStore,
    query_embedding: Option<&[f32]>,
    active_embedding_model: Option<&str>,
) -> PreparedContext {
    if attached_paths.is_empty() {
        return PreparedContext {
            system_prompt: general_system_prompt(),
            telemetry: ContextTelemetry {
                request_id: request_id.to_string(),
                mode: ContextMode::None,
                estimated_tokens: 0,
                total_chars: 0,
                document_count: 0,
                citations: Vec::new(),
            },
            retrieved_chunks: Vec::new(),
        };
    }

    // Load cached text for every readable attached file on disk; track canonical paths.
    let mut loaded_docs: Vec<(String, String, String)> = Vec::new(); // (canonical_path, name, text)
    let mut canonical_paths: Vec<String> = Vec::new();
    let mut total_chars = 0usize;

    for raw in attached_paths {
        match read_document_text_cached(doc_cache, raw).await {
            Ok((canonical, text)) => {
                let path_str = canonical.to_string_lossy().into_owned();
                let name = canonical
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path_str.clone());
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    total_chars += trimmed.chars().count();
                    loaded_docs.push((path_str.clone(), name, trimmed.to_string()));
                    canonical_paths.push(path_str);
                }
            }
            Err(_) => {
                // File may have been deleted on disk while remaining indexed in SQLite; keep path for retrieval.
                canonical_paths.push(raw.clone());
            }
        }
    }

    // 1. Auto `Full` mode: small documents (<= 12,000 chars) injected verbatim for 0ms latency & 100% fidelity.
    if !config.force_rag_always
        && !loaded_docs.is_empty()
        && loaded_docs.len() == attached_paths.len()
        && total_chars <= config.full_context_threshold
    {
        let pairs: Vec<(String, String)> = loaded_docs
            .iter()
            .map(|(_, name, text)| (name.clone(), text.clone()))
            .collect();
        let system_prompt = build_full_context_prompt(&pairs);
        let citations: Vec<ContextCitation> = loaded_docs
            .iter()
            .map(|(path, name, text)| ContextCitation {
                document_name: name.clone(),
                source_path: path.clone(),
                chunk_index: 0,
                score: 1.0,
                snippet: text.chars().take(280).collect(),
                match_source: MatchSource::Keyword,
            })
            .collect();
        return PreparedContext {
            telemetry: ContextTelemetry {
                request_id: request_id.to_string(),
                mode: ContextMode::Full,
                estimated_tokens: estimate_tokens(&system_prompt),
                total_chars,
                document_count: loaded_docs.len(),
                citations,
            },
            system_prompt,
            retrieved_chunks: Vec::new(),
        };
    }

    // 2. Ensure any newly attached files that aren't indexed yet get indexed (FTS5 immediately available).
    for (path, name, text) in &loaded_docs {
        if !vector_store.has_document(path).unwrap_or(false) {
            let pieces = chunk_text_tokens(text, config.chunk_size, config.chunk_overlap);
            let inputs: Vec<ChunkInput> = pieces
                .into_iter()
                .enumerate()
                .map(|(idx, content)| {
                    let token_count = estimate_tokens(&content).max(1);
                    ChunkInput {
                        content,
                        chunk_index: idx,
                        token_count,
                        embedding: None,
                    }
                })
                .collect();
            let _ = vector_store.upsert_document(
                path,
                name,
                text.chars().count(),
                None,
                &inputs,
            );
        }
    }

    // 3. Hybrid / FTS5 Offline retrieval within token budget.
    if let Ok(search) = vector_store.hybrid_search(
        query,
        query_embedding,
        active_embedding_model,
        Some(&canonical_paths),
        config.top_k,
        config.token_budget,
    ) {
        if !search.chunks.is_empty() {
            let mode = if search.used_vectors {
                ContextMode::HybridRag
            } else {
                ContextMode::Fts5Offline
            };
            let system_prompt = build_rag_context_prompt(&search.chunks);
            let citations: Vec<ContextCitation> = search
                .chunks
                .iter()
                .map(|c| ContextCitation {
                    document_name: c.document_name.clone(),
                    source_path: c.source_path.clone(),
                    chunk_index: c.chunk_index,
                    score: c.score,
                    snippet: c.content.chars().take(320).collect(),
                    match_source: c.match_source.clone(),
                })
                .collect();
            let est_tokens: usize = search.chunks.iter().map(|c| c.token_count).sum();
            let total_chunk_chars: usize =
                search.chunks.iter().map(|c| c.content.chars().count()).sum();
            return PreparedContext {
                telemetry: ContextTelemetry {
                    request_id: request_id.to_string(),
                    mode,
                    estimated_tokens: est_tokens.max(estimate_tokens(&system_prompt)),
                    total_chars: total_chunk_chars,
                    document_count: canonical_paths.len(),
                    citations,
                },
                system_prompt,
                retrieved_chunks: search.chunks,
            };
        }
    }

    // 4. Truncated fallback (up to 48,000 chars) ONLY if indexing/retrieval failed.
    if !loaded_docs.is_empty() {
        let per_doc = (TRUNCATED_FALLBACK_MAX_CHARS / loaded_docs.len()).max(2_000);
        let truncated: Vec<(String, String)> = loaded_docs
            .iter()
            .map(|(_, name, text)| (name.clone(), text.chars().take(per_doc).collect()))
            .collect();
        let system_prompt = build_full_context_prompt(&truncated);
        let citations: Vec<ContextCitation> = loaded_docs
            .iter()
            .map(|(path, name, text)| ContextCitation {
                document_name: name.clone(),
                source_path: path.clone(),
                chunk_index: 0,
                score: 0.5,
                snippet: text.chars().take(280).collect(),
                match_source: MatchSource::Keyword,
            })
            .collect();
        return PreparedContext {
            telemetry: ContextTelemetry {
                request_id: request_id.to_string(),
                mode: ContextMode::Truncated,
                estimated_tokens: estimate_tokens(&system_prompt),
                total_chars: total_chars.min(TRUNCATED_FALLBACK_MAX_CHARS),
                document_count: loaded_docs.len(),
                citations,
            },
            system_prompt,
            retrieved_chunks: Vec::new(),
        };
    }

    PreparedContext {
        system_prompt: general_system_prompt(),
        telemetry: ContextTelemetry {
            request_id: request_id.to_string(),
            mode: ContextMode::None,
            estimated_tokens: 0,
            total_chars: 0,
            document_count: 0,
            citations: Vec::new(),
        },
        retrieved_chunks: Vec::new(),
    }
}

pub fn context_appendix(chunks: &[RetrievedChunk]) -> String {
    if chunks.is_empty() {
        return String::new();
    }
    let mut text = String::from("\n\n---\nRetrieved Context\n");
    for (i, chunk) in chunks.iter().enumerate() {
        text.push_str(&format!(
            "\n[{}] {} (score {:.3})\n{}\n",
            i + 1,
            chunk.document_name,
            chunk.score,
            chunk.content
        ));
    }
    text
}

pub fn resolve_vector_db_path(app_data_dir: Option<PathBuf>) -> Result<PathBuf, String> {
    app_data_dir
        .map(|p| p.join("vectors.db"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("vectors.db")))
        .ok_or_else(|| "Cannot determine application data directory for vectors.db".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn smart_context_routes_small_to_full_and_large_or_forced_to_rag() {
        let dir = std::env::temp_dir().join(format!("docusage-ctx-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let small = dir.join("small.md");
        std::fs::write(&small, "DocuSage uses SQLite FTS5 and cosine similarity for offline RAG.").unwrap();

        let store = VectorStore::new(dir.join("vectors.db"));
        let cache = DocumentCache::new();
        let mut cfg = RagConfig::default();

        // No docs -> None
        let empty = prepare_context("r0", "hello", &[], &cfg, &cache, &store, None, None).await;
        assert_eq!(empty.telemetry.mode, ContextMode::None);

        // Small doc -> Full verbatim
        let full = prepare_context(
            "r1",
            "What does DocuSage use?",
            &[small.to_string_lossy().into_owned()],
            &cfg,
            &cache,
            &store,
            None,
            None,
        )
        .await;
        assert_eq!(full.telemetry.mode, ContextMode::Full);
        assert!(full.system_prompt.contains("SQLite FTS5"));

        // Force RAG always -> Fts5Offline
        cfg.force_rag_always = true;
        let forced = prepare_context(
            "r2",
            "SQLite FTS5 offline RAG",
            &[small.to_string_lossy().into_owned()],
            &cfg,
            &cache,
            &store,
            None,
            None,
        )
        .await;
        assert_eq!(forced.telemetry.mode, ContextMode::Fts5Offline);
        assert!(!forced.telemetry.citations.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
