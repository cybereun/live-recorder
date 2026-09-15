# faster-whisper engine

Windows streaming fallback inspired by Lightning-SimulWhisper's architecture.

- Long-lived Python process
- CTranslate2/faster-whisper backend
- VAD enabled in the engine
- Previous transcript is passed as prompt context
- Node server falls back to whisper.cpp when this engine is unavailable

Default model: small, CPU int8. Override with environment variables:

- FW_MODEL=base|small|medium|large-v3
- FW_COMPUTE_TYPE=int8|int8_float16|float32
- FW_CPU_THREADS=6
