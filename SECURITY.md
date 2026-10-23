# Security status

Enan is a development preview. There are no supported production releases yet. The remaining authentication, backup, job recovery, audit, and release-security requirements are tracked in docs/STATUS.md and the feature specs.

The default Compose deployment publishes the application on loopback only. The database is a SQLite file on the `data` volume, readable by the application user only; nothing else is listening. Secrets belong in the ignored `.env` file. The setup token is printed in the application log only while the installation has no users.

The `updater` service runs on every Compose install and is given the Docker socket, which is equivalent to root on the host (ADR 0057). It listens on no port, talks only to the image registry and the optional `ENAN_ALERT_WEBHOOK`, and installs a release only when an administrator chooses Install now or turns on automatic installing. The application never gets the socket; it leaves requests as files on a volume the updater reads. To run without it, set `ENAN_UPDATER_REPLICAS=0` in `.env` (README § Automatic updates).

## Reporting a vulnerability

Report privately through the repository's GitHub Security Advisories ("Report a vulnerability") once the repository is public, or by email to the address the maintainer lists in the repository description. Expect an acknowledgement within seven days. Do not put credentials, session tokens, private office documents, or exploitable vulnerability details in public issue reports.

## Supported versions

There are no supported production releases yet; fixes land on `main` only.
