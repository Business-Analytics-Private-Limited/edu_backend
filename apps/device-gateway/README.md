# Device gateway

`@eduplatform/device-gateway`: receives attendance punches from biometric devices (ZKTeco / eSSL "ADMS" push protocol). Kept separate from the API because devices have different traffic and security needs (ADR-0001).

Phase 1: health endpoint only (`GET /health` on port 3002).
Phase 5: `/iclock/...` endpoints and punch ingestion. Design: [docs/modules/attendance.md](../../docs/modules/attendance.md).
