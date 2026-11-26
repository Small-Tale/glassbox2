# Feedback JSON export

Every feedback bundle includes `feedback.json` beside `review.md` (`HS2-A07MHD`). It is the
machine-readable form of the same review, for tools that would otherwise parse the Markdown. This
page is its public contract. The editable snapshot that Glassbox reopens is a different, private
format; reading or writing it is unsupported.

Glassbox rewrites `feedback.json` each time it publishes the review, immediately before it commits
`review.md`, so the two always describe the same threads. A bundle with no feedback still has the file,
with an empty `threads` list. Bundles written before this feature do not have it.

## Versioning

`schema_version` is `1`. Adding a field, or a new value to a documented set, keeps the version, so a
consumer should ignore fields it does not know and treat an unknown `kind` as unsupported rather than
failing the whole file. Removing a field or changing what it means bumps the version, and this page
then documents each version. A consumer should refuse a `schema_version` it does not know.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | integer | Always `1` for this page. |
| `context.project` | string, optional | Absolute path of the project, when the comparison has one. |
| `context.comparison` | string | A label such as `Working tree`. |
| `context.before`, `context.after` | string, optional | The compared revisions or paths, when known. |
| `threads` | array | Threads in the order they were created. |

Each thread:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | integer | Unique within the review. IDs are shared by threads, replies and attachments, so they are not consecutive; treat them as opaque. |
| `file` | string | Source-relative path with `/` separators. |
| `side` | `before` or `after` | Which side of the comparison the thread is on. |
| `revision` | string | The file revision the anchor was made against. Opaque; equal values mean the same content. |
| `target` | object | `{"kind":"line","start":N,"end":M}` (one-based, inclusive) or `{"kind":"image_region","left","top","width","height"}` (fractions from 0 to 1 of the untransformed image). |
| `line_text` | string, optional | The anchored line's text when Glassbox recorded it. Absent for ranges, image regions, AI notes and comments from before it was recorded. |
| `origin` | object | `{"kind":"reviewer","category":C}` where `C` is `bug`, `fix`, `style`, `pattern-follow`, `pattern-avoid`, `note` or `remember`; or `{"kind":"ai","tags":[...],"risk":R}` where `risk` is `low`, `medium` or `high` and is absent when not scored. |
| `messages` | array | The opening message, then the replies in order. |

Each message:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `opening` or `reply` | The first message of a thread is the `opening`. |
| `id` | integer, replies only | The reply's ID. |
| `author` | string | The name the author gave. |
| `markdown` | string | The text as written, with line breaks kept. |
| `attachments` | array | Files attached to this message. |

Each attachment has `filename` (the name it had when attached), `path` (relative to the directory that
holds `feedback.json`, always under `attachments/`) and `bytes` (its size). The file at `path` holds
exactly the attached bytes. Two attachments with the same content share one file, so equal `path` values
are the same file under different `filename`s.

## Example

The export below is the golden fixture the tests compare real exports against, and a consumer written
only from this page parses it with unknown fields rejected. `context.project` varies by machine.

```json
{
  "schema_version": 1,
  "context": {
    "project": "/path/to/Fieldnotes",
    "comparison": "Working tree",
    "before": "HEAD"
  },
  "threads": [
    {
      "id": 1,
      "file": "src/bundle.ts",
      "side": "after",
      "revision": "r1",
      "target": { "kind": "line", "start": 12, "end": 12 },
      "line_text": "export const revision = 2;",
      "origin": { "kind": "reviewer", "category": "pattern-follow" },
      "messages": [
        {
          "kind": "opening",
          "author": "Reviewer",
          "markdown": "Keep this naming.\nIt matches the module.",
          "attachments": [
            {
              "filename": "evidence.PNG",
              "path": "attachments/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
              "bytes": 4
            }
          ]
        },
        { "kind": "reply", "id": 3, "author": "Author", "markdown": "Agreed.", "attachments": [] }
      ]
    },
    {
      "id": 4,
      "file": "src/bundle.ts",
      "side": "before",
      "revision": "r1",
      "target": { "kind": "line", "start": 3, "end": 5 },
      "origin": { "kind": "reviewer", "category": "bug" },
      "messages": [
        {
          "kind": "opening",
          "author": "Reviewer",
          "markdown": "This range loses the early return.",
          "attachments": []
        }
      ]
    },
    {
      "id": 5,
      "file": "assets/mark.svg",
      "side": "after",
      "revision": "r1",
      "target": { "kind": "image_region", "left": 0.25, "top": 0.5, "width": 0.5, "height": 0.25 },
      "origin": { "kind": "reviewer", "category": "note" },
      "messages": [
        { "kind": "opening", "author": "Reviewer", "markdown": "The circle is off centre.", "attachments": [] }
      ]
    },
    {
      "id": 6,
      "file": "src/settings.rs",
      "side": "after",
      "revision": "r1",
      "target": { "kind": "line", "start": 40, "end": 40 },
      "origin": { "kind": "ai", "tags": ["Risk Analysis", "Concurrency"], "risk": "medium" },
      "messages": [
        {
          "kind": "opening",
          "author": "AI note",
          "markdown": "Simultaneous saves can share a filename.",
          "attachments": []
        }
      ]
    }
  ]
}
```

Because `line_text` is the reviewed code, an export carries source from the project under review. Treat
the bundle directory like the project's own source.
