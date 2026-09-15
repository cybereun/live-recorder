# Live Recorder

Alt 코드를 복사하지 않고 새로 만든 실시간 녹음/받아쓰기 앱입니다.

## v1.1.0 Windows 설치형

기본·사이드·하단 보기는 같은 창을 재배치하므로 녹음이 이어집니다. 항상 위 고정과 시스템 오디오를 지원합니다. faster-whisper small/int8 엔진과 오프라인 모델을 설치 파일에 포함합니다.

새 녹음은 이전 오디오를 덮어쓰지 않고 새 세션에 저장합니다. 종료/업데이트 시 마지막 오디오와 받아쓰기, 아카이브 저장 완료를 기다립니다. 사용자 데이터는 앱 프로필에 보존됩니다.

첫 설치형 버전이므로 기존 웹앱에서 자동 전환되지는 않습니다. 이후 상위 버전을 GitHub 공개 릴리즈하면 다운로드 팝업 → 저장 후 업데이트 → 기존 프로그램 교체 → 재실행 순서로 진행됩니다. 기존 웹브라우저 기록과 설치형 저장소는 별개이므로 웹 기록은 먼저 내보내기해 주세요.

### 데스크톱 개발·빌드

```powershell
npm install
python -m venv .build-venv
.\.build-venv\Scripts\python.exe -m pip install -r requirements-build.txt
powershell -ExecutionPolicy Bypass -File scripts/build-engine.ps1
npm test
npm start
npm run dist
```

기존 `bin/`의 whisper.cpp·FFmpeg와 `whisper-cpp/ggml-base.bin`은 Git에 포함하지 않으며 빌드 전에 준비해야 합니다. 주 엔진은 faster-whisper이고 base 모델은 대체 엔진용입니다.

배포 시 `dist/`의 설치 파일, `.blockmap`, `latest.yml`을 같은 GitHub 릴리즈에 올리세요. `package.json` 버전을 올린 뒤 빌드합니다. `npm run dist`는 빌드만 수행합니다.

검증: `node --test tests/recording.test.cjs tests/server.test.cjs`. Electron 통합 검증: `electron tests/desktop-smoke.cjs` (임시 프로필·가상 마이크 사용).

## 웹 개발 서버 실행

```powershell
node server.js
```

브라우저에서 `http://127.0.0.1:5177`을 엽니다.

## 현재 기능

- 마이크 녹음
- 로컬 Whisper 청크 받아쓰기 구조
- 입력 레벨 시각화
- 녹음 일시정지
- 마커 추가
- 세션별 transcript 저장
- transcript 복사 및 TXT 내보내기
- 녹음 파일 다운로드

## Whisper 런타임

설치형 앱은 `build/models/small`의 faster-whisper 모델을 포함하며, 대체 엔진은 아래 모델을 사용합니다.

```text
whisper-cpp/ggml-base.bin
```

로컬 전사를 실제로 실행하려면 아래 파일도 필요합니다.

```text
bin/whisper-cli.exe
bin/ffmpeg.exe
```

`ffmpeg.exe`는 포함되어 있습니다. `whisper-cli.exe`는 whisper.cpp 공식 Windows 빌드의 실행 파일을 넣으면 됩니다.

## 다음 단계

- SQLite 저장
- 화자 분리
- 로컬 LLM 요약/제목 생성


## Local Whisper 안정화

- 브라우저 SpeechRecognition 대신 로컬 faster-whisper 엔진을 사용하며 whisper.cpp를 대체 엔진으로 지원합니다.
- 음성 엔진을 상시 실행해 모델 재로딩을 줄입니다.
- 서버에서 WAV 변환 후 RMS/Peak/Active Ratio 기반 오디오 게이트를 적용해 무음 환각을 차단합니다.
- 짧은 단일 음절/steady tone 결과와 흔한 무음 환각 문구는 기록하지 않습니다.
- 실행: `node server.js`, 접속: `http://127.0.0.1:5177`
