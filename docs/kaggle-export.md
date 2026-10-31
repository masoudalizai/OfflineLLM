# Export your Gemma 4 E2B tutor for iPhone

The [Kaggle notebook](https://www.kaggle.com/code/mohammadmasoudalizai/gemma-4-e2b) version 28 was inspected on 2026-10-31. Its final export is:

```text
tutor_unsloth_qlora/gemma4-e2b-unsloth-qlora-full-r8-001/adapter-step-11803/
  adapter_config.json
  adapter_model.safetensors
  chat_template.jinja
  run_signature.json
  tokenizer.json
  tokenizer_config.json
```

This is a PEFT LoRA, not a standalone model or a phone-ready GGUF. Keep that folder (or `adapter-step-11803.zip`) and the training checkpoints as your originals.

## First test: export one merged GGUF

Merging incorporates the trained adapter into the base weights. The iPhone then loads one quantized model file. You can still keep the original adapter for training or later separate-adapter testing.

In the Kaggle session where the final trained `model` and its `tokenizer`/processor are still loaded, add and run this cell **after training**:

```python
from pathlib import Path
import tempfile

export_dir = Path(tempfile.mkdtemp(prefix='iphone_gemma4_tutor_', dir='/kaggle/working'))
model.save_pretrained_gguf(
    str(export_dir),
    tokenizer,
    quantization_method='q4_k_m',
    merge_is_disposable=True,
)
for folder in (export_dir, Path(str(export_dir) + '_gguf')):
    for file in sorted(folder.rglob('*.gguf')):
        print(file, round(file.stat().st_size / 1024**3, 2), 'GiB')
```

This uses [Unsloth's documented Gemma 4 export API](https://unsloth.ai/docs/models/gemma-4/train#saving-export-fine-tuned-model). It requires working Internet, sufficient free disk space for conversion intermediates, and the already-loaded fine-tuned model. Export can consume substantially more space than the final quantized file. Do not rerun training just to export.

The user's installed exporter still reported 21.1 GiB required versus 19.4 GiB free even with `merge_is_disposable=True`. That option was insufficient in this environment. Do not bypass the disk check or delete training checkpoints. Check alternate filesystems instead; changing a folder name on the same filesystem does not add space.

Run this replacement cell in the same live Kaggle session. It prints available space, selects a writable location with at least 23 GiB free (headroom over this reported estimate), and keeps the conversion working directory there too. Unsloth's own preflight remains enabled and is the final check. No files are deleted.

```python
import os, shutil, tempfile
from pathlib import Path

candidates = []
for location in ('/kaggle/working', '/kaggle/temp', '/tmp'):
    if os.path.isdir(location) and os.access(location, os.W_OK):
        free = shutil.disk_usage(location).free / 1024**3
        print(location, 'filesystem:', os.stat(location).st_dev, 'free GiB:', round(free, 1))
        candidates.append((free, location))

if not candidates or max(candidates)[0] < 23:
    raise RuntimeError('No checked location has 23 GiB free. Share the space figures printed above; do not retry the export yet.')

root = Path(tempfile.mkdtemp(prefix='iphone_gemma4_', dir=max(candidates)[1]))
previous_cwd = os.getcwd()
try:
    os.chdir(root)
    model.save_pretrained_gguf(
        str(root / 'merged'), tokenizer,
        quantization_method='q4_k_m',
        temporary_location=str(root / 'buffers'),
        merge_is_disposable=True,
    )
finally:
    os.chdir(previous_cwd)

print('Export root:', root)
for file in root.rglob('*.gguf'):
    print(file)
```

See [Unsloth's export implementation](https://github.com/unslothai/unsloth/blob/main/unsloth/save.py) for conversion working-directory and disk checks. An export under `/tmp` or `/kaggle/temp` needs its final language-model Q4_K_M GGUF copied into `/kaggle/working` for saved notebook output; do this before the session ends. Copy only the final quantized model, not the full-precision intermediates. GGUF files can be written to a sibling directory ending in `_gguf`.

If the session has ended, attach the final adapter output to a fresh GPU notebook and reload **that saved adapter**, not a newly initialized LoRA. Use the recorded environment from `resume_requirements.txt` and the saved processor/template. Verify a Dari/Pashto reply in Kaggle before exporting. The export cell above is prepared but has not been run against your weights.

The log shows that Unsloth replaced `unsloth/gemma-4-E2B-it` with `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit` and ignored the requested revision. The final `adapter_config.json` confirms the latter repository and records `revision: null`. The requested revision in `run_signature.json` therefore does not by itself prove which base snapshot was loaded. Reuse the actual trained model when possible; establish the resolved snapshot before reproducing the merge elsewhere. Do not silently substitute a QAT base or another Gemma checkpoint.

Download the resulting **language-model Q4_K_M GGUF** to Files on the iPhone (AirDrop works). For this text-only chat, a vision/audio `mmproj` file is not used. This app currently accepts one model GGUF; split models need to be joined before import.

## Run on iPhone 17

On the Mac, connect and unlock the iPhone, trust the computer, and enable Developer Mode. Open Xcode once to finish setup and select your signing team when prompted. CocoaPods and the iOS SDK must be installed.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npm run ios
```

Select your connected phone. This builds and installs a native development app containing `llama.rn`; Expo Go does not contain this runtime. The first build can take several minutes. Use a physical phone to assess RAM and speed.

1. In the app, choose the exported GGUF under **Base or merged model**.
2. Leave **Use adapter** off for a merged file. Applying the adapter again would double its effect.
3. Leave GPU acceleration on; turn it off if the model fails to load.
4. Tap **Load model**, then send a short Dari or Pashto prompt.
5. Use **Stop** to interrupt, **New chat** for a clean conversation, and **Unload** before switching model files.

Files are copied into the app's cache for immediate native access. Allow free disk space for that extra copy. File selections and chats last for the current app session; import again after restarting. To test fully without the Mac/Metro development server, install a **Release** build after signing is configured:

```bash
npm run ios -- --configuration Release
```

The development build uses Metro to load app code; model inference itself has no network requests. For a real offline test, launch the Release app, import the local model, enable Airplane Mode, and send another message.

## Compare base versus fine-tune

Keep prompts and sampling settings identical and start a new chat for each test. Compare a matching base-only GGUF with the merged fine-tuned GGUF. Alternatively, convert the adapter with a current `llama.cpp/convert_lora_to_gguf.py` and load it separately with a matching base GGUF; validate tensor and architecture compatibility before assuming the conversion is correct. The native loader reports incompatible tensors as errors.

Try `سلام! خودت را به زبان دری معرفی کن.` and `سلام! په پښتو ژبه ځان معرفي کړه.`. Check response language, relevance, repetition, and reported tokens/second. The app uses the model's chat template, disables thinking, and keeps parsed answer content in the conversation history. Its initial limits are 2,048 context tokens and 256 generated tokens. If context fills, start a new chat.

The interface, JS bundles, and mocked inference contract can be verified without weights. Actual model loading, adapter compatibility, memory use, and response quality require your exported file and an installed device build; these are not established by those checks.
