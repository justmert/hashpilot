# HashPilot Maintenance Plan

Audit dates: 2026-09-08 (initial), 2026-09-09 (feature verification).
Last prior commit: 23f7478, ~November 2025.

This file is the record of what was found, what was fixed, and how to check it.
Everything below was verified by running it, not inferred from the code.

## How to verify the build

```bash
npm install
npm run build && npm run typecheck   # clean
npm test                             # 320 unit tests, no network, no credentials
npm run smoke                        # 10 read-only checks against HEDERA_NETWORK
npm run check:sources                # 69 RAG documentation sources reachable
npm run check:sourcify               # live Sourcify verification lookup
npm run build && npm run test:mcp    # drives the built server over stdio as a real MCP client
npm run test:rag-e2e                 # full docs pipeline (needs CHROMA_ADMIN_TOKEN)
```

Last full run, 2026-09-24: build and typecheck clean, 320/320 tests, 19/19 MCP
protocol checks, 10/10 smoke,
69/69 sources, Sourcify verified against a real testnet contract, RAG end-to-end
green. The hosted index holds 10,932 chunks, 5,749 of which carry code. Add `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` to the smoke run and
it adds three operator checks (13 total) that prove the key parses and matches
the account, without spending anything.

`npm run test:rag-e2e` indexes a slice of the Hedera docs into a scratch
collection, queries it through the MCP server, and deletes it. It uses a mock
OpenAI server (`scripts/mock-openai.ts`) so it costs nothing; set
`REAL_OPENAI=1` with an `OPENAI_API_KEY` to run the same flow against OpenAI.

## Hosted RAG backend (Railway)

Railway project `hashpilot`, production environment:

| Service          | Source                                                 | Exposure                                           |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `chromadb`       | image `chromadb/chroma:1.5.9`, 50 GB volume at `/data` | private (`chromadb.railway.internal:8000`)         |
| `chroma-gateway` | `docker/railway/gateway` (Caddy)                       | `https://chroma-gateway-production.up.railway.app` |

ChromaDB 1.x has no built-in authentication, so the gateway enforces it:

- `CHROMA_READ_TOKEN` — shipped as the package default. Allows `GET` plus `POST`
  to `query`, `get` and `count`. Everything else returns 403.
- `CHROMA_ADMIN_TOKEN` — indexing only, never published. Stored as a Railway
  variable on `chroma-gateway`; read it from the Railway dashboard.
- `/api/v2/heartbeat` and `/api/v2/version` are public, which is what
  `health_check verbose` probes.

Verified on 2026-09-09: heartbeat public, unauthenticated request 401, read
token can query but cannot create or delete a collection, admin token can.

### Populating the index

The production collection `hedera-docs-all` must be built with **real OpenAI
embeddings**, because users bring their own `OPENAI_API_KEY` and their query
vectors must come from the same model (`text-embedding-3-small`, 512 dims).

```bash
export CHROMA_URL=https://chroma-gateway-production.up.railway.app
export CHROMA_AUTH_TOKEN=<admin token from Railway>
export OPENAI_API_KEY=sk-...
export GITHUB_TOKEN=$(gh auth token)      # lifts the GitHub rate limit
npm run index-all                          # docs, SDKs, HIPs, specs, network config, tutorials
```

Roughly 30 to 60 minutes and a few cents of embeddings. Re-running is
idempotent (chunks upsert by a deterministic id). `npm run index-docs-repo`
alone refreshes just docs.hedera.com in about a minute.

After every indexer succeeds, `index-all` deletes chunks the run did not write
— pages deleted or renamed upstream, and the trailing chunks of pages that got
shorter. `--dry-run-prune` reports them without deleting; `--no-prune` skips the
step. Pruning is refused, and nothing is deleted, if any indexer failed or if
more than 15% of the collection would go, since that pattern means a source came
back empty rather than normal churn. `index-all` exits non-zero in either case.

### Weekly re-index (GitHub Actions)

`.github/workflows/reindex.yml` runs `index-all` every Sunday at 03:00 UTC and
can be started by hand from the Actions tab, with a choice of prune, dry run or
keep. It needs two repository secrets:

| Secret               | Value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | Any OpenAI key; embeddings use `text-embedding-3-small` at 512 dimensions, the model the index was built with |
| `CHROMA_ADMIN_TOKEN` | The gateway's admin token (Railway variable on `chroma-gateway`)                                              |

