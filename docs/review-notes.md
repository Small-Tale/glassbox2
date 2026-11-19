# AI-authored review notes

Glassbox reads Glassbox v1 SARIF 2.1.0 shards at
`.pr-notes/notes/<source>.NNNNNN.sarif` for the requested repository-relative
source path. It reads numbered shards in order and ignores corrupt SARIF
documents. Stable result GUIDs identify the discussions to clients.

The model retains note category and Markdown, baseline revision and producer,
line range and snippet, rank, confidence, ticket links, related locations,
and artifact references. Artifact bytes are loaded separately by the
presentation layer. Inputs are restricted to repository-relative paths.

Notes target the new side of a text diff. If the first snippet line no longer
matches at the authored line, Glassbox checks visible new-side lines within
50 lines. A unique nearest match moves the anchor. A visible line with no
unambiguous match is stale. Unseen lines are reported outside the diff.
Stored note identities and authored line ranges stay intact when their
presentation anchor moves.
