# Security Policy

## Supported versions

Township is pre-1.0 and moves fast. Security fixes land on `main` only; if
you deploy Township, track `main`.

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |
| Anything else | No  |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/StevenWang-CY/township/security/advisories/new)
("Security" tab → "Report a vulnerability"). Do not open a public issue for
anything exploitable.

You will get an acknowledgement within **7 days**, and we'll keep you updated
as we triage and fix. We're happy to credit reporters in the advisory unless
you'd rather stay anonymous.

## Scope notes

A few things worth knowing about Township's security posture:

- **Township is an LLM API proxy.** The backend holds the credentials and
  calls the model providers; the browser never receives a key. All secrets
  are server-side environment variables — see [`.env.example`](.env.example)
  for the complete list. If you find any path where a credential reaches the
  frontend, logs, or a simulation cache file, that is exactly the kind of
  report we want.
- **Never commit credentials.** No API key belongs in this repository, in a
  scenario file, or in a persona. A committed key in any PR will be treated
  as a security incident (revoke, purge, report).
- **No telemetry.** Township phones home to nothing. The only outbound
  network calls are the LLM/TTS/STT provider APIs you configure — and in
  mock or replay mode, none at all. Any change that adds undisclosed
  outbound traffic is a vulnerability.
- **Model behavior is not a vulnerability.** Biased, incorrect, or otherwise
  unwanted model output is a limitation, not an exploit — see
  [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md). Misuse of Township itself can be
  reported through the same advisory channel.
