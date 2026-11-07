import {
  createPluginCatalog,
  type PluginAssetRef,
  type PluginManifest,
  type SorashiPlugin,
} from "../../../packages/shared/src/plugins";

const CORE_PLUGINS: SorashiPlugin[] = [
  {
    manifest: {
      id: "sorashi.core.drum-kits",
      version: "1.0.0",
      name: "Core Drum Kits",
      kind: "drum-kit",
      runtimes: ["asset", "ui", "web-audio"],
      description: "Built-in drum kit definitions and room asset integration.",
    },
  },
  {
    manifest: {
      id: "sorashi.core.samples",
      version: "1.0.0",
      name: "Core Samples",
      kind: "sample-pack",
      runtimes: ["asset", "ui", "web-audio"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.synth",
      version: "1.0.0",
      name: "Core Synth",
      kind: "synthesizer",
      runtimes: ["ui", "web-audio", "collaboration"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.wavetables",
      version: "1.0.0",
      name: "Core Wavetables",
      kind: "wavetable",
      runtimes: ["asset", "ui", "web-audio"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.presets",
      version: "1.0.0",
      name: "Core Presets",
      kind: "preset",
      runtimes: ["asset", "ui"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.effects",
      version: "1.0.0",
      name: "Core Effects",
      kind: "effect",
      runtimes: ["ui", "web-audio", "collaboration"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.instruments",
      version: "1.0.0",
      name: "Core Instruments",
      kind: "instrument",
      runtimes: ["ui", "web-audio", "midi", "collaboration"],
    },
  },
  {
    manifest: {
      id: "sorashi.core.midi-tools",
      version: "1.0.0",
      name: "Core MIDI Tools",
      kind: "midi-tool",
      runtimes: ["ui", "midi", "collaboration"],
    },
  },
];

export function createWebPluginCatalog(extraPlugins: SorashiPlugin[] = []) {
  return createPluginCatalog([...CORE_PLUGINS, ...extraPlugins]);
}

export function registerRoomAsset(
  asset: Omit<PluginAssetRef, "pluginId"> & { pluginId?: string },
): PluginAssetRef {
  return {
    ...asset,
    pluginId: asset.pluginId ?? "sorashi.room.assets",
  };
}

export function pluginKinds(): PluginManifest["kind"][] {
  return [
    "drum-kit",
    "sample-pack",
    "synthesizer",
    "wavetable",
    "preset",
    "effect",
    "instrument",
    "midi-tool",
    "audio-plugin",
    "collaborative-feature",
  ];
}
