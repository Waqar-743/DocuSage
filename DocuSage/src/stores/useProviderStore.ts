import { create } from 'zustand';
import * as api from '../lib/api';
import type {
  AiProviderConfig,
  AiProviderConfigInput,
  DownloadedModel,
  DownloadProgress,
  LocalRuntimeStatus,
  ProviderModelInfo,
  ProviderTestResult,
  RagConfig,
  RuntimeDownloadProgress,
} from '../types';
import { useUiStore } from './useUiStore';

type ProviderState = {
  providers: AiProviderConfig[];
  activeProviderId: string;
  secureStorageAvailable: boolean;
  modelsByProvider: Record<string, ProviderModelInfo[]>;
  downloadedModels: DownloadedModel[];
  connectedModel: string | null;
  modelsDir: string;
  runtimeStatus: LocalRuntimeStatus;
  runtimeProgress: RuntimeDownloadProgress | null;
  modelDownloads: Record<string, DownloadProgress>;
  ragConfig: RagConfig;
  isConnectingModel: boolean;
  isInstallingRuntime: boolean;

  hydrateProviders: () => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<void>;
  saveProvider: (input: AiProviderConfigInput) => Promise<AiProviderConfig | null>;
  deleteProvider: (providerId: string) => Promise<void>;
  verifyAndFetchModels: (providerId: string) => Promise<ProviderTestResult>;
  installRuntime: (preferredBackend?: string) => Promise<void>;
  connectLocalModel: (filePath: string) => Promise<void>;
  connectLocalEmbeddingModel: (filePath: string) => Promise<void>;
  disconnectLocalModel: () => Promise<void>;
  restartLocalEngine: () => Promise<void>;
  downloadCatalogModel: (url: string, filename: string) => Promise<void>;
  deleteLocalModel: (filePath: string) => Promise<void>;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  updateRuntimeProgress: (progress: RuntimeDownloadProgress) => void;
  saveRagConfig: (config: RagConfig) => Promise<boolean>;
  resetRagConfig: () => Promise<boolean>;
};