The optional repository variable `CHROMA_URL` points it at a different index.
Each run costs about ten cents of embeddings, uploads the run report as an
artifact kept for 90 days, and fails loudly if a source fails. GitHub disables
scheduled workflows in a public repository after 60 days without a commit, so a
long quiet spell needs the workflow re-enabled from the Actions tab.

## What changed on 2026-09-08 (Phase 0, shipped as 0.2.1)

- [x] Operator key: detect DER vs raw hex, default raw hex to ECDSA, honour `HEDERA_OPERATOR_KEY_TYPE`, verify the derived public key against the Mirror Node on startup and refuse to run on a mismatch
- [x] `account_create` with a supplied `publicKey` no longer parses an empty string
- [x] `account_balance` and `account_info` served from the Mirror Node: free, no operator needed, and unaffected by the removal of `AccountBalanceQuery` in consensus node v0.77 (testnet 2026-09-09, mainnet 2026-10-06)
- [x] Stablecoin: `PauseRequest` / `FreezeAccountRequest` for unpause and unfreeze; the fabricated mainnet addresses are gone and mainnet/previewnet now require explicit `STABLECOIN_FACTORY_ADDRESS` / `STABLECOIN_RESOLVER_ADDRESS`
- [x] Foundry scaffold runs `git init` and `forge install forge-std`; no unknown `foundry.toml` keys; Sourcify verification instructions
- [x] `JSON_RPC_RELAY_URL` and `MIRROR_NODE_URL` honoured; Mirror Node tools follow `network_switch`; local chain ID unified at 298
- [x] Data files under `~/.hedera-mcp` (`HASHPILOT_DATA_DIR`), migrated once from the in-package location
- [x] `npm run smoke`, key-parsing unit tests, Prettier across the tree, lockfile tracked, Node 20 floor, unused GraphQL packages removed

## What changed on 2026-09-09 (feature verification)

**RAG brought back.** The old host `chroma.hash-pilot.app` was
unreachable. Replaced with the Railway deployment above. The Chroma client now
sends `X-Chroma-Token`, opens collections read-only on the query path, and
upserts instead of adding so re-indexing is idempotent. A new git-based
indexer (`npm run index-docs-repo`) indexes docs.hedera.com from its source
repository, which covers every page without a crawler; it is wired into
`index-all`, which previously did not index the documentation at all.

**Indexer sources retargeted.** The SDK repositories moved from `hashgraph` to
`hiero-ledger`, the HIP repository was renamed, and several doc files moved.
All 59 sources now verify with `npm run check:sources`.

**Hardhat integration rebuilt.** The server no longer loads Hardhat
in-process; it shells out to the project's own Hardhat and does contract
interaction through the JSON-RPC relay. Hardhat and its plugins were removed
from the server's dependencies (340 packages, `node_modules` 1.0 GB to 689 MB).
Verified against a scaffolded Hardhat 3 project: compile, test with real pass
and fail counts, artifacts by name and in bulk, task list, account derivation,
and a real network error (not a crash) from call and deploy.

**Contract verification rewritten.** HashScan's verification
server now redirects to Sourcify, whose v1 API shut down on 2026-07-07. The
service targets the Sourcify v2 API; previewnet is not supported by Sourcify
and is rejected with a clear message.

**Feature completeness.** `account_create` takes
a `keyType` (ECDSA or ED25519), automatic token associations and staking.
`token_manage create` implements custom fees (fixed, fractional, royalty),
finite supply with a maximum, an explicit treasury, NFT collections, and keys
that accept a public key or a threshold key list rather than only a boolean,
which is what multi-signature keys require. It also accepts a
JSON configuration file or an inline object. `hcs_topic` takes real admin and
submit keys, and `hcs_message query` filters by sequence number with
comparison operators and by timestamp range.

**Schema parity (all tools).** About twenty parameters existed in code but
were absent from the MCP `inputSchema`, so no AI client could ever send them:
custom fees, gas limits, network overrides, address book aliases, block
numbers, Hardhat Ignition parameters, verification build-info paths.
`tests/unit/schema-parity.test.ts` now reads the source, collects every
`args.<name>` each tool reads, and fails if one is not advertised. Two
parameters that the schema advertised but the code ignored are now
implemented (`includeTransactions`, `transactionLimit` on the mirror query).

