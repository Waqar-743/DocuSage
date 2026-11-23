import { create } from 'zustand';
import * as api from '../lib/api';
import {
  MAJOR_CLOUD_PROVIDERS,
  type MajorCloudProviderKind,
  type ModelCatalogEntry,
} from '../lib/catalog';
import type {
  AiProviderConfig,
  AiProviderConfigInput,
  DownloadedModel,
  DownloadProgress,
  LocalModelTestResult,
  LocalRuntimeStatus,
  LocalSetupState,
  ProviderModelInfo,
  ProviderTestResult,
  ProviderVerificationStatus,
  RagConfig,
  RuntimeDownloadProgress,
} from '../types';
import { useUiStore } from './useUiStore';

export type ProviderVerificationEntry = {
  status: ProviderVerificationStatus;
  message?: string;
  checkedAt?: number;
};

type ProviderState = {
  providers: AiProviderConfig[];
  activeProviderId: string;
  secureStorageAvailable: boolean;
  modelsByProvider: Record<string, ProviderModelInfo[]>;
  verificationByProvider: Record<string, ProviderVerificationEntry>;
  downloadedModels: DownloadedModel[];
  connectedModel: string | null;
  modelsDir: string;
  runtimeStatus: LocalRuntimeStatus;
  runtimeProgress: RuntimeDownloadProgress | null;
  modelDownloads: Record<string, DownloadProgress>;
  ragConfig: RagConfig;
  isConnectingModel: boolean;
  isConnectingEmbedding: boolean;
  isInstallingRuntime: boolean;
  isTestingLocalModel: boolean;
  localTestResult: LocalModelTestResult | null;
  localSetup: LocalSetupState;

  hydrateProviders: () => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<void>;
  selectProviderModel: (providerId: string, modelId: string) => Promise<void>;
  saveProvider: (input: AiProviderConfigInput, opts?: { silent?: boolean }) => Promise<AiProviderConfig | null>;
  saveCloudProviderKey: (
    kind: MajorCloudProviderKind,
    apiKey: string,
    model?: string,
  ) => Promise<AiProviderConfig | null>;
  clearCloudProviderKey: (providerId: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  verifyAndFetchModels: (providerId: string) => Promise<ProviderTestResult>;
  installRuntime: (preferredBackend?: string) => Promise<LocalRuntimeStatus | null>;
  connectLocalModel: (filePath: string) => Promise<boolean>;
  connectLocalEmbeddingModel: (filePath: string) => Promise<boolean>;
  disconnectLocalModel: () => Promise<void>;
  restartLocalEngine: () => Promise<void>;
  downloadCatalogModel: (url: string, filename: string) => Promise<string | null>;
  downloadAndSetupLocalModel: (
    entry: ModelCatalogEntry,
    opts?: { redirectToWorkspace?: boolean },
  ) => Promise<boolean>;
  testLocalModel: () => Promise<LocalModelTestResult>;
  dismissLocalSetup: () => void;
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

const IDLE_LOCAL_SETUP: LocalSetupState = {
  stage: 'idle',
  modelName: '',
  filename: '',
  kind: 'chat',
  percent: 0,
  message: '',
  error: null,
};

function isMissingRuntimeError(errText: string): boolean {
  const lower = errText.toLowerCase();
  return lower.includes('llama-server') && lower.includes('not installed');
}

function classifyTestStatus(res: ProviderTestResult): ProviderVerificationStatus {
  if (res.status) return res.status;
  if (res.ok) return 'verified';
  const lower = res.message.toLowerCase();
  if (lower.includes('not configured') || lower.includes('no api key')) {
    return 'notConfigured';
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('invalid api key') ||
    lower.includes('api_key_invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication')
  ) {
    return 'invalidApiKey';
  }
  return 'connectionError';
}

function notifyMissingRuntime() {
  useUiStore.getState().pushToast(
    'error',
    "Built-in llama-server runtime is not installed yet. Install it to run local GGUF models.",
    {
      dedupeKey: 'local-runtime-missing',
      action: {
        label: 'Install Runtime',
        onClick: () => {
          useUiStore.getState().openSettings('localRuntime');
          void useProviderStore.getState().installRuntime();
        },
      },
    },
  );
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeProviderId: 'local',
  secureStorageAvailable: false,
  modelsByProvider: {},
  verificationByProvider: {},
  downloadedModels: [],
  connectedModel: null,
  modelsDir: '',
  runtimeStatus: DEFAULT_RUNTIME_STATUS,
  runtimeProgress: null,
  modelDownloads: {},
  ragConfig: { ...api.RAG_CONFIG_DEFAULTS, embedding: { ...api.RAG_CONFIG_DEFAULTS.embedding } },
  isConnectingModel: false,
  isConnectingEmbedding: false,
  isInstallingRuntime: false,
  isTestingLocalModel: false,
  localTestResult: null,
  localSetup: IDLE_LOCAL_SETUP,

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
      set((s) => {
        const nextVerification = { ...s.verificationByProvider };
        for (const p of providerList.providers) {
          if (!nextVerification[p.id]) {
            nextVerification[p.id] = {
              status: p.apiKeySet ? 'unverified' : 'notConfigured',
            };
          } else if (!p.apiKeySet && p.provider !== 'local') {
            nextVerification[p.id] = { status: 'notConfigured' };
          }
        }
        return {
          providers: providerList.providers,
          activeProviderId: providerList.activeProviderId,
          secureStorageAvailable: providerList.secureStorageAvailable,
          verificationByProvider: nextVerification,
          downloadedModels: downloaded,
          connectedModel: connected ?? runtime.loadedModel,
          runtimeStatus: runtime,
          ragConfig: ragCfg,
          modelsDir: dir,
        };
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

  selectProviderModel: async (providerId, modelId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) return;
    try {
      if (provider.model !== modelId) {
        const saved = await api.saveAiProviderConfig({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          enabled: true,
          baseUrl: provider.baseUrl,
          model: modelId,
          organization: provider.organization,
          project: provider.project,
          timeoutSecs: provider.timeoutSecs,
          temperature: provider.temperature,
          deleteApiKey: false,
          options: provider.options ?? {},
        });
        set((s) => ({
          providers: s.providers.map((p) => (p.id === saved.id ? saved : p)),
        }));
      }
      const id = await api.setActiveAiProvider(providerId);
      set({ activeProviderId: id });
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  saveProvider: async (input, opts) => {
    try {
      const saved = await api.saveAiProviderConfig(input);
      const list = await api.listAiProviderConfigs();
      set((s) => {
        const nextVerification = { ...s.verificationByProvider };
        if (input.deleteApiKey) {
          nextVerification[saved.id] = { status: 'notConfigured', message: 'API key removed.' };
        } else if (input.apiKey && input.apiKey.trim()) {
          nextVerification[saved.id] = { status: 'unverified', message: 'API key saved. Click Verify to test.' };
        }
        return {
          providers: list.providers,
          activeProviderId: list.activeProviderId,
          secureStorageAvailable: list.secureStorageAvailable,
          verificationByProvider: nextVerification,
        };
      });
      if (!opts?.silent) {
        useUiStore.getState().pushToast('success', `Saved provider "${saved.name}".`);
      }
      return saved;
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
      return null;
    }
  },

  saveCloudProviderKey: async (kind, apiKey, model) => {
    const meta = MAJOR_CLOUD_PROVIDERS.find((m) => m.kind === kind);
    if (!meta) return null;
    const existing = get().providers.find((p) => p.provider === kind);
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !existing?.apiKeySet) {
      useUiStore.getState().pushToast('error', `Enter a valid ${meta.name} API key first.`);
      return null;
    }
    return get().saveProvider(
      {
        id: existing?.id ?? meta.canonicalId,
        name: existing?.name ?? meta.name,
        provider: kind,
        enabled: true,
        baseUrl: existing?.baseUrl ?? meta.defaultBaseUrl,
        model: model ?? existing?.model ?? meta.defaultModel,
        organization: existing?.organization ?? null,
        project: existing?.project ?? null,
        timeoutSecs: existing?.timeoutSecs ?? 60,
        temperature: existing?.temperature ?? 0.3,
        apiKey: trimmedKey || undefined,
        deleteApiKey: false,
        options: existing?.options ?? {},
      },
      { silent: true },
    );
  },

  clearCloudProviderKey: async (providerId) => {
    const existing = get().providers.find((p) => p.id === providerId);
    if (!existing) return;
    await get().saveProvider(
      {
        id: existing.id,
        name: existing.name,
        provider: existing.provider,
        enabled: existing.enabled,
        baseUrl: existing.baseUrl,
        model: existing.model,
        organization: existing.organization,
        project: existing.project,
        timeoutSecs: existing.timeoutSecs,
        temperature: existing.temperature,
        deleteApiKey: true,
        options: existing.options ?? {},
      },
      { silent: true },
    );
    set((s) => ({
      verificationByProvider: {
        ...s.verificationByProvider,
        [providerId]: { status: 'notConfigured', message: 'API key removed.' },
      },
    }));
    useUiStore.getState().pushToast('info', `Removed saved API key for ${existing.name}.`);
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
    set((s) => ({
      verificationByProvider: {
        ...s.verificationByProvider,
        [providerId]: { status: 'verifying', message: 'Checking credentials…' },
      },
    }));
    try {
      const res = await api.testAiProviderConnection(providerId);
      const status = classifyTestStatus(res);
      set((s) => ({
        modelsByProvider:
          res.ok && res.models.length > 0
            ? { ...s.modelsByProvider, [providerId]: res.models }
            : s.modelsByProvider,
        verificationByProvider: {
          ...s.verificationByProvider,
          [providerId]: { status, message: res.message, checkedAt: Date.now() },
        },
      }));
      useUiStore.getState().pushToast(res.ok ? 'success' : 'error', res.message, {
        dedupeKey: `verify:${providerId}:${status}`,
      });
      return { ...res, status };
    } catch (err) {
      const msg = String(err);
      const fallback: ProviderTestResult = { ok: false, status: 'connectionError', message: msg, models: [] };
      const status = classifyTestStatus(fallback);
      set((s) => ({
        verificationByProvider: {
          ...s.verificationByProvider,
          [providerId]: { status, message: msg, checkedAt: Date.now() },
        },
      }));
      useUiStore.getState().pushToast('error', msg, { dedupeKey: `verify:${providerId}:${status}` });
      return { ...fallback, status };
    }
  },

  installRuntime: async (preferredBackend) => {
    if (get().isInstallingRuntime) return null;
    set({ isInstallingRuntime: true });
    try {
      const status = await api.installLocalRuntime(preferredBackend);
      set({ runtimeStatus: status, isInstallingRuntime: false });
      useUiStore.getState().pushToast(
        'success',
        `Installed llama-server (${status.version ?? status.detectedBackend}).`,
        { dedupeKey: 'local-runtime-installed' },
      );
      return status;
    } catch (err) {
      set({ isInstallingRuntime: false });
      useUiStore.getState().pushToast('error', `Runtime install failed: ${String(err)}`, {
        dedupeKey: 'local-runtime-install-error',
      });
      return null;
    }
  },

  connectLocalModel: async (filePath) => {
    if (get().isConnectingModel) return false;
    if (!get().runtimeStatus.installed) {
      notifyMissingRuntime();
      return false;
    }
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
        localTestResult: null,
      });
      useUiStore.getState().pushToast('success', msg, { dedupeKey: `local-connect:${filePath}` });
      return true;
    } catch (err) {
      set({ isConnectingModel: false });
      const errText = String(err);
      if (isMissingRuntimeError(errText)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', errText, { dedupeKey: `local-connect-err:${errText}` });
      }
      return false;
    }
  },

  connectLocalEmbeddingModel: async (filePath) => {
    if (get().isConnectingEmbedding) return false;
    if (!get().runtimeStatus.installed) {
      notifyMissingRuntime();
      return false;
    }
    set({ isConnectingEmbedding: true });
    try {
      const status = await api.connectEmbeddingModel(filePath);
      set({ runtimeStatus: status, isConnectingEmbedding: false });
      useUiStore.getState().pushToast('success', `Offline embeddings active (${status.embeddingModel}).`, {
        dedupeKey: `local-embed:${filePath}`,
      });
      return true;
    } catch (err) {
      set({ isConnectingEmbedding: false });
      const errText = String(err);
      if (isMissingRuntimeError(errText)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', errText, { dedupeKey: `local-embed-err:${errText}` });
      }
      return false;
    }
  },

  disconnectLocalModel: async () => {
    try {
      await api.disconnectModel();
      const status = await api
        .getLocalRuntimeStatus()
        .catch(() => ({ ...get().runtimeStatus, running: false, loadedModel: null }));
      set({ runtimeStatus: status, connectedModel: null, localTestResult: null });
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
      const errText = String(err);
      if (isMissingRuntimeError(errText)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', errText);
      }
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
      const savedPath = await api.downloadModel(url, filename);
      const downloaded = await api.listDownloadedModels();
      set({ downloadedModels: downloaded });
      return savedPath;
    } catch (err) {
      set((s) => ({
        modelDownloads: {
          ...s.modelDownloads,
          [filename]: {
            filename,
            downloaded: 0,
            total: 0,
            percent: 0,
            done: true,
            error: String(err),
          },
        },
      }));
      useUiStore.getState().pushToast('error', `Download failed: ${String(err)}`, {
        dedupeKey: `download-err:${filename}`,
      });
      return null;
    }
  },

  downloadAndSetupLocalModel: async (entry, opts) => {
    const shouldRedirect = opts?.redirectToWorkspace ?? entry.kind === 'chat';

    // Redirect user immediately to the main chat workspace while setup runs in the background.
    if (shouldRedirect) {
      useUiStore.getState().closeSettings();
    }

    set({
      localTestResult: null,
      localSetup: {
        stage: 'downloading',
        modelName: entry.name,
        filename: entry.filename,
        kind: entry.kind,
        percent: 0,
        message: `Downloading ${entry.name} automatically (no local path setup needed)…`,
        error: null,
      },
    });

    try {
      // Step 1: Download if not already downloaded locally.
      let existing = get().downloadedModels.find(
        (m) => m.filename.toLowerCase() === entry.filename.toLowerCase(),
      );
      let modelPath = existing?.path ?? null;

      if (!modelPath) {
        set((s) => ({
          modelDownloads: {
            ...s.modelDownloads,
            [entry.filename]: {
              filename: entry.filename,
              downloaded: 0,
              total: 0,
              percent: 0,
              done: false,
              error: null,
            },
          },
        }));
        modelPath = await api.downloadModel(entry.directDownloadUrl, entry.filename);
        const downloaded = await api.listDownloadedModels();
        set({ downloadedModels: downloaded });
        existing = downloaded.find((m) => m.filename.toLowerCase() === entry.filename.toLowerCase());
        if (existing) modelPath = existing.path;
      }

      // Step 2: Automatically install built-in llama-server runtime if missing.
      let runtime = await api.getLocalRuntimeStatus().catch(() => get().runtimeStatus);
      set({ runtimeStatus: runtime });
      if (!runtime.installed) {
        set((s) => ({
          isInstallingRuntime: true,
          localSetup: {
            ...s.localSetup,
            stage: 'installingRuntime',
            percent: 0,
            message: 'Installing built-in llama-server runtime automatically…',
          },
        }));
        runtime = await api.installLocalRuntime();
        set({ runtimeStatus: runtime, isInstallingRuntime: false });
      }

      // Step 3: Automatically load/connect the downloaded model and switch to Local AI.
      set((s) => ({
        isConnectingModel: entry.kind === 'chat',
        isConnectingEmbedding: entry.kind === 'embedding',
        localSetup: {
          ...s.localSetup,
          stage: 'loadingModel',
          percent: 100,
          message:
            entry.kind === 'chat'
              ? `Starting ${entry.name} locally…`
              : `Activating ${entry.name} for offline embeddings…`,
        },
      }));

      if (entry.kind === 'chat') {
        await api.connectModel(modelPath);
        await api.setActiveAiProvider('local').catch(() => 'local');
        const [freshRuntime, connected] = await Promise.all([
          api.getLocalRuntimeStatus().catch(() => runtime),
          api.getConnectedModel().catch(() => entry.filename),
        ]);
        set({
          runtimeStatus: freshRuntime,
          connectedModel: connected ?? freshRuntime.loadedModel ?? entry.filename,
          activeProviderId: 'local',
          isConnectingModel: false,
          localSetup: {
            stage: 'ready',
            modelName: entry.name,
            filename: entry.filename,
            kind: entry.kind,
            percent: 100,
            message: `${entry.name} is ready! Start chatting or click Test Model.`,
            error: null,
          },
        });
        useUiStore.getState().pushToast('success', `${entry.name} is downloaded, loaded, and ready to chat.`, {
          dedupeKey: `local-ready:${entry.filename}`,
        });
      } else {
        const freshRuntime = await api.connectEmbeddingModel(modelPath);
        set({
          runtimeStatus: freshRuntime,
          isConnectingEmbedding: false,
          localSetup: {
            stage: 'ready',
            modelName: entry.name,
            filename: entry.filename,
            kind: entry.kind,
            percent: 100,
            message: `${entry.name} is active for offline document embeddings.`,
            error: null,
          },
        });
        useUiStore.getState().pushToast('success', `Offline embeddings ready with ${entry.name}.`, {
          dedupeKey: `local-embed-ready:${entry.filename}`,
        });
      }
      return true;
    } catch (err) {
      const errMsg = String(err);
      set((s) => ({
        isInstallingRuntime: false,
        isConnectingModel: false,
        isConnectingEmbedding: false,
        localSetup: {
          ...s.localSetup,
          stage: 'error',
          message: `Setup failed for ${entry.name}`,
          error: errMsg,
        },
      }));
      useUiStore.getState().pushToast('error', `Local model setup failed: ${errMsg}`, {
        dedupeKey: `local-setup-err:${entry.filename}`,
      });
      return false;
    }
  },

  testLocalModel: async () => {
    if (get().isTestingLocalModel) {
      return get().localTestResult ?? { ok: false, message: 'Test already running…' };
    }
    set({ isTestingLocalModel: true, localTestResult: null });
    try {
      const res = await api.testLocalModel();
      const [status, connected] = await Promise.all([
        api.getLocalRuntimeStatus().catch(() => get().runtimeStatus),
        api.getConnectedModel().catch(() => get().connectedModel),
      ]);
      set({
        isTestingLocalModel: false,
        localTestResult: res,
        runtimeStatus: status,
        connectedModel: connected ?? status.loadedModel,
      });
      if (res.ok) {
        useUiStore.getState().pushToast('success', res.message, { dedupeKey: 'local-test-ok' });
      } else if (isMissingRuntimeError(res.message)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', res.message, { dedupeKey: `local-test-err:${res.message}` });
      }
      return res;
    } catch (err) {
      const msg = String(err);
      const res: LocalModelTestResult = { ok: false, message: msg };
      set({ isTestingLocalModel: false, localTestResult: res });
      if (isMissingRuntimeError(msg)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', msg, { dedupeKey: `local-test-err:${msg}` });
      }
      return res;
    }
  },

  dismissLocalSetup: () => set({ localSetup: IDLE_LOCAL_SETUP }),

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
    set((s) => {
      const nextSetup =
        s.localSetup.stage === 'downloading' && s.localSetup.filename === progress.filename
          ? {
              ...s.localSetup,
              percent: progress.percent,
              message: progress.error
                ? `Download error: ${progress.error}`
                : `Downloading ${s.localSetup.modelName}… ${progress.percent.toFixed(0)}%`,
            }
          : s.localSetup;
      return {
        modelDownloads: { ...s.modelDownloads, [progress.filename]: progress },
        localSetup: nextSetup,
      };
    });
  },

  updateRuntimeProgress: (runtimeProgress) =>
    set((s) => ({
      runtimeProgress,
      localSetup:
        s.localSetup.stage === 'installingRuntime'
          ? {
              ...s.localSetup,
              percent: runtimeProgress.percent,
              message:
                runtimeProgress.stage === 'extracting'
                  ? 'Extracting built-in llama-server runtime…'
                  : `Installing llama-server runtime… ${runtimeProgress.percent.toFixed(0)}%`,
            }
          : s.localSetup,
    })),

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