const DEFAULT_RUNTIME_STATUS: LocalRuntimeStatus = {
  installed: false,
  binaryPath: null,
  running: false,
  port: null,
  baseUrl: null,
  loadedModel: null,
  loadedModelPath: null,
  embeddingRunning: false,
  embeddingPort: null,
  embeddingModel: null,
  detectedBackend: 'cpu',
  platformSummary: 'desktop',
  version: null,
};

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeProviderId: 'local',
  secureStorageAvailable: false,
  modelsByProvider: {},
  downloadedModels: [],
  connectedModel: null,
  modelsDir: '',
  runtimeStatus: DEFAULT_RUNTIME_STATUS,
  runtimeProgress: null,
  modelDownloads: {},
  ragConfig: { ...api.RAG_CONFIG_DEFAULTS, embedding: { ...api.RAG_CONFIG_DEFAULTS.embedding } },
  isConnectingModel: false,
  isInstallingRuntime: false,

  hydrateProviders: async () => {
    try {
      const [providerList, downloaded, connected, runtime, ragCfg, dir] = await Promise.all([
        api.listAiProviderConfigs(),
        api.listDownloadedModels(),
        api.getConnectedModel(),
        api.getLocalRuntimeStatus().catch(() => DEFAULT_RUNTIME_STATUS),
        api.getRagConfig(),
        api.getModelsDir().catch(() => ''),
      ]);
      set({
        providers: providerList.providers,
        activeProviderId: providerList.activeProviderId,
        secureStorageAvailable: providerList.secureStorageAvailable,
        downloadedModels: downloaded,
        connectedModel: connected ?? runtime.loadedModel,
        runtimeStatus: runtime,
        ragConfig: ragCfg,
        modelsDir: dir,
      });
    } catch {
      // Resilient in partial mock test setups.
    }
  },

  setActiveProvider: async (providerId) => {
    try {
      const id = await api.setActiveAiProvider(providerId);
      set({ activeProviderId: id });
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  saveProvider: async (input) => {
    try {
      const saved = await api.saveAiProviderConfig(input);
      const list = await api.listAiProviderConfigs();
      set({
        providers: list.providers,
        activeProviderId: list.activeProviderId,
        secureStorageAvailable: list.secureStorageAvailable,
      });
      useUiStore.getState().pushToast('success', `Saved provider "${saved.name}".`);
      return saved;
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
      return null;
    }
  },

  deleteProvider: async (providerId) => {
    try {
      await api.deleteAiProviderConfig(providerId);
      const list = await api.listAiProviderConfigs();
      set({
        providers: list.providers,
        activeProviderId: list.activeProviderId,
      });
      useUiStore.getState().pushToast('info', 'Provider deleted.');
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  verifyAndFetchModels: async (providerId) => {
    try {
      const res = await api.testAiProviderConnection(providerId);
      if (res.ok && res.models.length > 0) {
        set((s) => ({
          modelsByProvider: { ...s.modelsByProvider, [providerId]: res.models },
        }));
      }
      useUiStore.getState().pushToast(res.ok ? 'success' : 'error', res.message);
      return res;
    } catch (err) {
      const msg = String(err);
      useUiStore.getState().pushToast('error', msg);
      return { ok: false, message: msg, models: [] };
    }
  },

  installRuntime: async (preferredBackend) => {
    set({ isInstallingRuntime: true });
    try {
      const status = await api.installLocalRuntime(preferredBackend);
      set({ runtimeStatus: status, isInstallingRuntime: false });
      useUiStore.getState().pushToast('success', `Installed llama-server (${status.version ?? status.detectedBackend}).`);
    } catch (err) {
      set({ isInstallingRuntime: false });
      useUiStore.getState().pushToast('error', `Runtime install failed: ${String(err)}`);
    }
  },

  connectLocalModel: async (filePath) => {
    set({ isConnectingModel: true });
    try {
      const msg = await api.connectModel(filePath);
      const [status, connected] = await Promise.all([
        api.getLocalRuntimeStatus().catch(() => get().runtimeStatus),
        api.getConnectedModel().catch(() => null),
      ]);
      set({
        runtimeStatus: status,
        connectedModel: connected ?? status.loadedModel,
        isConnectingModel: false,
      });
      useUiStore.getState().pushToast('success', msg);
    } catch (err) {
      set({ isConnectingModel: false });
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  connectLocalEmbeddingModel: async (filePath) => {
    try {
      const status = await api.connectEmbeddingModel(filePath);
      set({ runtimeStatus: status });
      useUiStore.getState().pushToast('success', `Offline embeddings active (${status.embeddingModel}).`);
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  disconnectLocalModel: async () => {
    try {
      await api.disconnectModel();
      const status = await api.getLocalRuntimeStatus().catch(() => ({ ...get().runtimeStatus, running: false, loadedModel: null }));
      set({ runtimeStatus: status, connectedModel: null });
      useUiStore.getState().pushToast('info', 'Disconnected local GGUF model.');
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  restartLocalEngine: async () => {
    set({ isConnectingModel: true });
    try {
      const msg = await api.restartAiEngine();
      const status = await api.getLocalRuntimeStatus().catch(() => get().runtimeStatus);
      set({ runtimeStatus: status, connectedModel: status.loadedModel, isConnectingModel: false });
      useUiStore.getState().pushToast('success', msg);
    } catch (err) {
      set({ isConnectingModel: false });
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  downloadCatalogModel: async (url, filename) => {
    set((s) => ({
      modelDownloads: {
        ...s.modelDownloads,
        [filename]: { filename, downloaded: 0, total: 0, percent: 0, done: false, error: null },
      },
    }));
    try {
      await api.downloadModel(url, filename);
      const downloaded = await api.listDownloadedModels();
      set({ downloadedModels: downloaded });
      useUiStore.getState().pushToast('success', `Downloaded ${filename}.`);
    } catch (err) {
      useUiStore.getState().pushToast('error', `Download failed: ${String(err)}`);
    }
  },

  deleteLocalModel: async (filePath) => {
    try {
      await api.deleteModel(filePath);
      const downloaded = await api.listDownloadedModels();
      set({ downloadedModels: downloaded });
      useUiStore.getState().pushToast('info', 'Deleted GGUF model file.');
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  updateDownloadProgress: (progress) => {
    set((s) => ({
      modelDownloads: { ...s.modelDownloads, [progress.filename]: progress },
    }));
  },

  updateRuntimeProgress: (runtimeProgress) => set({ runtimeProgress }),

  saveRagConfig: async (config) => {
    try {
      await api.saveRagConfig(config);
      set({ ragConfig: config });
      useUiStore.getState().pushToast('success', 'Smart Context & RAG settings saved.');
      return true;
    } catch (err) {
      useUiStore.getState().pushToast('error', `Failed to save RAG settings: ${String(err)}`);
      return false;
    }
  },

  resetRagConfig: async () => {
    const defaults: RagConfig = {
      ...api.RAG_CONFIG_DEFAULTS,
      embedding: { ...api.RAG_CONFIG_DEFAULTS.embedding },
    };
    try {
      await api.saveRagConfig(defaults);
      set({ ragConfig: defaults });
      useUiStore.getState().pushToast('success', 'Reset to defaults.');
      return true;
    } catch (err) {
      useUiStore.getState().pushToast('error', `Failed to reset RAG settings: ${String(err)}`);
      return false;
    }
  },
}));
