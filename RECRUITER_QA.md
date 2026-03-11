# Recruiter Questions and Answers for DocuSage

## 1. What problem does DocuSage solve?

DocuSage helps users turn private PDFs into a searchable, conversational knowledge base from a desktop app. It is designed for people who want the convenience of AI-assisted document understanding without defaulting to a cloud-first workflow.

## 2. What makes this project technically interesting?

This is not just a chat interface. The project combines a React frontend, a Rust desktop backend with Tauri, local GGUF model inference, PDF parsing, embeddings, vector search, streaming responses, API integration, and release automation. The complexity comes from making all of those layers work together reliably on a real user machine.

## 3. Why did you choose Tauri instead of Electron?

I chose Tauri because I wanted a smaller desktop footprint and a backend that could live naturally in Rust. Since ingestion, retrieval, and orchestration logic already fit well in Rust, Tauri gave me a more coherent architecture than splitting those concerns across Electron and Node.

## 4. Why is the backend written in Rust?

Rust gave me better control over performance, native integration, structured error handling, and streaming workflows. It is a strong fit for file-system access, model orchestration, PDF processing, and vector database integration in a desktop environment.

## 5. How does the RAG pipeline work?

The pipeline is straightforward but production-oriented: extract text from PDF files, split that text into chunks, generate embeddings locally with `fastembed`, store the vectors in LanceDB, embed the user question, retrieve the top matching chunks, and then assemble a grounded prompt from those chunks before answer generation.

## 6. What is the hybrid Gemini mode?

Hybrid mode keeps indexing, storage, embeddings, and retrieval local, but uses Gemini 2.5 Flash for final answer synthesis. I added this because the local retrieval was working, but smaller local models were still inconsistent at composing high-quality answers from the retrieved context.

## 7. How do you handle privacy in this design?

The privacy boundary is explicit. In local mode, everything stays on-device. In hybrid mode, the app still performs ingestion and retrieval locally, and only the retrieved excerpts plus the user question are sent to Gemini. That is a more controlled and explainable privacy model than uploading full documents by default.

## 8. What was the hardest technical challenge?

The hardest part was proving whether the failure was in retrieval or generation. At first the system looked like a broken RAG pipeline, but deeper debugging showed the retriever was returning relevant chunks and the local model was the weaker link. That led directly to the hybrid architecture and stronger retrieval observability.

## 9. How did you debug hallucination and grounding issues?

I made the retrieval path loud instead of silent. I added explicit logging around chunk retrieval, removed silent fallback behavior when zero chunks were returned, and forced the system prompt to confirm how many chunks were injected. That made it much easier to isolate whether the issue was retrieval, prompt construction, or model behavior.

## 10. What are the strongest engineering decisions in this project?

The strongest decisions are the local-first architecture, the optional hybrid upgrade instead of a full cloud dependency, and using Tauri plus Rust for a native-feeling desktop product. Those choices keep the project grounded in real-world tradeoffs between privacy, performance, cost, and answer quality.

## 11. What would you improve next?

I would add stronger automated evaluation for retrieval quality, support more document types, improve release artifact consistency, and expand observability around prompt assembly and answer quality. I would also make the hybrid routing more configurable so users can choose local-only, hybrid, or quality-first behavior explicitly.

## 12. What does this project say about your engineering style?

It shows that I like building end-to-end systems rather than isolated demos. I am comfortable moving across UX, frontend engineering, Rust backend development, AI system debugging, product tradeoffs, and release automation to ship something that is technically credible and usable.

## 13. How would you explain this project in one sentence?

DocuSage is a local-first desktop AI assistant that turns private documents into a conversational knowledge base, with an optional hybrid reasoning layer for better answer quality.

## 14. How would you summarize this project for a recruiter?

This project demonstrates full-stack AI product engineering across React, Rust, desktop delivery, retrieval-augmented generation, local model inference, external API integration, and GitHub-based release automation. It is a practical product build, not just a thin wrapper around an LLM API.