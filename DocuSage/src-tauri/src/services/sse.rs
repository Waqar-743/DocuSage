//! Incremental SSE (Server-Sent Events) and NDJSON parser supporting
//! OpenAI-compatible (llama-server, OpenAI, OpenRouter, LM Studio, Custom),
//! Anthropic Messages, Google Gemini (`streamGenerateContent?alt=sse`), and Ollama NDJSON.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamDelta {
    Token(String),
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamFormat {
    OpenAiSse,
    AnthropicSse,
    GeminiSse,
    OllamaNdjson,
}

/// Stateful byte-stream parser that safely handles arbitrary network chunk splits
/// (including mid-UTF-8 sequences and CRLF/LF event boundaries).
pub struct StreamParser {
    format: StreamFormat,
    raw_buf: Vec<u8>,
    text_buf: String,
}

impl StreamParser {
    pub fn new(format: StreamFormat) -> Self {
        Self {
            format,
            raw_buf: Vec::new(),
            text_buf: String::new(),
        }
    }

    /// Push incoming response bytes and return all decoded text tokens or `Done` signals.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<StreamDelta> {
        self.raw_buf.extend_from_slice(bytes);
        self.drain_valid_utf8();

        match self.format {
            StreamFormat::OllamaNdjson => self.parse_ndjson_lines(),
            StreamFormat::OpenAiSse | StreamFormat::AnthropicSse | StreamFormat::GeminiSse => {
                self.parse_sse_frames()
            }
        }
    }

    /// Flush any trailing buffered data at EOF.
    pub fn finish(&mut self) -> Vec<StreamDelta> {
        if !self.raw_buf.is_empty() {
            let lossy = String::from_utf8_lossy(&self.raw_buf).into_owned();
            self.text_buf.push_str(&lossy);
            self.raw_buf.clear();
        }
        let mut out = Vec::new();
        let remainder = self.text_buf.trim().to_string();
        self.text_buf.clear();
        if !remainder.is_empty() {
            match self.format {
                StreamFormat::OllamaNdjson => {
                    if let Some(delta) = parse_ollama_line(&remainder) {
                        out.push(delta);
                    }
                }
                _ => {
                    if let Some(delta) = self.parse_sse_event_block(&remainder) {
                        out.push(delta);
                    }
                }
            }
        }
        out
    }

    fn drain_valid_utf8(&mut self) {
        if self.raw_buf.is_empty() {
            return;
        }
        match std::str::from_utf8(&self.raw_buf) {
            Ok(valid) => {
                self.text_buf.push_str(valid);
                self.raw_buf.clear();
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    if let Ok(valid) = std::str::from_utf8(&self.raw_buf[..valid_up_to]) {
                        self.text_buf.push_str(valid);
                    }
                    self.raw_buf.drain(..valid_up_to);
                }
                if let Some(error_len) = err.error_len() {
                    // Truly invalid byte sequence; emit replacement and skip it.
                    self.text_buf.push('\u{FFFD}');
                    self.raw_buf.drain(..error_len);
                    self.drain_valid_utf8();
                }
                // Otherwise incomplete trailing UTF-8 char — wait for next chunk.
            }
        }
    }

    fn parse_ndjson_lines(&mut self) -> Vec<StreamDelta> {
        let mut deltas = Vec::new();
        while let Some(pos) = self.text_buf.find('\n') {
            let line = self.text_buf[..pos].trim().to_string();
            self.text_buf.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            if let Some(delta) = parse_ollama_line(&line) {
                deltas.push(delta);
            }
        }
        deltas
    }

    fn parse_sse_frames(&mut self) -> Vec<StreamDelta> {
        let mut deltas = Vec::new();
        loop {
            // Find earliest frame boundary: either \r\n\r\n or \n\n.
            let crlf = self.text_buf.find("\r\n\r\n").map(|i| (i, 4));
            let lf = self.text_buf.find("\n\n").map(|i| (i, 2));
            let boundary = match (crlf, lf) {
                (Some((a, la)), Some((b, lb))) => {
                    if a < b {
                        Some((a, la))
                    } else {
                        Some((b, lb))
                    }
                }
                (Some(x), None) | (None, Some(x)) => Some(x),
                (None, None) => None,
            };

            let Some((idx, sep_len)) = boundary else {
                break;
            };

            let block = self.text_buf[..idx].to_string();
            self.text_buf.drain(..idx + sep_len);
            if let Some(delta) = self.parse_sse_event_block(&block) {
                deltas.push(delta);
            }
        }
        deltas
    }

    fn parse_sse_event_block(&self, block: &str) -> Option<StreamDelta> {
        let mut event_name: Option<&str> = None;
        let mut data_lines: Vec<&str> = Vec::new();

        for raw_line in block.lines() {
            let line = raw_line.trim_end_matches('\r');
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            if let Some(ev) = line.strip_prefix("event:") {
                event_name = Some(ev.trim());
            } else if let Some(data) = line.strip_prefix("data:") {
                data_lines.push(data.strip_prefix(' ').unwrap_or(data));
            }
        }

        if data_lines.is_empty() {
            return None;
        }
        let payload = data_lines.join("\n");
        let trimmed = payload.trim();
        if trimmed == "[DONE]" {
            return Some(StreamDelta::Done);
        }

        let json: Value = serde_json::from_str(trimmed).ok()?;
        match self.format {
            StreamFormat::OpenAiSse => parse_openai_payload(&json),
            StreamFormat::AnthropicSse => parse_anthropic_payload(event_name, &json),
            StreamFormat::GeminiSse => parse_gemini_payload(&json),
            StreamFormat::OllamaNdjson => None,
        }
    }
}

