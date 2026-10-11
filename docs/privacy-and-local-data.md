# Privacy and local data

Neo Chat is local-first. Conversations, settings, and workspace data are kept
in this browser by default. A request still sends the content needed for the
selected model or service; local storage does not make inference run offline.

## Where data lives

| Location       | Data                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `localStorage` | Core settings, shortcuts, provider records, selected models, and encrypted provider-key envelopes                            |
| IndexedDB      | Conversations and message trees, app settings, plugins, Skills, assistants, knowledge metadata, memories, and Research tasks |
| OPFS           | Chat and workspace files, knowledge originals and extracted text, user and generated images, and Research report artifacts   |

Research extension data (custom templates, source contracts, steering, evidence
snapshots, and report Q&A threads) is stored in the browser sidecar
`neo-chat-research-extensions`. It is currently excluded from ZIP backups and
encrypted sync. Research tasks and referenced report artifacts are included in
ZIP backups; see [encrypted sync](encrypted-sync.md) for its narrower data
scope.

The local global-search index is built in memory for the current app lifetime.
It is not uploaded, persisted, or used for telemetry. Browser site-data
clearing can remove local conversations, settings, plugins, memories,
knowledge data, and uploaded files.

Intelligent UI definitions and state are part of the session message tree, including
private backups and existing session sync. Temporary-session interactions stay in
memory. Normal chat includes interface source and its latest reported visible
results in model context. Interface AI buttons first open host confirmation with
the exact proposed text and frozen visible result context; sending requires that
confirmation and preserves the main composer draft. Arbitrary
saved state is not dumped. HTML may load HTTPS media/fonts and allowlisted CDN
assets, so resource providers receive network requests. Public shares and document
exports exclude personal interaction values unless explicitly selected. Public
sharing previews the exact prepared content before publishing; source permissions
and versions are checked again at publication. Current HTML output labels its
snapshot as text reported by the interface, not an independently verified result.
An unavailable snapshot is identified explicitly. Research source access is read
from the exact repository version; deleting that material revokes cached access. See
[Intelligent UI](intelligent-ui.md) for snapshot and HTML sandbox boundaries.

Explorer imports are private replacements in the same session tree; default public
output still uses original content. Selected current rows and visible results are
included only after opt-in. Source bindings preserve identities and versions, but
access is rechecked against the current conversation and permissions. Tool-result
refresh enters an editable chat draft. Saving selected results to the local
workspace requires confirmation and records an operation receipt. The separate,
default-off MCP Apps display host receives visible result text only, without chat
history, tool arguments or hidden metadata; its internal state is not backed up.
MCP tools require complete versioned visibility metadata before being exposed to
the model; older definitions remain stored and require explicit refresh.

HTML state writes are coalesced in the existing session queue. A failed save
retains the latest in-memory state with an explicit retry; outputs and backups
wait for pending saves. Closing the page triggers a best-effort flush, which cannot
guarantee completion if the browser terminates abruptly. Unknown workspace-write
outcomes cannot be retried automatically or by replaying the old confirmation.
The local execution journal keeps independent attempt evidence to reject missing
or damaged histories. Older failed histories without that evidence remain
readable but cannot authorize another attempt. Completely lost older history
cannot be reconstructed. Restoring app data excludes concurrent draft writes.

## Back up or restore

Use the backup controls in **Settings → System**. A backup includes app data
and referenced app-owned files, including message branches, workspace files,
knowledge files, generated images, and Research data. Missing local file
references are recorded explicitly. If a stored message tree cannot be read,
the export fails instead of returning a partial conversation.

Backups exclude:

- provider, search, RAG, document-parsing, voice, plugin, and MCP credentials;
- browser-local encrypted secret envelopes, local master keys, and deployment
  secrets;
- external vector indexes, in-flight jobs, remote catalogs, regenerated caches,
  and runtime `blob:` URLs.

The current ZIP backup is bounded to 128 MiB compressed, 256 MiB uncompressed,
64 MiB per entry, and 32 MiB per JSON entry. The importer validates ZIP paths,
duplicates, extraction limits, sizes, and SHA-256 hashes before changing local
data. Restore replaces the local profile; it does not merge profiles. Files are
staged before the replacement, and a failed hydration or validation pass rolls
back the previous data on the next boot. Credentials must be entered again
after restore, and external RAG index references must be reconnected or
reindexed locally.

Older JSON exports can restore compatible metadata, but their referenced files
are unavailable because that format did not contain file blobs. Incompatible
legacy Research records are skipped with an explicit warning while other
compatible data is restored.

## What leaves the browser

Through the normal server proxy, a deployment can receive prompts, message
context, applied Skill instructions, tool arguments, search queries, document
parsing jobs, attachments, audio, plugin requests, and encrypted secret
envelopes. Treat application, hosting, and observability logs as sensitive.

Depending on the features you use, content may also go to model providers,
search providers, RAG/vector services, document parsers, voice providers,
plugin APIs, and remote MCP servers. Each service has its own logging and
retention policy. When memory search is used, matching memory snippets become
model context. Applied Skills likewise become model prompt context. Deep
Research may perform a small pre-approval query against its configured search
provider; that reconnaissance is recorded with the plan but is not report
evidence.

Review the privacy and retention policy of every provider or service before
sending sensitive content.

## Direct provider calls

Enable **Direct call** for a user-configured provider when the browser should
call that provider itself. The Neo Chat server then does not receive the
prompt, context, attachments, or provider key; the provider still receives
them. The server default provider always stays on the proxy because its key is
deployment-held.

Direct calls require CORS support from the provider and have no automatic proxy
fallback. Browser HTTP is limited to localhost, loopback, and literal private
LAN IP addresses; hostnames and public addresses require HTTPS. Server-side URL
checks, response limits, and logging do not apply to this path.

The keyless public Firecrawl search follows the same browser-direct boundary:
the browser sends the search query to Firecrawl, and Neo Chat's server does not
receive it. Adding a Firecrawl API key, selecting a custom/self-hosted Firecrawl
URL, or using a deployment-configured default search routes the request through
Neo Chat's API so the credential is not exposed to the browser.

## Provider keys (BYOK)

For proxied requests, user-entered provider, search, RAG, parsing, voice,
plugin, and sync credentials are encrypted in the browser before they are sent
to an API route. Production deployments should keep one stable BYOK private key
and key ID across restarts and replicas:

```dotenv
BYOK_ALLOW_EPHEMERAL_KEY=false
BYOK_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
BYOK_KEY_ID=replace-with-a-stable-key-id
```

Changing the private key invalidates cached server envelopes. On the next
proxied request, the browser refreshes the public key and re-encrypts its locally
saved credential once. See the [environment variable reference](environment-variables.md)
and [deployment guide](deployment-hardening.md) for configuration details.
Direct calls use the browser-held provider key and do not use this proxy
envelope.

## Hosted deployments

`DEPLOYMENT_MODE=hosted` selects deployment safeguards. A single process can
fall back to temporary request-proof/BYOK keys and in-memory API rate limits,
but those values reset on restart and are not consistent across replicas.
Document jobs, plugin registration, and sharing retain their shared-store
requirements. The deployment password is still only an access gate. A public
multi-user service also needs authentication, tenant isolation, server-side
secret management, quotas, audit logs, abuse controls, and provider spend
limits. See the [deployment guide](deployment-hardening.md).

## For contributors

- Never commit real credentials, private conversations, uploads, or production
  logs.
- Use synthetic fixtures and redact keys, passwords, BYOK material, and private
  paths from issues and screenshots.
- Update this document when storage, backup, proxy, BYOK, or third-party data
  flow changes.
