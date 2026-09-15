$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$enginePython = Join-Path $projectRoot '.build-venv\Scripts\python.exe'
if (!(Test-Path $enginePython)) { throw '먼저 python -m venv .build-venv 후 requirements-build.txt를 설치하세요.' }
& $enginePython -m PyInstaller --noconfirm --onedir --name faster-whisper --distpath build/engine --workpath build/pyinstaller --specpath build --collect-all faster_whisper --collect-all ctranslate2 --collect-all tokenizers --collect-all onnxruntime engines/faster-whisper/engine.py
if ($LASTEXITCODE -ne 0) { throw '음성 엔진 빌드 실패' }
& $enginePython -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small', local_dir='build/models/small', allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','preprocessor_config.json'])"
if ($LASTEXITCODE -ne 0) { throw '음성 모델 다운로드 실패' }
