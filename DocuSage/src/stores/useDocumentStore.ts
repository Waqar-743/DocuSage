import { create } from 'zustand';
import * as api from '../lib/api';
import type { ContextTelemetry, IndexedDocument } from '../types';
import { useUiStore } from './useUiStore';

type DocumentState = {
  documents: IndexedDocument[];
  allowedExtensions: string[];
  ingestingPaths: Record<string, boolean>;
  latestTelemetry: ContextTelemetry | null;
  telemetryHistory: ContextTelemetry[];

  hydrateDocuments: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
  ingestFile: (filePath: string) => Promise<IndexedDocument | null>;
  removeDocument: (filePath: string) => Promise<void>;
  recordTelemetry: (telemetry: ContextTelemetry) => void;
};

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  allowedExtensions: [...api.DEFAULT_ALLOWED_EXTENSIONS],
  ingestingPaths: {},
  latestTelemetry: null,
  telemetryHistory: [],

  hydrateDocuments: async () => {
    try {
      const [docs, exts] = await Promise.all([
        api.listIndexedDocuments(),
        api.getAllowedExtensions(),
      ]);
      set({
        documents: Array.isArray(docs) ? docs : [],
        allowedExtensions: Array.isArray(exts) && exts.length > 0 ? exts : [...api.DEFAULT_ALLOWED_EXTENSIONS],
      });
    } catch {
      // Safe fallback
    }
  },

  refreshDocuments: async () => {
    try {
      const docs = await api.listIndexedDocuments();
      set({ documents: Array.isArray(docs) ? docs : [] });
    } catch {
      // Ignore refresh failure
    }
  },

  ingestFile: async (filePath) => {
    set((s) => ({ ingestingPaths: { ...s.ingestingPaths, [filePath]: true } }));
    try {
      const res = await api.ingestDocument(filePath);
      const doc: IndexedDocument = {
        id: res.sourcePath,
        path: res.sourcePath,
        name: res.fileName,
        chunkCount: res.chunkCount,
        charCount: res.charCount,
        embeddingModel: res.embeddingModel,
        hasEmbeddings: res.hasEmbeddings,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      set((s) => {
        const nextIngesting = { ...s.ingestingPaths };
        delete nextIngesting[filePath];
        const filtered = s.documents.filter((d) => d.path !== doc.path);
        return {
          ingestingPaths: nextIngesting,
          documents: [doc, ...filtered],
        };
      });
      useUiStore.getState().pushToast(
        'success',
        `Indexed ${res.fileName} (${res.chunkCount} chunks · ${res.hasEmbeddings ? 'Hybrid Vector + FTS5' : 'FTS5 Offline'})`,
      );
      return doc;
    } catch (err) {
      set((s) => {
        const nextIngesting = { ...s.ingestingPaths };
        delete nextIngesting[filePath];
        return { ingestingPaths: nextIngesting };
      });
      useUiStore.getState().pushToast('error', `Ingest failed: ${String(err)}`);
      return null;
    }
  },

  removeDocument: async (filePath) => {
    try {
      await api.deleteDocument(filePath);
      set((s) => ({ documents: s.documents.filter((d) => d.path !== filePath) }));
      useUiStore.getState().pushToast('info', 'Removed document from local SQLite index.');
    } catch (err) {
      useUiStore.getState().pushToast('error', `Failed to remove document: ${String(err)}`);
    }
  },

  recordTelemetry: (telemetry) => {
    set((s) => ({
      latestTelemetry: telemetry,
      telemetryHistory: [telemetry, ...s.telemetryHistory.filter((t) => t.requestId !== telemetry.requestId)].slice(0, 20),
    }));
  },
}));
