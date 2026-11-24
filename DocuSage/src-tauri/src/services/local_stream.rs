//! Streaming token post-processing: UTF-8 reassembly, reasoning tag filtering,
//! and repetition-loop detection.

/// Buffers token bytes and releases only complete UTF-8 text.
#[derive(Default)]
pub struct Utf8Assembler {
    pending: Vec<u8>,
}

impl Utf8Assembler {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(err) => {
                    let valid = err.valid_up_to();
                    out.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                    match err.error_len() {
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }

    pub fn reset(&mut self) {
        self.pending.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamChunk {
    Answer(String),
    Reasoning(String),
}

const OPEN_MARKERS: &[&str] = &[
    "<think>",
    "<|channel>thought\n",
    "<|channel>thought",
    "<|channel>",
];
const CLOSE_MARKERS: &[&str] = &["</think>", "<channel|>"];

pub fn prompt_opens_reasoning(prompt: &str) -> bool {
    let tail = prompt.trim_end();
    OPEN_MARKERS.iter().any(|m| tail.ends_with(m.trim_end()))
}

pub fn is_reasoning_marker(piece: &str) -> bool {
    let piece = piece.trim();
    OPEN_MARKERS
        .iter()
        .chain(CLOSE_MARKERS)
        .any(|m| m.trim() == piece)
}

pub struct ReplyFilter {
    in_reasoning: bool,
    answer_started: bool,
    section_started: bool,
    pending: String,
}

impl ReplyFilter {
    pub fn new(starts_in_reasoning: bool) -> Self {
        Self {
            in_reasoning: starts_in_reasoning,
            answer_started: false,
            section_started: false,
            pending: String::new(),
        }
    }

    pub fn push(&mut self, text: &str, out: &mut Vec<StreamChunk>) {
        self.pending.push_str(text);
        self.drain(false, out);
    }

    pub fn finish(&mut self, out: &mut Vec<StreamChunk>) {
        self.drain(true, out);
    }

    fn markers(&self) -> &'static [&'static str] {
        if self.in_reasoning {
            CLOSE_MARKERS
        } else if self.answer_started {
            &[]
        } else {
            OPEN_MARKERS
        }
    }

    fn emit(&mut self, text: &str, out: &mut Vec<StreamChunk>) {
        let text = if self.section_started {
            text
        } else {
            text.trim_start()
        };
        if text.is_empty() {
            return;
        }
        self.section_started = true;
        if self.in_reasoning {
            out.push(StreamChunk::Reasoning(text.to_string()));
        } else {
            self.answer_started = true;
            out.push(StreamChunk::Answer(text.to_string()));
        }
    }

    fn drain(&mut self, at_end: bool, out: &mut Vec<StreamChunk>) {
        loop {
            let markers = self.markers();
            let pending = std::mem::take(&mut self.pending);
            let mut search_from = 0;
            let mut resolved = false;

            while let Some(offset) = pending[search_from..].find('<') {
                let at = search_from + offset;
                let rest = &pending[at..];

                let undecided = !at_end
                    && markers
                        .iter()
                        .any(|m| m.len() > rest.len() && m.starts_with(rest));
                if undecided {
                    self.emit(&pending[..at], out);
                    self.pending = rest.to_string();
                    return;
                }

                if let Some(marker) = markers.iter().find(|m| rest.starts_with(**m)) {
                    self.emit(&pending[..at], out);
                    self.in_reasoning = !self.in_reasoning;
                    self.section_started = false;
                    self.pending = rest[marker.len()..].to_string();
                    resolved = true;
                    break;
                }
                search_from = at + 1;
            }

            if !resolved {
                self.emit(&pending, out);
                return;
            }
        }
    }
}

const STUCK_WINDOW: usize = 256;
const STUCK_MAX_PERIOD: usize = 32;

pub fn is_stuck(tokens: &[i32]) -> bool {
    (1..=STUCK_MAX_PERIOD).any(|period| {
        if tokens.len() < STUCK_WINDOW + period {
            return false;
        }
        let tail = &tokens[tokens.len() - STUCK_WINDOW - period..];
        tail.iter().zip(&tail[period..]).all(|(a, b)| a == b)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_think_tags_cleanly() {
        let mut filter = ReplyFilter::new(false);
        let mut chunks = Vec::new();
        for p in ["<", "thi", "nk>plan<", "/th", "ink>", "Hello!"] {
            filter.push(p, &mut chunks);
        }
        filter.finish(&mut chunks);
        assert!(chunks.contains(&StreamChunk::Reasoning("plan".into())));
        assert!(chunks.contains(&StreamChunk::Answer("Hello!".into())));
    }

    #[test]
    fn utf8_reassembles_split_emoji() {
        let bytes = "héllo 🙂".as_bytes();
        let mut asm = Utf8Assembler::default();
        let mut out = String::new();
        for b in bytes.chunks(1) {
            out.push_str(&asm.push(b));
        }
        assert_eq!(out, "héllo 🙂");
    }

    #[test]
    fn detects_stuck_loop() {
        let looping: Vec<i32> = (0..400).map(|i| i % 3).collect();
        assert!(is_stuck(&looping));
        assert!(!is_stuck(&[1, 2, 3, 4]));
    }
}