**A bad operator key no longer breaks free reads.** The startup key check is
still loud, but it now records the failure instead of aborting the client, so
balances, account info and topic queries keep working while anything that
signs fails with the explanatory message.

**Indexed sources expanded (2026-09-16).** A survey of the `hiero-ledger` and
`hashgraph` GitHub organisations found canonical sources the index was missing.
Two of them are Hedera's service specifications and are now indexed by the
new `npm run index-specs`:

- `hashgraph/hedera-protobufs`, the authoritative protobuf service definitions
  (161 files). This is what answers "which fields does `TokenCreateTransactionBody`
  actually take" for HTS, HCS, the Smart Contract Service, the File Service and
  the Schedule Service. Each `.proto` is wrapped in a fenced block so it is
  stored as code and kept intact by the chunker.
- `hiero-ledger/hiero-consensus-specifications`, the canonical HCS application
  standards HCS-1 through HCS-20+ (104 documents).

Eight further ecosystem repositories were added to `index-tutorials`: Solo and
solo-docs (which replace the deprecated local node), `hiero-cli`, the Mirror
Node docs, Stablecoin Studio's documentation (HashPilot ships a stablecoin
tool built on it), the official Hedera Agent Kit, Wallet Connect and the NFT
SDK. Their paths were set from the real repository layouts rather than guessed;
`npm run check:sources` now verifies 69 sources instead of 59.

**SDK code examples were invisible to the code-example tools (found
2026-09-16).** The chunker infers `hasCode` from ``` fences, so a raw
`.go`/`.java`/`.py`/`.rs` example file from an SDK repository was stored with
`hasCode: false`: 2,256 of 2,393 SDK chunks. `docs_get_example` and
`docs_search` with `hasCode: true` filter on exactly that field, so the SDK
examples could not be retrieved by the tools meant to retrieve them. `scripts/index-sdk.ts` now marks chunks from source files as
code and stamps the SDK's language. Rust was also being dropped entirely by
`mapSDKToCodeLanguage`, which returned `undefined` with a stale comment saying
Rust was not in the type system; it has been in `ProgrammingLanguage` all along.

**Unpaired surrogates no longer abort an index run (found 2026-09-16).** An SDK
example file on GitHub contained a truncated multi-byte character, leaving a
lone UTF-16 surrogate in one chunk. JavaScript tolerates it, but
`JSON.stringify` emits `\ud83d`, which is not valid UTF-8, so ChromaDB rejected
the entire 100-chunk batch and the whole SDK index failed. `stripLoneSurrogates`
in `src/utils/text.ts` now scrubs chunk text in the chunker and every string
sent to Chroma, keeping valid surrogate pairs (real emoji) intact. Covered by
`tests/unit/text.test.ts`.

**`docs_get_example` returned nothing at all (found 2026-09-16).** Marking SDK
source chunks as code made them retrievable, but the tool still answered "No
code examples found" for every language. Three defects were stacked behind it:

1. _Extraction only understood markdown._ `extractCodeFromText` pulled code out
   of ```-fenced blocks, so a chunk that **is** a `.go`/`.java`/`.py`/`.rs` file
   — every SDK example — produced nothing. Extraction now falls back to treating
   the chunk as the example when the source URL is itself a source file. It is
   deliberately keyed on the URL extension and not on the chunk's `language`
   metadata, because a multi-language tutorial page carries that too and would
   otherwise have its prose returned as "code".
2. _The language filter was never applied._ `buildWhereClause` had it commented
   out as a "ChromaDB compatibility issue". The real cause is that the v2 API
   rejects a `where` object with more than one key, so `{ hasCode: true,
language: 'go' }` failed; conditions are now combined with `$and`. Asking for
   Go examples had been answering with Rust. `tags` and `urlPattern` were
   likewise declared but silently ignored — neither maps onto a Chroma metadata
   operator, so they are applied to the returned rows instead.
3. _Fences were paired blindly._ The regex matched from any `` to the next one,
so a chunk beginning with a stray closing fence returned the prose after it
as code, and `​``java Java` (the info-string form docs.hedera.com uses for
   its language tabs) was not recognised as an opener at all. Fences are now
   parsed line by line, handling info-string labels, four-backtick nesting, and
   chunks sliced mid-block.

All eight languages now return correctly labelled code. Covered by
`tests/unit/code-examples.test.ts` and `tests/unit/search-filters.test.ts`.

