import { create } from 'zustand';
import * as api from '../lib/api';
import {
  findCatalogEntryByFilename,
  formatBytes,
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
  PartialDownload,
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
  partialDownloads: PartialDownload[];
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
  downloadCatalogModel: (url: string, filename: string, sha256?: string) => Promise<string | null>;
  cancelModelDownload: (filename: string) => Promise<void>;
  discardPartialDownload: (filename: string) => Promise<void>;
  resumePausedDownload: (filename: string) => Promise<boolean>;
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
  partialDownloads: [],
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
      const [providerList, downloaded, partials, connected, runtime, ragCfg, dir] = await Promise.all([
        api.listAiProviderConfigs(),
        api.listDownloadedModels(),
        api.listPartialDownloads().catch(() => [] as PartialDownload[]),
        api.getConnectedModel(),
        api.getLocalRuntimeStatus().catch(() => DEFAULT_RUNTIME_STATUS),
        api.getRagConfig(),
        api.getModelsDir().catch(() => ''),
      ]);
      const downloadedNames = new Set(downloaded.map((m) => m.filename.toLowerCase()));
      const activePartials = partials.filter((p) => !downloadedNames.has(p.filename.toLowerCase()));

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

        const nextDownloads = { ...s.modelDownloads };
        for (const partial of activePartials) {
          const existing = nextDownloads[partial.filename];
          if (existing && !existing.done) continue;
          const entry = findCatalogEntryByFilename(partial.filename);
          const total = entry?.sizeBytes ?? 0;
          const percent = total > 0 ? Math.min(99.9, (partial.downloadedBytes / total) * 100) : 0;
          nextDownloads[partial.filename] = {
            filename: partial.filename,
            downloaded: partial.downloadedBytes,
            total,
            percent,
            speedBps: 0,
            etaSecs: null,
            stage: 'cancelled',
            done: true,
            error: null,
          };
        }

        let nextLocalSetup = s.localSetup;
        if (s.localSetup.stage === 'idle' && runtime.lastInterruptedModel) {
          const entry = findCatalogEntryByFilename(runtime.lastInterruptedModel);
          const label = entry?.name ?? runtime.lastInterruptedModel;
          nextLocalSetup = {
            stage: 'error',
            modelName: label,
            filename: runtime.lastInterruptedModel,
            kind: entry?.kind ?? 'chat',
            percent: 0,
            message: `Previous load of ${label} was interrupted`,
            error: 'Your system may have been low on RAM. Close other apps, retry, or pick a smaller model.',
          };
        }

        return {
          providers: providerList.providers,
          activeProviderId: providerList.activeProviderId,
          secureStorageAvailable: providerList.secureStorageAvailable,
          verificationByProvider: nextVerification,
          downloadedModels: downloaded,
          partialDownloads: activePartials,
          modelDownloads: nextDownloads,
          connectedModel: connected ?? runtime.loadedModel,
          runtimeStatus: runtime,
          ragConfig: ragCfg,
          modelsDir: dir,
          localSetup: nextLocalSetup,
        };
      });
    } catch {
      // Resilient in partial mock test setups.
    }
  },

  setActiveProvider: async (providerId) => {
    try {
      const id = await api.setActiveAiProvider(providerId);
      set((s) => ({
        activeProviderId: id,
        localSetup:
          s.localSetup.stage === 'paused' ||
          s.localSetup.stage === 'ready' ||
          s.localSetup.stage === 'error'
            ? IDLE_LOCAL_SETUP
            : s.localSetup,
      }));
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
      set((s) => ({
        activeProviderId: id,
        localSetup:
          s.localSetup.stage === 'paused' ||
          s.localSetup.stage === 'ready' ||
          s.localSetup.stage === 'error'
            ? IDLE_LOCAL_SETUP
            : s.localSetup,
      }));
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
    set({ isInstallingRuntime: true, runtimeProgress: null });
    try {
      const status = await api.installLocalRuntime(preferredBackend);
      const downloaded = await api.listDownloadedModels().catch(() => get().downloadedModels);
      set({ runtimeStatus: status, downloadedModels: downloaded });

      // Automatically start a downloaded chat GGUF model if none is running yet
      // so clicking "Install Local Runtime" leaves Local AI immediately ready to chat.
      if (status.installed && !status.running && downloaded.length > 0) {
        const currentConnected = get().connectedModel;
        const preferredChat =
          downloaded.find((m) => currentConnected && m.filename === currentConnected) ??
          downloaded.find((m) => {
            const lower = m.filename.toLowerCase();
            return !lower.includes('embed') && !lower.includes('bge-');
          }) ??
          downloaded[0];

        if (preferredChat) {
          set({
            isConnectingModel: true,
            runtimeProgress: {
              stage: 'starting',
              assetName: preferredChat.filename,
              downloaded: 0,
              total: 0,
              percent: 100,
              done: false,
              error: null,
            },
          });
          try {
            await api.connectModel(preferredChat.path);
            const [freshStatus, connected] = await Promise.all([
              api.getLocalRuntimeStatus().catch(() => status),
              api.getConnectedModel().catch(() => preferredChat.filename),
            ]);
            const resolvedModel = connected ?? freshStatus.loadedModel ?? preferredChat.filename;
            set({
              runtimeStatus: freshStatus,
              connectedModel: resolvedModel,
              isInstallingRuntime: false,
              isConnectingModel: false,
              localTestResult: null,
              runtimeProgress: {
                stage: 'ready',
                assetName: preferredChat.filename,
                downloaded: 0,
                total: 0,
                percent: 100,
                done: true,
                error: null,
              },
            });
            useUiStore.getState().pushToast(
              'success',
              `Installed llama-server (${freshStatus.version ?? freshStatus.detectedBackend}) and started ${resolvedModel}.`,
              { dedupeKey: 'local-runtime-installed' },
            );
            return freshStatus;
          } catch (startErr) {
            const errMsg = String(startErr);
            set({
              isInstallingRuntime: false,
              isConnectingModel: false,
              runtimeProgress: {
                stage: 'error',
                assetName: preferredChat.filename,
                downloaded: 0,
                total: 0,
                percent: 100,
                done: true,
                error: errMsg,
              },
            });
            useUiStore.getState().pushToast(
              'error',
              `Installed llama-server, but failed to start ${preferredChat.filename}: ${errMsg}`,
              { dedupeKey: 'local-runtime-start-error' },
            );
            return status;
          }
        }
      }

      set({ isInstallingRuntime: false });
      useUiStore.getState().pushToast(
        'success',
        `Installed llama-server (${status.version ?? status.detectedBackend}).`,
        { dedupeKey: 'local-runtime-installed' },
      );
      return status;
    } catch (err) {
      const errMsg = String(err);
      set((s) => ({
        isInstallingRuntime: false,
        isConnectingModel: false,
        runtimeProgress: s.runtimeProgress
          ? { ...s.runtimeProgress, stage: 'error', done: true, error: errMsg }
          : {
              stage: 'error',
              assetName: '',
              downloaded: 0,
              total: 0,
              percent: 0,
              done: true,
              error: errMsg,
            },
      }));
      useUiStore.getState().pushToast('error', `Runtime install failed: ${errMsg}`, {
        dedupeKey: 'local-runtime-install-error',
      });
      return null;
    }
  },

  connectLocalModel: async (filePath) => {
    if (get().isConnectingModel || get().isTestingLocalModel) return false;
    if (!get().runtimeStatus.installed) {
      notifyMissingRuntime();
      return false;
    }
    const rawName = filePath.split(/[\\/]/).pop() ?? filePath;
    const entry = findCatalogEntryByFilename(rawName);
    const displayName = entry?.name ?? rawName;
    set({
      isConnectingModel: true,
      localSetup: {
        stage: 'loadingModel',
        modelName: displayName,
        filename: rawName,
        kind: 'chat',
        percent: 100,
        message: `Loading ${displayName} locally…`,
        error: null,
      },
    });
    void api.setAssistantFocusGuard({ busy: true });
    try {
      const msg = await api.connectModel(filePath);
      const [status, connected] = await Promise.all([
        api.getLocalRuntimeStatus().catch(() => get().runtimeStatus),
        api.getConnectedModel().catch(() => null),
      ]);
      const resolved = connected ?? status.loadedModel ?? rawName;
      set({
        runtimeStatus: status,
        connectedModel: resolved,
        isConnectingModel: false,
        localTestResult: null,
        localSetup: IDLE_LOCAL_SETUP,
      });
      useUiStore.getState().pushToast('success', msg, { dedupeKey: `local-connect:${filePath}` });
      return true;
    } catch (err) {
      const errText = String(err);
      const freshStatus = await api.getLocalRuntimeStatus().catch(() => ({
        ...get().runtimeStatus,
        running: false,
        loadedModel: null,
        lastError: errText,
      }));
      set({
        runtimeStatus: {
          ...freshStatus,
          lastError: freshStatus.lastError ?? errText,
        },
        isConnectingModel: false,
        localSetup: {
          stage: 'error',
          modelName: displayName,
          filename: rawName,
          kind: 'chat',
          percent: 0,
          message: `Could not load ${displayName}`,
          error: errText,
        },
      });
      if (isMissingRuntimeError(errText)) {
        notifyMissingRuntime();
      } else {
        useUiStore.getState().pushToast('error', errText, { dedupeKey: `local-connect-err:${errText}` });
      }
      return false;
    } finally {
      void api.setAssistantFocusGuard({ busy: false });
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

  downloadCatalogModel: async (url, filename, sha256) => {
    set((s) => ({
      modelDownloads: {
        ...s.modelDownloads,
        [filename]: {
          filename,
          downloaded: 0,
          total: 0,
          percent: 0,
          speedBps: 0,
          etaSecs: null,
          stage: 'downloading',
          done: false,
          error: null,
        },
      },
    }));
    try {
      const savedPath = await api.downloadModel(url, filename, sha256);
      const downloaded = await api.listDownloadedModels();
      set({ downloadedModels: downloaded });
      return savedPath;
    } catch (err) {
      set((s) => ({
        modelDownloads: {
          ...s.modelDownloads,
          [filename]: {
            filename,
            downloaded: s.modelDownloads[filename]?.downloaded ?? 0,
            total: s.modelDownloads[filename]?.total ?? 0,
            percent: s.modelDownloads[filename]?.percent ?? 0,
            speedBps: 0,
            etaSecs: null,
            stage: 'error',
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

  cancelModelDownload: async (filename) => {
    try {
      await api.cancelDownload(filename);
      const partials = await api.listPartialDownloads().catch(() => get().partialDownloads);
      const partial = partials.find((p) => p.filename.toLowerCase() === filename.toLowerCase());
      const entry = findCatalogEntryByFilename(filename);
      set((s) => {
        const prev = s.modelDownloads[filename];
        const savedBytes = partial?.downloadedBytes ?? prev?.downloaded ?? s.localSetup.downloaded ?? 0;
        const total = prev?.total || entry?.sizeBytes || s.localSetup.total || 0;
        const percent = total > 0 ? Math.min(99.9, (savedBytes / total) * 100) : prev?.percent ?? 0;
        const label = entry?.name ?? s.localSetup.modelName ?? filename;
        return {
          partialDownloads: partials,
          modelDownloads: {
            ...s.modelDownloads,
            [filename]: {
              filename,
              downloaded: savedBytes,
              total,
              percent,
              speedBps: 0,
              etaSecs: null,
              stage: 'cancelled',
              done: true,
              error: 'Download paused. Click Resume to continue.',
            },
          },
          localSetup:
            s.localSetup.filename === filename && s.localSetup.stage === 'downloading'
              ? {
                  ...s.localSetup,
                  stage: 'paused',
                  downloaded: savedBytes,
                  total,
                  percent,
                  speedBps: 0,
                  etaSecs: null,
                  downloadStage: 'cancelled',
                  message: `Paused download: ${label} (${formatBytes(savedBytes)} saved)`,
                  error: null,
                }
              : s.localSetup,
        };
      });
      useUiStore.getState().pushToast('info', 'Download paused. Progress is saved so you can resume anytime.', {
        dedupeKey: `download-paused:${filename}`,
      });
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  discardPartialDownload: async (filename) => {
    try {
      await api.deletePartialDownload(filename);
      const partials = await api.listPartialDownloads().catch(() => []);
      set((s) => {
        const nextDownloads = { ...s.modelDownloads };
        delete nextDownloads[filename];
        return {
          partialDownloads: partials,
          modelDownloads: nextDownloads,
          localSetup:
            s.localSetup.filename === filename &&
            (s.localSetup.stage === 'paused' || s.localSetup.stage === 'error')
              ? IDLE_LOCAL_SETUP
              : s.localSetup,
        };
      });
      useUiStore.getState().pushToast('info', 'Removed partial download.');
    } catch (err) {
      useUiStore.getState().pushToast('error', String(err));
    }
  },

  resumePausedDownload: async (filename) => {
    const entry = findCatalogEntryByFilename(filename);
    if (!entry) {
      useUiStore.getState().openSettings('localRuntime');
      return false;
    }
    return get().downloadAndSetupLocalModel(entry, { redirectToWorkspace: false });
  },

  downloadAndSetupLocalModel: async (entry, opts) => {
    const shouldRedirect = opts?.redirectToWorkspace ?? entry.kind === 'chat';

    // Keep Spotlight window visible while downloading & loading so it never auto-hides.
    void api.setAssistantFocusGuard({ busy: true });

    // Redirect user immediately to the main chat workspace while setup runs in the background.
    if (shouldRedirect) {
      useUiStore.getState().closeSettings();
    }

    const existingPartial = get().partialDownloads.find(
      (p) => p.filename.toLowerCase() === entry.filename.toLowerCase(),
    );
    const prevProg = get().modelDownloads[entry.filename];
    const initialDownloaded = existingPartial?.downloadedBytes ?? prevProg?.downloaded ?? 0;
    const initialPercent =
      entry.sizeBytes > 0 ? Math.min(99.9, (initialDownloaded / entry.sizeBytes) * 100) : 0;

    set({
      localTestResult: null,
      localSetup: {
        stage: 'downloading',
        modelName: entry.name,
        filename: entry.filename,
        kind: entry.kind,
        percent: initialPercent,
        downloaded: initialDownloaded,
        total: entry.sizeBytes,
        speedBps: 0,
        etaSecs: null,
        downloadStage: 'downloading',
        message:
          initialDownloaded > 0
            ? `Resuming ${entry.name} from ${initialPercent.toFixed(1)}%…`
            : `Downloading ${entry.name} (${entry.size})…`,
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
              downloaded: initialDownloaded,
              total: entry.sizeBytes,
              percent: initialPercent,
              speedBps: 0,
              etaSecs: null,
              stage: 'downloading',
              done: false,
              error: null,
            },
          },
        }));
        modelPath = await api.downloadModel(entry.directDownloadUrl, entry.filename, entry.sha256);
        const [downloaded, partials] = await Promise.all([
          api.listDownloadedModels(),
          api.listPartialDownloads().catch(() => [] as PartialDownload[]),
        ]);
        set({ downloadedModels: downloaded, partialDownloads: partials });
        existing = downloaded.find((m) => m.filename.toLowerCase() === entry.filename.toLowerCase());
        if (existing) modelPath = existing.path;
      }

      // Step 2: Ensure built-in runtime is ready (instant with in-process llama.cpp).
      let runtime = await api.getLocalRuntimeStatus().catch(() => get().runtimeStatus);
      set({ runtimeStatus: runtime });
      if (!runtime.installed) {
        set((s) => ({
          isInstallingRuntime: true,
          localSetup: {
            ...s.localSetup,
            stage: 'installingRuntime',
            percent: 0,
            message: 'Preparing built-in llama.cpp runtime…',
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
      const isCancelled =
        errMsg.toLowerCase().includes('cancelled') ||
        get().modelDownloads[entry.filename]?.stage === 'cancelled';
      const partials = await api.listPartialDownloads().catch(() => get().partialDownloads);
      const partial = partials.find((p) => p.filename.toLowerCase() === entry.filename.toLowerCase());

      if (isCancelled) {
        set((s) => {
          const savedBytes =
            partial?.downloadedBytes ??
            s.modelDownloads[entry.filename]?.downloaded ??
            s.localSetup.downloaded ??
            0;
          const total = entry.sizeBytes || s.localSetup.total || 0;
          const percent = total > 0 ? Math.min(99.9, (savedBytes / total) * 100) : 0;
          return {
            partialDownloads: partials,
            isInstallingRuntime: false,
            isConnectingModel: false,
            isConnectingEmbedding: false,
            localSetup: {
              ...s.localSetup,
              stage: 'paused',
              downloaded: savedBytes,
              total,
              percent,
              speedBps: 0,
              etaSecs: null,
              downloadStage: 'cancelled',
              message: `Paused download: ${entry.name} (${formatBytes(savedBytes)} saved)`,
              error: null,
            },
          };
        });
        return false;
      }

      set((s) => {
        const savedBytes =
          partial?.downloadedBytes ??
          s.modelDownloads[entry.filename]?.downloaded ??
          s.localSetup.downloaded ??
          0;
        const total = entry.sizeBytes || s.localSetup.total || 0;
        const percent = total > 0 ? Math.min(99.9, (savedBytes / total) * 100) : s.localSetup.percent;
        return {
          partialDownloads: partials,
          isInstallingRuntime: false,
          isConnectingModel: false,
          isConnectingEmbedding: false,
          localSetup: {
            ...s.localSetup,
            stage: 'error',
            downloaded: savedBytes,
            total,
            percent,
            message: `Setup failed for ${entry.name}`,
            error: errMsg,
          },
        };
      });
      useUiStore.getState().pushToast('error', `Local model setup failed: ${errMsg}`, {
        dedupeKey: `local-setup-err:${entry.filename}`,
      });
      return false;
    } finally {
      void api.setAssistantFocusGuard({ busy: false });
    }
  },

  testLocalModel: async () => {
    if (get().isTestingLocalModel || get().isConnectingModel) {
      return (
        get().localTestResult ?? {
          ok: false,
          message: 'Local model engine is busy loading or testing…',
        }
      );
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
      const prev = s.modelDownloads[progress.filename];
      const entry = findCatalogEntryByFilename(progress.filename);
      const total = progress.total || prev?.total || entry?.sizeBytes || 0;
      const downloaded =
        progress.stage === 'error' && progress.downloaded === 0
          ? prev?.downloaded ?? 0
          : progress.downloaded;
      const percent =
        progress.percent > 0
          ? progress.percent
          : total > 0 && downloaded > 0
          ? Math.min(99.9, (downloaded / total) * 100)
          : prev?.percent ?? 0;

      const normalized: DownloadProgress = {
        ...progress,
        downloaded,
        total,
        percent,
      };

      const nextSetup =
        s.localSetup.stage === 'downloading' && s.localSetup.filename === progress.filename
          ? progress.stage === 'cancelled'
            ? {
                ...s.localSetup,
                stage: 'paused' as const,
                percent,
                downloaded,
                total,
                speedBps: 0,
                etaSecs: null,
                downloadStage: 'cancelled',
                message: `Paused download: ${s.localSetup.modelName} (${formatBytes(downloaded)} saved)`,
                error: null,
              }
            : {
                ...s.localSetup,
                percent,
                downloaded,
                total,
                speedBps: progress.speedBps ?? 0,
                etaSecs: progress.etaSecs ?? null,
                downloadStage: progress.stage ?? 'downloading',
                message: progress.error
                  ? `Download error: ${progress.error}`
                  : progress.stage === 'verifying'
                  ? `Verifying SHA-256 checksum for ${s.localSetup.modelName}…`
                  : `Downloading ${s.localSetup.modelName}… ${percent.toFixed(1)}%`,
              }
          : s.localSetup;
      return {
        modelDownloads: { ...s.modelDownloads, [progress.filename]: normalized },
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
