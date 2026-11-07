export type PluginKind =
  | "drum-kit"
  | "sample-pack"
  | "synthesizer"
  | "wavetable"
  | "preset"
  | "effect"
  | "instrument"
  | "midi-tool"
  | "audio-plugin"
  | "collaborative-feature";

export type PluginRuntime = "asset" | "web-audio" | "midi" | "ui" | "collaboration";

export type PluginAssetRef = {
  id: string;
  pluginId: string;
  kind: PluginKind;
  name: string;
  category?: string;
  path?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type PluginManifest = {
  id: string;
  version: string;
  name: string;
  kind: PluginKind;
  runtimes: PluginRuntime[];
  description?: string;
  entry?: string;
  assets?: PluginAssetRef[];
  capabilities?: string[];
};

export type PluginOperation = {
  pluginId: string;
  action: string;
  targetId: string;
  payload: Record<string, unknown>;
};

export type PluginRegistrationContext = {
  registerAsset(asset: PluginAssetRef): void;
  registerOperation(pluginId: string, action: string, targetId: string, payload: Record<string, unknown>): void;
};

export interface SorashiPlugin {
  manifest: PluginManifest;
  register?(context: PluginRegistrationContext): void;
}

export type PluginCatalog = {
  plugins: PluginManifest[];
  assets: PluginAssetRef[];
};

export function createPluginCatalog(plugins: SorashiPlugin[]): PluginCatalog {
  const assets: PluginAssetRef[] = [];
  const assetIds = new Set<string>();
  const registerAsset = (asset: PluginAssetRef) => {
    if (assetIds.has(asset.id)) throw new Error("Duplicate plugin asset: " + asset.id);
    assetIds.add(asset.id);
    assets.push(asset);
  };

  for (const plugin of plugins) {
    for (const asset of plugin.manifest.assets ?? []) registerAsset(asset);
    plugin.register?.({
      registerAsset,
      registerOperation: () => {
        // Operation registration is a runtime concern; manifests stay serializable.
      },
    });
  }

  return { plugins: plugins.map(plugin => plugin.manifest), assets };
}
