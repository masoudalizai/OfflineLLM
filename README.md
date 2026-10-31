# OfflineLLM

A basic on-device chat app built with Expo SDK 57 and llama.rn. Import a local GGUF language model, optionally load a matching GGUF LoRA adapter, and chat with streaming replies. Includes stop, new chat, model unload, adapter strength, and a GPU toggle.

## Install

```bash
brew install node@24 watchman cocoapods
npm ci
```

The project approves the pinned llama.rn postinstall script to fetch its verified native inference libraries. If your npm version skipped it, run `npm rebuild llama.rn --foreground-scripts` before building.

## iPhone development build

Xcode 27/iOS 27 requires the UIKit scene lifecycle. This project enables it through `expo-build-properties` (`ios.enableSceneSupport`) and requires Expo 57.0.30 or newer within SDK 57. After updating dependencies or this setting, run `npx expo prebuild --platform ios --no-clean` before building an existing native project.

Connect the iPhone, enable Developer Mode, and configure your Xcode signing team. On this Mac, use the full Xcode developer directory:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npm run ios
```

`npm run android` builds for a connected Android device with the Android SDK installed. After the native development app is installed, use `npm start` for subsequent JavaScript changes. Native dependency or plugin changes require rebuilding. A Release build is required to test app launch without Metro.

Expo Go and `npm run web` can preview the interface; they cannot run the native model runtime. The browser clearly reports this when model loading is attempted.

## Your Gemma 4 E2B adapter

See [the Kaggle export and iPhone testing guide](docs/kaggle-export.md). Your final Kaggle adapter is safetensors, which must be converted or merged and exported before importing it. A merged fine-tuned GGUF is the suggested first test: choose it under **Base or merged model** and leave **Use adapter** off.

For separate-adapter testing, both files must be GGUF and the adapter must match the actual base checkpoint. The app passes the adapter to the same native model context with the selected strength. Unload and reload to compare with the adapter disabled.

The app copies selected files to cache. File selections and chats last for the current app session. It makes no model/chat network requests. Defaults: 2,048 context tokens, 256 reply tokens, seed 3407, thinking disabled, and the model's embedded chat template. This first version supports text chat and one unsplit model file.

## Verify

```bash
npm run typecheck
npm test
npx expo export --platform all
```

Tests mock the native boundary to check adapter attachment, base-only loading, rejected formats, streaming, stop/release delegation, and unsupported-template cleanup. Actual on-device inference and response quality still need the exported model and a native phone build.
