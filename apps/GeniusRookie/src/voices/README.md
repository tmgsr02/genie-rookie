# Local Phonon voice assets

The inherited runtime requires these two files at build time:

- `apps/GeniusRookie/src/voices/Angel_F01.safetensors`
- `apps/GeniusRookie/src/voices/Devil_01.safetensors`

They are intentionally excluded from this public source repository and ignored by Git. Redistribution permission for the existing custom voices has not been independently established. Supply permitted copies locally before running `scripts/setup.py`. If using voices you own or are authorized to use, export compatible Phonon safetensors and use the filenames expected above, or update the voice mappings and `scripts/phonon_package.py` together.

Phonon-compatible voices can be obtained through [Gradium Studio](https://studio.gradium.ai) or the [Phonon voice library](https://huggingface.co/gradium/phonon-voices), subject to their applicable terms. The current project does not automatically fetch or grant rights to those voice assets. `scripts/download_models.py` downloads the model checkpoint, not these custom voices.

Boson speech uses server-side presets and does not use these voice files for synthesis. The build still packages the inherited Phonon option. Preserve [third-party notices](../../THIRD_PARTY_NOTICES.md) when preparing a binary or convenience ZIP.
