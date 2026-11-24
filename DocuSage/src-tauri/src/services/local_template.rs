//! Chat prompt formatting using each GGUF's embedded Jinja2 chat template.
//!
//! Renders the exact template stored in the model's metadata (`tokenizer.chat_template`),
//! with ChatML fallback when a model does not embed one.

use minijinja::value::Value;
use minijinja::{context, Environment, Error, ErrorKind};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TemplateMessage {
    pub role: &'static str,
    pub content: String,
}

impl TemplateMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
        }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant",
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatTemplate {
    source: String,
    bos_token: String,
    eos_token: String,
}

const CHATML_FALLBACK: &str = "{%- for message in messages -%}\
{{- '<|im_start|>' + message.role + '\\n' + message.content + '<|im_end|>\\n' -}}\
{%- endfor -%}\
{%- if add_generation_prompt -%}{{- '<|im_start|>assistant\\n' -}}{%- endif -%}";

impl ChatTemplate {
    pub fn new(source: Option<String>, bos_token: String, eos_token: String) -> Self {
        let source = match source {
            Some(s) if !s.trim().is_empty() => strip_generation_tags(&s),
            _ => CHATML_FALLBACK.to_string(),
        };
        Self {
            source,
            bos_token,
            eos_token,
        }
    }

    pub fn supports_thinking_switch(&self) -> bool {
        self.source.contains("enable_thinking")
    }

    pub fn render(
        &self,
        messages: &[TemplateMessage],
        add_generation_prompt: bool,
        enable_thinking: bool,
    ) -> Result<String, String> {
        let mut env = Environment::new();
        env.set_trim_blocks(true);
        env.set_lstrip_blocks(true);
        env.set_unknown_method_callback(minijinja_contrib::pycompat::unknown_method_callback);
        env.add_function("raise_exception", raise_exception);
        env.add_function("strftime_now", strftime_now);

        let template = env
            .template_from_str(&self.source)
            .map_err(|e| format!("Chat template could not be parsed: {e}"))?;
        template
            .render(context! {
                messages => messages,
                add_generation_prompt => add_generation_prompt,
                enable_thinking => enable_thinking,
                bos_token => self.bos_token,
                eos_token => self.eos_token,
            })
            .map_err(|e| format!("Chat template could not be applied: {e}"))
    }

    pub fn bos_token(&self) -> &str {
        &self.bos_token
    }
}

fn raise_exception(message: String) -> Result<Value, Error> {
    Err(Error::new(ErrorKind::InvalidOperation, message))
}

fn strftime_now(format: String) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    if write!(out, "{}", chrono::Local::now().format(&format)).is_err() {
        out = chrono::Local::now().format("%Y-%m-%d").to_string();
    }
    out
}

fn strip_generation_tags(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("{%") {
        let Some(len) = rest[start..].find("%}") else {
            break;
        };
        let end = start + len + 2;
        let tag = &rest[start..end];
        let inner = tag[2..tag.len() - 2].trim_matches(|c: char| c == '-' || c.is_whitespace());
        out.push_str(&rest[..start]);
        if inner == "generation" || inner == "endgeneration" {
            let lead = if tag.starts_with("{%-") { "{#-" } else { "{#" };
            let trail = if tag.ends_with("-%}") { "-#}" } else { "#}" };
            out.push_str(lead);
            out.push_str(trail);
        } else {
            out.push_str(tag);
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_template_falls_back_to_chatml() {
        let t = ChatTemplate::new(None, String::new(), "<|im_end|>".into());
        let msgs = vec![
            TemplateMessage::system("Be brief."),
            TemplateMessage::user("Hi"),
        ];
        let out = t.render(&msgs, true, false).unwrap();
        assert!(out.starts_with("<|im_start|>system\nBe brief.<|im_end|>\n"));
        assert!(out.ends_with("<|im_start|>assistant\n"));
        assert!(!t.supports_thinking_switch());
    }

    #[test]
    fn strips_hf_generation_tags() {
        let src = "{%- for m in messages -%}{{- m.role + ':' -}}{%- generation -%}{{- m.content -}}{%- endgeneration -%}{{- ';' -}}{%- endfor -%}";
        let t = ChatTemplate::new(Some(src.into()), String::new(), String::new());
        let out = t
            .render(
                &[TemplateMessage::user("x"), TemplateMessage::assistant("y")],
                false,
                false,
            )
            .unwrap();
        assert_eq!(out, "user:x;assistant:y;");
    }
}
