# Sorashi DAW plugins

This directory is reserved for repository-distributed plugin content.

Recommended layout for a future custom Drum Kit:

```
plugins/
  drum-kits/
    <kit-id>/
      manifest.json
      README.md
      samples/
        kick/
        snare/
        hats/
        perc/
        fx/
```

The manifest should map the kit to a stable plugin ID and declare its assets. The web plugin registry consumes the shared manifest contract from `packages/shared/src/plugins.ts`.

Repository content is appropriate for factory/sample-pack content that should not be duplicated into Supabase. Runtime room uploads remain under the existing R2 room-asset path.

A future kit can therefore be added as an additive plugin package: content + manifest + optional runtime adapter. Core Telegram auth, Beat Room, collaboration transport, project persistence and existing DAW panels do not need to be rewritten.
