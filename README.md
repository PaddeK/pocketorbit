# pocketorbit

Keeps [BookOrbit](https://bookorbit.app) up to date with what you read in the **built-in reader of a PocketBook**
e-reader, without KOReader or anything else installed on the device.

```
PocketBook reader ──(built-in cloud sync)──▶ PocketBook Cloud ──(polled)──▶ pocketorbit ──(KOReader sync API)──▶ BookOrbit
```

BookOrbit syncs reading progress with Kobo devices and KOReader, but not with PocketBook's own reader. That reader
does sync its reading position to PocketBook Cloud, though. pocketorbit polls PocketBook Cloud every few minutes
and forwards each book's percentage to BookOrbit through the same API the BookOrbit KOReader plugin uses, so the
e-reader appears in BookOrbit like a KOReader device.

How it works:

1. **List** your books in PocketBook Cloud with their reading percentage and status.
2. **Fingerprint** each new book once: it is downloaded (streamed, not kept) to compute KOReader's partial MD5,
   the ID BookOrbit uses to recognise a file.
3. **Match** the fingerprints with BookOrbit. Books it doesn't recognise are listed under
   *Settings → KOReader → Books to Review* in BookOrbit, where you can link them to a library book once.
   Unmatched books are checked again on every cycle, so links take effect without a restart.
4. **Send** the percentage of every matched book whose progress changed, with PocketBook's timestamp.
   BookOrbit ignores a value older than progress it already has (e.g. from its web reader or another device),
   unless it reaches further into the book.

## Quick start

### 1. BookOrbit

Go to *Settings → KOReader*, turn on **Progress sync** and create credentials. Your user needs the
`koreader_sync` permission. You don't need to download the KOReader plugin.

### 2. PocketBook

Under *Settings → Accounts and Synchronization → PocketBook Cloud*, log in and turn on **Autosync** and
**Auto-upload**, so books you add to the reader (also via OPDS) are uploaded with their reading position.

> If uploading a book fails with *"not enough space"* although the cloud is almost empty, the reader is logged
> in to PocketBook Cloud without a shop. Log out and log in again, choosing your shop (e.g. Pocketbook.de).

### 3. pocketorbit

```sh
docker run -d --name pocketorbit --restart unless-stopped -v pocketorbit-data:/data \
  -e PB_EMAIL=you@example.org -e PB_PASSWORD=… \
  -e BOOKORBIT_URL=https://books.example.org -e BOOKORBIT_USER=… -e BOOKORBIT_PASSWORD=… \
  -e "DEVICE_NAME=PocketBook Era Color" \
  ghcr.io/paddek/pocketorbit:latest
docker logs -f pocketorbit
```

Or add it to the stack that runs BookOrbit, see [`compose.example.yaml`](compose.example.yaml).
To check what would be sent first, start it with `DRY_RUN=true`.

A healthy start looks like this:

```
pocketorbit 0.1.0, syncing every 300s
BookOrbit: logged in as reader
logged into PocketBook Cloud (pocketbook_de)
fingerprinted "Moby Dick" (1023655 bytes)
matched "Moby Dick" in BookOrbit
sent "Moby Dick": 26%
cycle done: 1 book(s) in PocketBook Cloud, 1 progress update(s) sent
```

Images are built for amd64 and arm64. `latest` follows the main branch; releases are also tagged by version
(`1.2.3`, `1.2`, `1`). To build the image yourself: `docker build -t pocketorbit https://github.com/PaddeK/pocketorbit.git`.

## Configuration

Every variable can also be read from a file by appending `_FILE` to its name (e.g. `PB_PASSWORD_FILE=/run/secrets/pb_password`),
for Docker secrets.

| Variable | Default | Purpose |
|---|---|---|
| `PB_EMAIL` | required | PocketBook Cloud login. |
| `PB_PASSWORD` | required | PocketBook Cloud password. |
| `PB_SHOP` | first shop | Only if your account belongs to several PocketBook shops: the shop's alias (e.g. `pocketbook_de`, shown in the log) or name. |
| `BOOKORBIT_URL` | required | BookOrbit base URL, without `/api/…`. |
| `BOOKORBIT_USER` | required | Username of the KOReader credentials from BookOrbit's *Settings → KOReader*. |
| `BOOKORBIT_PASSWORD` | required | Their password. |
| `DEVICE_NAME` | `PocketBook` | How the e-reader is named in BookOrbit. |
| `DEVICE_ID` | random | Device ID reported to BookOrbit. Only read on the first start, then kept in `state.json`. |
| `SYNC_INTERVAL` | `300` | Seconds between polls (at least 30). |
| `DRY_RUN` | `false` | `true`: log what would be sent instead of sending it. Books are still matched, so unknown ones appear in BookOrbit's review list. |
| `DATA_DIR` | `/data` | Where `state.json` is kept. |

`state.json` holds the PocketBook Cloud tokens, the device ID, each book's fingerprint and the last value sent.
Deleting it is safe: books are downloaded and fingerprinted again, and unchanged progress is sent once more.

The image is a single compiled executable on [distroless](https://github.com/GoogleContainerTools/distroless)
(amd64 and arm64): no shell, so `docker exec … sh` won't work; `docker logs` is where to look.
It runs as uid `1000`. A named volume just works; for a bind mount, give the host directory to that user
(`sudo chown 1000:1000 /path/on/host`), otherwise the container exits with a hint saying exactly that.
The container reports itself unhealthy when no sync cycle has succeeded for two intervals.

## Limitations

- **Percentages only.** PocketBook Cloud reports whole percents, not an exact position. BookOrbit stores the
  percentage; other devices open the book at about that point rather than on the exact page.
- **One way.** Progress goes from the PocketBook to BookOrbit, not back.
- **The book file must be in PocketBook Cloud** (Auto-upload on the reader, or upload it on cloud.pocketbook.digital).
  It is recognised automatically when it is byte-identical to BookOrbit's file, which is the case for books
  downloaded from BookOrbit's OPDS feed. Converted or edited copies need a one-time link in BookOrbit.
- **Unofficial API.** PocketBook Cloud has no public API; pocketorbit uses the one its web app uses. If PocketBook
  changes it, syncing stops and the log shows the HTTP errors.
- Audiobooks are skipped.

## Security

- **Your PocketBook password is needed in plain text**, since PocketBook Cloud has no app tokens. It is only sent
  to `cloud.pocketbook.digital`. The resulting access and refresh tokens are stored in `state.json` (mode `0600`).
- **The BookOrbit credentials are KOReader sync credentials**, separate from your BookOrbit login. They only work
  for BookOrbit's KOReader endpoints, but those include browsing and downloading your library, read status and
  ratings besides progress. Rotate them under *Settings → KOReader* if they leak.
- The PocketBook client ID and secret in the code are the public ones shipped in PocketBook's web app.

## Development

Requires [Bun](https://bun.sh) 1.4 or newer. There are no runtime dependencies.

```sh
bun install
bun test            # unit and integration tests (fake PocketBook Cloud and BookOrbit included)
bun run typecheck
bun run build       # standalone executable in dist/, as used in the Docker image

# One cycle against the real services, sending nothing (state in ./data)
PB_EMAIL=… PB_PASSWORD=… BOOKORBIT_URL=… BOOKORBIT_USER=… BOOKORBIT_PASSWORD=… DRY_RUN=true bun run once
```

Layout: `src/sync.ts` is the sync cycle, `src/pocketbook.ts` and `src/bookorbit.ts` the API clients,
`src/fingerprint.ts` KOReader's partial MD5 computed while streaming, `src/config.ts` the environment variables,
`src/state.ts` the state file (including the migration from the first, Python version) and `src/index.ts` the
entry point with the poll loop and `--healthcheck`.

## License

[MIT](LICENSE)
