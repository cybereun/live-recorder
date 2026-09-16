# Live Recorder

[![Release](https://img.shields.io/github/v/release/cybereun/live-recorder?display_name=tag&sort=semver&label=release&color=0f766e)](https://github.com/cybereun/live-recorder/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white)](https://github.com/cybereun/live-recorder/releases/tag/v1.1.0)
[![Electron](https://img.shields.io/badge/Electron-41.10.7-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Transcription](https://img.shields.io/badge/transcription-faster--whisper%20small%20%7C%20int8-8B5CF6)](https://github.com/SYSTRAN/faster-whisper)
[![Tests](https://img.shields.io/badge/tests-5%20passed-2EA44F)](tests/)
[![License](https://img.shields.io/badge/license-proprietary%20%7C%20all%20rights%20reserved-B91C1C)](LICENSE)

강의와 회의의 소리를 내 PC에서 녹음하고, 로컬 음성 엔진으로 받아쓰며, 문장을 노트처럼 쌓아 가는 개인용 Windows 앱입니다. 외부 클라우드 전사 API에 음성을 보내지 않고 로컬 서버와 로컬 모델을 사용합니다.

> 개인 전용 소프트웨어입니다. 이 저장소의 본인 작성 소스 코드, 문서, UI 디자인, 로고 및 구성은 `Lebi_cybereun`에게 저작권이 있습니다. 별도 서면 허가 없이 복사, 수정, 이동, 재배포, 재판매, 재라이선스 또는 다른 프로젝트에 포함할 수 없습니다. 자세한 조건은 [LICENSE](LICENSE)를 확인하세요.
>
> Electron, faster-whisper, whisper.cpp, FFmpeg 및 기타 포함·사용 구성 요소에는 각 원저작자의 라이선스가 적용됩니다. 이 개인 전용 고지는 해당 구성 요소의 원래 라이선스를 대신하지 않습니다.

## 개발자

| 항목 | 정보 |
| --- | --- |
| 개발자 | **Lebi_cybereun** |
| GitHub | [@cybereun](https://github.com/cybereun) |
| 저장소 | [cybereun/live-recorder](https://github.com/cybereun/live-recorder) |
| 저작권 | © 2026 Lebi_cybereun. All rights reserved. |
| 용도 | 개인 학습·기록용 |

## 앱의 특징

- **로컬 우선 녹음과 받아쓰기**: 마이크 음성을 로컬 faster-whisper `small/int8` 엔진으로 처리합니다.
- **오프라인 모델 포함**: Windows x64 설치 파일에 음성 엔진과 모델을 포함해 네트워크가 없어도 기본 전사를 사용할 수 있습니다.
- **시스템 오디오 지원**: 강의·화면의 시스템 오디오와 마이크 입력을 사용할 수 있습니다.
- **세 가지 보기**: 기본, 사이드, 하단 보기로 창을 재배치하며 녹음 중에도 현재 세션을 유지합니다.
- **항상 위 고정**: 작은 창을 다른 프로그램 위에 고정해 강의를 보면서 메모할 수 있습니다.
- **세션 단위 보관**: 새 녹음은 새 세션으로 저장되어 이전 오디오를 덮어쓰지 않습니다.
- **노트 기능**: 일시정지, 마커, 문장별 transcript, 복사, TXT 내보내기, 녹음 파일 다운로드를 제공합니다.
- **무음 보호**: RMS·Peak·Active Ratio 오디오 게이트와 무음 환각 문구 필터로 의미 없는 전사 결과를 줄입니다.
- **안전한 종료와 업데이트**: 종료·업데이트 전에 마지막 오디오와 받아쓰기, 아카이브 저장이 끝날 때까지 기다립니다.

## v1.1.0 릴리즈

[v1.1.0 다운로드](https://github.com/cybereun/live-recorder/releases/tag/v1.1.0)

첫 Windows 설치형 릴리즈입니다. 설치 없이 실행하는 포터블 파일도 함께 제공합니다.

- Windows x64 NSIS 설치 파일 제공
- faster-whisper `small/int8` 독립 실행 엔진과 오프라인 모델 포함
- 기본·사이드·하단 보기 및 항상 위 고정
- 녹음 중 보기 전환, 일시정지·재개, 세션별 오디오 보관
- 마지막 저장 완료 후 종료·업데이트하도록 종료 흐름 보강
- 설치형 앱에서 사용할 실제 리소스 경로와 로컬 서버 인증 정리
- GitHub Releases의 `latest.yml`과 blockmap을 이용한 업데이트 준비

설치 파일: [Live-Recorder-Setup-1.1.0-x64.exe](https://github.com/cybereun/live-recorder/releases/download/v1.1.0/Live-Recorder-Setup-1.1.0-x64.exe)

## v1.1.1 릴리즈

중복 전사 문장을 줄이고, 새 아이콘과 포터블 실행 파일을 추가한 업데이트입니다.

- 음성 청크 경계에서 반복 문장이 중복 표시되는 문제 완화
- 투명 배경 앱 아이콘 및 작업표시줄 아이콘 적용
- Windows x64 설치형과 포터블 실행 파일 제공

[v1.1.1 다운로드](https://github.com/cybereun/live-recorder/releases/tag/v1.1.1)

- [설치형 다운로드](https://github.com/cybereun/live-recorder/releases/download/v1.1.1/Live-Recorder-Setup-1.1.1-x64.exe)
- [포터블 다운로드](https://github.com/cybereun/live-recorder/releases/download/v1.1.1/Live-Recorder-Portable-1.1.1-x64.exe)

## 사용 방법

1. [릴리즈 페이지](https://github.com/cybereun/live-recorder/releases)에서 설치 파일을 내려받아 실행합니다.
2. 앱을 열고 입력 장치, 화자 수, 언어를 선택합니다.
3. **녹음 시작**을 누릅니다. 녹음 중에는 문장이 로컬 엔진에서 처리되어 노트 영역에 추가됩니다.
4. 잠시 멈추려면 일시정지 버튼을 누르고, 중요한 순간에는 마커를 추가합니다.
5. 강의 화면 위에 작은 창을 두려면 **사이드** 또는 **하단** 보기를 선택하고 **항상 위**를 켭니다.
6. 녹음을 끝내려면 **정지**를 누릅니다. 오디오와 받아쓰기가 저장된 뒤 세션이 완료됩니다.
7. 필요할 때 **아카이브 저장**, **TXT**, **오디오** 기능으로 기록을 보관하거나 내보냅니다.

### 업데이트

설치형 앱은 시작 후 GitHub Releases를 확인합니다. 새 버전이 있으면 다운로드를 선택할 수 있고, 다운로드가 끝난 뒤 녹음과 저장을 완료하면 프로그램을 교체하고 다시 실행합니다. 사용자 데이터는 앱 프로필에 보존됩니다.

v1.1.0은 기존 웹앱 저장소와 별개의 첫 설치형 버전입니다. 기존 브라우저 기록을 설치형 앱으로 자동 이전하지 않으므로 웹 기록은 먼저 TXT 등으로 내보내세요.

## 릴리즈 스토리

### 웹 기반 기록 도구에서 설치형 앱으로

처음에는 브라우저에서 녹음하고 받아쓰는 흐름을 실험했습니다. 이후 장시간 강의에서 필요한 녹음 연속성, 로컬 데이터 보존, 시스템 오디오, 업데이트 안정성을 한 곳에서 관리하기 위해 Electron 설치형 구조로 전환했습니다.

### v1.1.0 — 첫 Windows 설치형 릴리즈

브라우저의 임시 실행 흐름을 독립 Windows 앱으로 묶었습니다. faster-whisper 엔진을 상시 프로세스로 실행해 모델 재로딩을 줄였고, 무음 오디오 게이트와 세션 분리를 적용했습니다. 종료·업데이트 시에는 마지막 문장과 오디오가 저장된 뒤 프로그램이 닫히도록 구성했습니다.

릴리즈에는 설치 파일, `latest.yml`, blockmap을 함께 제공합니다. 다음 버전부터는 같은 배포 규칙을 유지하면서 전사 품질, 장시간 녹음, 데이터 관리 기능을 확장합니다.

## 개발 환경

### 요구 사항

- Windows 10/11 x64
- Node.js 및 npm
- Python 3.12 권장
- Windows x64용 whisper.cpp·FFmpeg 실행 파일과 모델 파일

배포용 엔진 파일과 모델은 크기 때문에 Git 저장소에 넣지 않습니다. 새 환경에서 설치형 빌드를 만들려면 `bin/`, `whisper-cpp/ggml-base.bin` 및 빌드에 필요한 모델 자료를 먼저 준비해야 합니다.

### 실행과 테스트

```powershell
npm ci
npm test
npm start
```

웹 개발 서버만 실행하려면 다음을 사용합니다.

```powershell
npm run start:web
# http://127.0.0.1:5177
```

로컬 음성 엔진과 Windows 설치 파일을 다시 만들려면 다음 순서로 실행합니다.

```powershell
python -m venv .build-venv
.\.build-venv\Scripts\python.exe -m pip install -r requirements-build.txt
powershell -ExecutionPolicy Bypass -File scripts/build-engine.ps1
npm test
npm run dist
npm run dist:portable
```

출력 파일은 `dist/`에 생성됩니다. Windows 자동 업데이트 대상은 NSIS 설치 파일이며, 같은 릴리즈에 설치 파일, `.blockmap`, `latest.yml`을 올립니다. 포터블 파일은 `Live-Recorder-Portable-${version}-x64.exe` 이름으로 별도 업로드합니다.

### 검증 항목

- Node 회귀 테스트: 일시정지 시간, 저장 순서, 중복 녹음 방지, 창 좌표, 서버 인증·파일 제한·무음 차단
- Electron 통합 테스트: 기본·사이드·하단 보기, 가로 넘침, 항상 위, 가상 마이크 녹음, 일시정지·재개, 오디오 저장
- 엔진 스모크 테스트: faster-whisper 독립 실행 파일의 실제 음성 전사와 UTF-8 JSON 입출력

자세한 결과는 [VERIFICATION.md](VERIFICATION.md)와 [RELEASE-NOTES.md](RELEASE-NOTES.md)에 기록합니다.

## 저장 위치와 개인정보

녹음·transcript·아카이브는 Electron 앱 프로필의 로컬 저장소에 보관합니다. 로컬 전사 엔진을 사용하므로 음성 데이터가 외부 전사 API로 전송되지 않습니다. 시스템 오디오나 마이크를 녹음할 때는 해당 콘텐츠의 녹음 권한과 법적 요건을 확인하세요.

## private 저장소와 자동 업데이트

가능합니다. `electron-updater`는 private GitHub 업데이트 저장소를 지원하지만, 공식 문서에 따라 `private: true` 설정과 업데이트를 확인하는 사용자 PC의 `GH_TOKEN` 환경 변수가 필요합니다. 업데이트 확인은 GitHub API를 사용합니다.

다만 설치 파일 안에 토큰을 넣으면 누구나 토큰을 추출할 수 있습니다. 따라서 여러 사람에게 배포하는 앱에서는 private GitHub Releases를 클라이언트의 공용 토큰으로 직접 열지 않는 편이 안전합니다.

현재 이 저장소는 public입니다. README와 LICENSE는 저작권과 사용 허가 범위를 명시하지만 공개 저장소의 clone·fork·파일 열람 자체를 기술적으로 막지는 못합니다. 실제 접근을 제한하려면 GitHub 저장소 Visibility를 `Private`로 변경하고 허용된 계정만 collaborator로 등록해야 합니다.

개인 전용으로 한 대의 PC에서만 사용할 때의 선택지는 다음과 같습니다.

1. **소스 저장소는 private, 릴리즈 저장소는 public**: 소스와 개발 자료를 보호하면서 설치 파일과 자동 업데이트는 토큰 없이 제공합니다. 개인 앱 배포에 가장 관리하기 쉬운 방식입니다.
2. **소스와 릴리즈 저장소 모두 private**: 사용자 PC에 읽기 전용 권한의 `GH_TOKEN`을 직접 설정하고, 빌드 설정에 `private: true`를 적용합니다. 토큰을 앱 코드·README·`package.json`에 기록하면 안 됩니다.
3. **별도 인증 업데이트 서버**: private 저장소를 직접 노출하지 않고 인증된 HTTPS 업데이트 서버를 사용합니다.

현재 v1.1.0 설치 파일은 public GitHub Releases 기준으로 빌드되어 있습니다. 저장소를 private으로 전환하려면 다음 릴리즈부터 private updater 설정과 사용자 PC의 토큰 관리까지 함께 변경하고 다시 빌드해야 합니다.

참고: [electron-builder Auto Update — Private GitHub Update Repo](https://www.electron.build/docs/features/auto-update/#private-github-update-repo)

## 라이선스 및 사용 제한

이 프로젝트의 본인 작성 부분은 [LICENSE](LICENSE)에 명시한 독점 조건을 따릅니다. 개인 전용 프로젝트이므로 Pull Request, 재배포, 포크, 상업적 사용 및 2차 저작물 제작은 사전 서면 허가 없이는 허용하지 않습니다.