**Chunk overlap cut mid-word (found 2026-09-16).** The overlap carried between
consecutive chunks was a character slice sized by a token ratio, so chunks began
with fragments like `onst txResponse = await ...` and could carry a closing ```
without its opener. `getOverlapText` now takes whole trailing lines and re-opens
a fenced block when the overlap starts inside one. Covered by
`tests/unit/chunk-overlap.test.ts`. Existing chunks keep the old overlap until
the next `npm run index-all`; the extraction fix above already tolerates them.

**Other fixes.** Replace-mode state restore wrote to a stale path and reloads
merged instead of replaced, so restore silently did nothing; both fixed and
covered by tests. Backups honour a custom `filename` and stamp the real package
version. `hardhat_contract` accepts `functionName`/`args` as aliases of
`method`/`methodArgs`, so a client cannot pick the wrong name. Proactive
security and optimisation advisories were implemented but never
called; they now attach to deploy and execute results. VS Code setup replaced
with the real `.vscode/mcp.json` format; Gemini CLI documented.

## What changed on 2026-09-16 (MCP protocol integration testing)

Everything up to this point was tested by calling tool functions directly. That
missed a whole class of defect, because a real client reaches the server through
the protocol layer: it sends arbitrary JSON, it disconnects, and it restarts.
`npm run test:mcp` now drives the built server over stdio exactly as a client
does, and `scripts/test-mcp-protocol.ts` keeps each finding below covered.

**An invalid `network_switch` bricked the install permanently.** `switchNetwork`
closed the client, set the network and wrote it to `~/.hedera-mcp/state.json`
_before_ anything validated the name — the check only happened later, inside
`initialize()`. One call with a typo left every subsequent tool answering
`Unknown network: <junk>`, and because the bad value was persisted, it survived
restarts: the server stayed broken until the state file was deleted by hand. The
parameter's TypeScript union type is a compile-time fiction, since the value
arrives as JSON from a client. `isSupportedNetwork` in `src/types/index.ts` now
guards all four entry points: the tool boundary, `switchNetwork` (before it
mutates anything), `saveNetworkState`, and the backup restore path, which cast
straight from an arbitrary JSON file on disk. Loading an unsupported network
from state now logs a warning and keeps the current network instead of failing,
so an install broken by an older build recovers by itself.

**Tool arguments were never validated against the schemas the server
advertises.** The low-level MCP `Server` does not validate `tools/call`
arguments, and the dispatcher cast them straight through (`args as ...`), so a
missing required parameter surfaced as whatever internal failure came first:
`docs_search` with no `query` answered `Cannot read properties of undefined
(reading 'length')`. The schemas already declare `required`, types and enums;
`validateToolArguments` in `src/utils/validate-args.ts` now enforces them for
all 30 tools in one place, and answers with the missing parameter, the expected
type, or the list of valid enum values. Covered by
`tests/unit/validate-args.test.ts`.

**Every session leaked a server process.** The server never exited when its
client disconnected: the Hedera SDK's gRPC connections keep the Node event loop
alive, and there was no signal handling, no transport close hook and no
end-of-input handling at all. `StdioServerTransport` only subscribes to stdin's
`data` and `error` events, so its `onclose` never fires on a client hang-up
either. `main()` now watches stdin for end-of-input, handles SIGINT and SIGTERM,
and closes the Hedera client before exiting.

## What changed on 2026-09-16 (answer quality)

Driving the documentation tools with real questions and checking the answers
against the actual SDK — rather than checking that a call returned something —
found that the retrieval layer's _source-finding_ was sound while its scoring
and the generation layer's _fidelity_ were not.

**Relevance scores could be negative.** `score = 1 - distance` was unclamped,
but cosine distance runs 0..2, so a chunk pointing away from the query scored
below zero. Callers render this as a percentage: results were being shown at
-5%, -9%, -11%. Now clamped to 0..1.

**The same source was listed several times.** `askQuestion` and
`askQuestionWithIntent` mapped every retrieved chunk to a source entry, and
several chunks of one page routinely match one question, so a five-slot source
list could show the same URL three times. A new `dedupeSources` keeps the
best-scoring chunk per URL; `code_generate` dedupes its context the same way.
`findCodeExamples` had always deduplicated — the Q&A paths simply never did.

**A blank template ranked above the real specification.** The HCS standards
repository contains `docs/standards/hcs-XX.md`, the placeholder new standards
are copied from ("HCS-XX — <short title>"). `index-specs.ts` had an `exclude`
for the protobuf source but none for this one, so the template was indexed and
came back as the top source when asked what HCS-10 defines, outranking the real
spec and visibly degrading the answer into guesswork. Excluded, and the chunk
was deleted from the live collection.

**`code_generate` was fed examples in the wrong language.** Retrieval filtered
on `hasCode` but not on the requested language, so a request for Go code was
answered from JavaScript examples — inviting the model to produce Go by
translating an API it had just been shown. It now filters by target language and
widens only if that finds nothing.

**The generation prompt did not forbid inventing APIs.** Answers used
`ResponseCode` (the real export is `Status`), `FractionalFee({...})` (the real
class is `CustomFractionalFee`, built with setters), an `Agent` class the Agent
Kit does not have, and a Python package name inside an `npm install`. Asked for
HBAR's price "next month", it read the mirror node's hourly fee-conversion rate
as a market forecast and answered with a confident, self-contradictory figure.
The system prompt in `src/config/rag.ts` now requires every identifier to appear
verbatim in the retrieved context, forbids mixing ecosystems, and refuses
live-or-future value questions, noting that the exchange-rate endpoints publish
the protocol's fee-conversion rate rather than a market price. The same rules
were added to `code_generate`'s own prompt. Re-checked afterwards: the price
question now declines, and the NFT example no longer emits `ResponseCode`.

Re-tested afterwards, the prompt rules did make answers hedge honestly, and
stopped the fabricated `ResponseCode` — but the model still invented specific
names even with the correct ones in its own retrieved context: a Go import of
`github.com/hashgraph/hierarchical-sdk-go/v2` (no such module) and
`FractionalFee.setNetOfTransfers()` (the class is `CustomFractionalFee`; that
setter does not exist). Prompting alone does not close this.

**So `code_generate` now checks its own output.** `verifyGeneratedCode` in
`src/utils/verify-generated-code.ts` extracts the import paths and SDK-looking
identifiers from the generated code and reports any that do not appear in the
documentation that was retrieved to write it. Language builtins and standard
library modules are excluded so the warning stays meaningful. The result is
attached to the response as `unverified` and shown above the sources as a
warning. It caught a live fabrication on the first run — two invented
`hiero-sdk-go` subpackages — which is exactly the signal a caller previously
had no way to get. Absence from the context is not proof a name is wrong, and
the warning says so. Covered by `tests/unit/verify-generated-code.test.ts`.

This is mitigation, not a guarantee — a language model given documentation can
still get an API wrong. The tools are useful for finding and citing the right
source; generated code should be compiled before it is trusted.

**Exchange rates were indexed as if they were documentation.** The network
config indexer baked a live snapshot into a document headed "Current Exchange
Rate" and "Next Exchange Rate", tagged `pricing` and `usd`, so a question about
HBAR's price retrieved it and was answered with those figures as market data.
The dates were mislabelled too: `expiration_time` is when a rate _expires_, not
when it starts, which is why the "next" rate appeared to predate the current
one. The document now explains what the rate is — a council-set fee-conversion
rate, not a market price, where "next" means the next fee period rather than a
forecast — and records no values at all, pointing at the live endpoint instead.
Re-indexed; the stale snapshots are gone from the collection.

**Code example explanations were being taken from code.** The `explanation`
field took the three lines above a block, which yielded fence markers, Rust
attribute macros, and Java source describing a Go example on a multi-language
page. Explanations are now built only from lines that read as prose, and a
source file is described from its leading comment block alone rather than every
comment in the chunk concatenated. Where no prose is available the field is left
empty — an empty explanation is better than a misleading one.

## What changed on 2026-09-16 (failure modes under a real client)

**A missing operator produced an SDK riddle instead of an explanation.** Every
write tool guards with `if (!hederaClient.isReady()) await initialize()`, which
is a lazy re-init, not a rejection — and `initialize()` does not throw when no
credentials are configured, it only logs a warning. So `transfer_hbar`,
`account_create` and `hcs_topic create` all failed with the SDK's own
"`transactionId` must be set or `client` must be provided with `freezeWith`",
which never mentions credentials. All nineteen signing paths reach the SDK
through `getClient()`, so the explanation belongs there: it now names the two
environment variables to set and says that read-only tools still work without
them. Verified by running all four write tools with no operator configured.

**Mirror Node requests had no retry.** `account_info` failed with a bare "This
operation was aborted" and succeeded on an immediate retry: the public mirror
nodes return 5xx and time out under load, `mirrorGet` made exactly one attempt,
and the raw `AbortError` message reached the caller. It now retries transient
failures (5xx, timeouts, connection errors) three times with exponential
backoff, never retries a 4xx, and reports an exhausted timeout as a timeout.
Covered by `tests/unit/mirror-retry.test.ts`.

## Dev tooling verification (2026-09-16)

Foundry, Sourcify and Hardhat were exercised through a real MCP client against
real projects on disk.

**Verified working.** Foundry scaffold, `forge build` (10 artifacts) and
`forge test` (5/5) all run for real, and the generated `foundry.toml` carries
the right chain IDs and Sourcify settings. `verify_contract` does a live
Sourcify v2 round trip that matches a direct API query. Hardhat compiles (1
artifact), tests (3/3) and returns artifacts with full ABIs — and the
shell-out architecture is confirmed from the outside: the server ships no
Hardhat dependency at all, and the work happens in the _project's_ own Hardhat
3.16.0. `stablecoin_manage` gives the best error message in the codebase when
the mainnet factory addresses are unset: it names both variables and links the
version document.

**A stale compiler cache breaks Hardhat on this machine.**
`~/Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/` holds x86 solc
binaries from November 2025, but the machine is arm64 with no Rosetta, so
Hardhat prefers the cached native binary and dies with `spawn Unknown system
error -86` (EBADARCH). This is not a HashPilot defect: re-running the same
compile with an isolated `HOME` downloaded a working compiler, fell back to the
WASM build by itself and compiled cleanly. Deleting that one `macosx-amd64`
directory fixes it; the WASM build beside it already works.

**Error-message consistency.** The two "Treasury account ID required" messages
disagreed — one said "Configure an operator account", the other "Configure
HEDERA_OPERATOR_ID", which would send a user to set only half of what is
needed. Both now name `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`. Separately,
Sourcify's previewnet explanation is no longer reachable through the tool
surface, because the schema restricts `network` to the two networks Sourcify
supports and argument validation now rejects the rest before the handler runs.
Keeping the enum honest is the right trade — an AI client reads the schema and
will not attempt previewnet at all — so the remedy that message carried (deploy
to testnet 296 or mainnet 295) was moved into the parameter description.

## Pre-commit checks (2026-09-24)

A final inventory of the live index and a round of real questions through the
MCP server found three more problems.

**The 327 Solidity contracts were invisible to the code tools.** The same bug
as the SDK examples, in a different indexer: `index-tutorials.ts` pulls `.sol`
files from `hedera-smart-contracts`, and a raw source file has no markdown
fences, so every chunk was stored as `hasCode: false` with no language. Search
found them; `docs_get_example` and `code_generate` asked for Solidity never did.
`sourceLanguageFromPath` in `src/utils/source-language.ts` now marks any source
file an indexer handles as code in its language. The live chunks already had
correct embeddings, so only their metadata was corrected in place — no
re-embedding. A Solidity HTS-precompile question now returns examples from the
official contracts repository.

**A question naming a HIP or HCS standard could miss that document.**
Embeddings are weak at exact identifiers: asked what HIP-904 changes, retrieval
returned HIP-655, HIP-719 and release notes, never HIP-904 itself, although it
is indexed. A HIP never names itself in its body either — the only literal
marker is the `hip: 904` frontmatter line — so text matching alone cannot find
it. `RAGService.search` now detects HIP and HCS identifiers in the query, finds
the document that defines each one, adds that document's chunks closest to the
question, and ranks them first, followed by up to two other documents that name
it. HIP-904, HIP-1, HCS-1 and HCS-10 questions now cite their own specification
first. Covered by `tests/unit/spec-identifiers.test.ts`.

**`code_generate` warned about ordinary English words.** The unverified-name
check scanned comments, so "// Create a client" and "// Define the amount"
reported `Create` and `Define` as unverified identifiers, burying any real
finding. Comments and string literals are now stripped before identifiers are
extracted; a fabricated class used in code is still flagged.

## Lessons from Hedera's official MCP servers (2026-09-24)

Hedera now ships a documentation MCP (`docs.hedera.com/mcp`), a hosted
testnet Network MCP built on the Agent Kit, the Agent Kit's own MCP package, and
Claude Code skills. Comparing them with HashPilot led to two changes.

**31 Mirror Node queries existed but could not be called.** `src/tools/mirror-node.ts`
has 32 query functions with schemas — token info, transaction lookup, NFTs and
their history, topics, contract state, results, logs and opcode traces,
schedules, blocks, nodes, staking, the live exchange rate — but only
`mirror_query_account` was ever registered, so the rest were unreachable from
any client. Several of the Agent Kit capabilities HashPilot appeared to lack
were sitting there. They are now resources of one `mirror_query` tool, which
keeps each wrapped definition's parameters and required fields and is covered
by `tests/unit/mirror-query.test.ts`.

Because none of this code had ever run, every resource was exercised live on
testnet and nine returned values were checked against the Mirror Node directly.
That found four real problems:

- **Account lookups timed out on busy accounts.** The accounts endpoint embeds
  the latest transactions unless told not to; for 0.0.800 the Mirror Node
  itself returned 502 after 30 seconds. `transactions=false` answers in 0.4s,
  and callers that want transactions already fetch them separately.
- **Log search by topic could never succeed.** The Mirror Node refuses a topic
  search without a bounded range (both bounds, under seven days). It now
  defaults to the last 24 hours and accepts `gte:<s>,lte:<s>`.
- **The Mirror Node service had no timeout and no retry**, so one upstream
  hiccup cost 30 seconds and a failure; the same query succeeded moments later.
  It now times out at 15 seconds and retries transient failures, never a 4xx.
- **Opcode traces were unbounded.** The endpoint includes the EVM stack at every
  step by default: 97KB for a simple transaction, megabytes for a complex one.
  Stack is now omitted and the trace capped at 500 steps, with the total shown.

**The documentation tools failed outright without an OpenAI key.** HashPilot's
index needs the key to embed each query, so every user who had not supplied one
got an error from all four tools. They now fall back to the official
`search_hedera` tool at `docs.hedera.com/mcp` — free and keyless — when no key
is set, and also when the key is rejected, out of quota, or the ChromaDB index
is unreachable. `docs_ask` then returns the relevant documentation rather than a
written answer, and `code_generate` the documentation to write code from; every
fallback response says where it came from, why, and what the full index adds.
Verified live in all three situations. Covered by
`tests/unit/docs-fallback.test.ts`, and `npm run test:mcp` now checks both paths.

**Not done, and worth doing next.** Write operations the Agent Kit has and
HashPilot does not: allowances (approve, delete and spend for HBAR, tokens and
NFTs), HIP-904 airdrops, scheduled transactions, token update and dissociate,
account update and delete, topic delete. A non-custodial mode that returns
unsigned transaction bytes for wallet approval, as the hosted Network MCP does.
MCP resources and prompts (HashPilot returns empty lists; the docs MCP ships a
skill resource). And retrieval re-ranking: asked how to transfer HBAR, the index
found the right sources but ranked a JSON-RPC relay document first, so the
written answer was framed around the relay.

## GraphQL (2026-09-24)

0.1.0 shipped no GraphQL support: the `graphql` packages were dependencies but
nothing imported them, and the only trace in the code was an unused
`GRAPHQL_ENDPOINT` setting. Hedera's public Mirror Nodes offer REST only; the
same Mirror Node data is available over GraphQL from Hgraph, with a free tier.

The new `graphql` tool is built on Hgraph's Hasura schema, in which every entity
takes `where`, `order_by`, `limit`, `offset` and `distinct_on`:

- `schema` lists the queryable entities or describes one;
- `generate` builds a query for an entity from the schema, passing filters as
  variables typed from the schema, and validates it before returning it;
- `validate` checks a hand-written query and reports problems by line and column;
- `execute` runs a read-only query. Mutations and subscriptions are refused
  before anything is sent.

The schema is cached per network in the data directory for a day, and a stale
copy is used if a refresh fails. Results too large for one response are trimmed
row by row, with a note saying how many rows were dropped. It needs
`HGRAPH_API_KEY`; without it, and for previewnet and local, the tool explains
what to set rather than failing opaquely.

Verified by generating queries for six real entities (`transaction`, `token`,
`nft`, `entity`, `topic_message`, `contract_log`) and validating them against
Hgraph's actual testnet schema, then live with a real key: the same records were
read through GraphQL and through the Mirror Node REST API and matched exactly —
token name, symbol and supply, a transaction's payer and fee, an NFT's owner, a
topic's latest sequence number — on testnet, plus a mainnet query. Covered by
`tests/unit/graphql.test.ts`, and `npm run test:mcp` runs a live query when
`HGRAPH_API_KEY` is set.

Live testing found two problems, both fixed:

- **Large integers were silently corrupted.** Hgraph returns nanosecond
  timestamps and large IDs as bare JSON numbers; `JSON.parse` rounds anything
  beyond 2^53, so `1790254349306634009` came back as `1790254349306634000`, a
  different transaction. Responses are now parsed so that such integers arrive
  as exact decimal strings; a 19-digit timestamp matched REST to the digit.
- **Bursts hit the free plan's rate limit.** Hgraph's free plan allows one
  request per second, and an MCP client often issues several calls at once: four
  of six parallel requests were refused. Requests are now sent one at a time and
  a rate-limited one is retried after a short wait; the same burst succeeds six
  of six.

## Remaining before go-live

1. ~~**Populate the production index**~~ — done 2026-09-16. 10,932 chunks are
   live in `hedera-docs-all` on the Railway backend and all four documentation
   tools answer from it. Re-running `npm run index-all` is safe and idempotent
   (chunks upsert by a deterministic id); the next run also picks up the chunk
   overlap fix.
2. **Commit, tag and publish.** npm still serves 0.1.0 from November 2025,
   which contains the operator-key signature bug. package.json is at 0.2.1.
3. **Redeploy the docs site.** hash-pilot.app still serves the pre-maintenance
   build.
4. **Decide the `local` network story.** Hiero Local Node is deprecated in
   favour of Solo; the profile still targets the old ports.

## Phase 2: dependency modernisation

- [ ] `@hashgraph/sdk` -> `@hiero-ledger/sdk` 2.87 (rename; the removed APIs are unused here)
- [ ] MCP SDK v2 via `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`; zod input schemas; `readOnlyHint` / `destructiveHint` annotations
- [ ] `chromadb` 3.x client (`host`/`port`/`ssl`/`headers` constructor, Node 20+)
- [ ] `openai` 7 (Node 22). Never change the embedding model without a full re-index
- [ ] ESLint 10 flat config, typescript-eslint 8, zod 4
- [ ] Refresh the bundled Mirror Node OpenAPI (0.142 vs live 0.162) and relay OpenRPC (57 vs 66 methods); note the 60-day implicit window in history tools

## Phase 3: keep it maintained

- [ ] CI on every PR: install, build, typecheck, lint, `npm test`, `npm run smoke`, `npm run check:sources`, `npm audit --audit-level=high`
- [ ] Weekly canary: `npm run check:sources` plus probes of the Mirror Nodes, Hashio, Sourcify and the Chroma gateway; open an issue on a status change
- [ ] Renovate or Dependabot: Hiero packages weekly, everything else monthly, majors held for review
- [ ] Quarterly: re-index, refresh the bundled specs, read the consensus node, Mirror Node and relay release notes, re-verify the Stablecoin factory addresses, watch the status page maintenance feed
- [ ] Lint baseline: the remaining errors are `no-unsafe-argument` / `no-unsafe-return` from the `args as any` tool dispatch; they disappear when tool inputs are validated with zod

## Known gaps

- `npm audit --omit=dev` reports 23 high or critical advisories (2026-09-25).
  None is in HashPilot's code: they come from `@hashgraph/sdk`, the Stablecoin
  Studio SDK, ethers 5 and axios. `npm audit fix` resolves 13 without breaking
  changes; the rest need the Phase 2 upgrades (Hiero SDK, a newer Stablecoin
  Studio SDK). The CI audit job reports them without failing the build until
  then.

- The Hedera CLI wrapper (`src/services/hedera-cli.ts`) probes for binaries named `hedera` and `hiero`. The published CLIs install as `hedera-cli` and `hcli`, so the probe never succeeds and every call takes the SDK path. Either integrate the real CLI or remove the wrapper and describe the feature as SDK-based.
- Write paths (token create, transfers, topic submit, contract deploy) are implemented and type-checked but have never been executed against a funded account. An operator-funded integration run is the only way to close that.
- File Service has no dedicated tool; coverage comes from the indexed documentation only.

## Compatibility line (target after Phase 2)

Node >= 22 · Hiero SDK 2.87 · Chroma server 1.5 · MCP spec 2026-07-28 · Hardhat 3