fn parse_openai_payload(json: &Value) -> Option<StreamDelta> {
    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
        if !content.is_empty() {
            return Some(StreamDelta::Token(sanitize_control_tokens(content)));
        }
    }
    if json["choices"][0]["finish_reason"]
        .as_str()
        .is_some_and(|r| !r.is_empty())
    {
        return Some(StreamDelta::Done);
    }
    None
}

fn parse_anthropic_payload(event_name: Option<&str>, json: &Value) -> Option<StreamDelta> {
    let kind = event_name.or_else(|| json["type"].as_str()).unwrap_or("");
    match kind {
        "content_block_delta" => json["delta"]["text"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| StreamDelta::Token(s.to_string())),
        "message_stop" => Some(StreamDelta::Done),
        _ => None,
    }
}

fn parse_gemini_payload(json: &Value) -> Option<StreamDelta> {
    let parts = json["candidates"][0]["content"]["parts"].as_array()?;
    let mut text = String::new();
    for part in parts {
        if let Some(t) = part["text"].as_str() {
            text.push_str(t);
        }
    }
    if !text.is_empty() {
        Some(StreamDelta::Token(text))
    } else {
        None
    }
}

fn parse_ollama_line(line: &str) -> Option<StreamDelta> {
    let json: Value = serde_json::from_str(line).ok()?;
    if let Some(content) = json["message"]["content"].as_str() {
        if !content.is_empty() {
            return Some(StreamDelta::Token(content.to_string()));
        }
    }
    if json["done"].as_bool() == Some(true) {
        return Some(StreamDelta::Done);
    }
    None
}

/// Strip stray GGUF chat-template control tokens if a local model leaks them.
pub fn sanitize_control_tokens(raw: &str) -> String {
    if !raw.contains('<') {
        return raw.to_string();
    }
    let mut out = raw.to_string();
    for marker in [
        "<|assistant|>",
        "<|user|>",
        "<|system|>",
        "<|end|>",
        "<|endoftext|>",
        "<|im_start|>",
        "<|im_end|>",
        "<|eot_id|>",
        "<|end_of_turn|>",
        "</s>",
        "<s>",
        "<|END|>",
    ] {
        out = out.replace(marker, "");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_sse_handles_fragmented_chunks_and_done() {
        let mut p = StreamParser::new(StreamFormat::OpenAiSse);
        let part1 = b"data: {\"choices\":[{\"delta\":{\"content\":\"Hel";
        let part2 = b"lo \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\r\n\r\ndata: [DONE]\n\n";

        assert!(p.push(part1).is_empty());
        let deltas = p.push(part2);
        assert_eq!(
            deltas,
            vec![
                StreamDelta::Token("Hello ".into()),
                StreamDelta::Token("world".into()),
                StreamDelta::Done
            ]
        );
    }

    #[test]
    fn anthropic_sse_extracts_text_deltas_and_stop() {
        let mut p = StreamParser::new(StreamFormat::AnthropicSse);
        let payload = concat!(
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Private \"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"AI\"}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n"
        );
        assert_eq!(
            p.push(payload.as_bytes()),
            vec![
                StreamDelta::Token("Private ".into()),
                StreamDelta::Token("AI".into()),
                StreamDelta::Done
            ]
        );
    }

    #[test]
    fn gemini_sse_and_utf8_split_work_cleanly() {
        let mut p = StreamParser::new(StreamFormat::GeminiSse);
        let full = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"🌿 DocuSage\"}]}}]}\n\n";
        let bytes = full.as_bytes();
        // Split right inside the 4-byte emoji UTF-8 sequence.
        let split_at = full.find('🌿').unwrap() + 2;
        assert!(p.push(&bytes[..split_at]).is_empty());
        assert_eq!(
            p.push(&bytes[split_at..]),
            vec![StreamDelta::Token("🌿 DocuSage".into())]
        );
    }

    #[test]
    fn ollama_ndjson_streams_tokens_and_done() {
        let mut p = StreamParser::new(StreamFormat::OllamaNdjson);
        let stream = concat!(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"Offline \"},\"done\":false}\n",
            "{\"message\":{\"role\":\"assistant\",\"content\":\"RAG\"},\"done\":false}\n",
            "{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true}\n"
        );
        assert_eq!(
            p.push(stream.as_bytes()),
            vec![
                StreamDelta::Token("Offline ".into()),
                StreamDelta::Token("RAG".into()),
                StreamDelta::Done
            ]
        );
    }
}
