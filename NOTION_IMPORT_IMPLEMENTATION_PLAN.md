# Notion Import Image Reliability — Implementation Plan

Status: implemented. The plan remains as the implementation and verification record.

## Objective

Make the Notion HTML import preserve every image that is present and importable
from the export ZIP, while making skipped images visible and diagnosable.

The implementation must distinguish between:

- an image missing from the export;
- an image whose HTML path cannot be resolved;
- an image in an unsupported format;
- an image placed in HTML that the converter does not currently preserve;
- an image intentionally retained as an external HTTPS URL; and
- an actual storage or database failure.

Notion documents that HTML exports include page images and other assets in
separate folders, so local assets referenced by the HTML should be treated as
importer inputs rather than silently discarded.

## Scope

Primary files:

- `src/lib/server/notion-import/html.ts`
- `src/lib/server/assets.ts`
- `src/routes/api/import/notion/preview/+server.ts`
- `src/routes/api/import/notion/apply/+server.ts`
- `src/routes/+layout.svelte`

Test/support files:

- Add a deterministic Notion importer regression script or test fixture under
  `scripts/` (or the repository's eventual test directory).

Out of scope:

- Notion database/CSV import.
- Replacing the editor's image node model.
- Changing existing user-upload behavior without a format/security review.
- Modifying unrelated working-tree changes in `src/app.css` or
  `src/routes/+layout.svelte`.

## Standalone HTML input

The importer also accepts `.html` and `.htm` files as single-page imports.
Embedded data-URL images are copied into local storage, HTTPS images remain
external, and relative image paths are reported as unavailable because a
standalone HTML file does not carry neighboring asset files. ZIP remains the
recommended format when local Notion assets must be preserved.

## Phase 1 — Establish the regression seam

Add a deterministic test harness around the public importer seam:

- Create an in-memory ZIP using JSZip.
- Load the importer through the real Svelte/Vite server module path.
- Use an isolated temporary SQLite database and upload directory.
- Run both preview and apply.
- Inspect the resulting Tiptap JSON and stored assets.
- Always clean up the temporary database and uploads.

The first fixture must contain:

1. A local image whose HTML path contains an encoded space, such as
   `Assets/photo%20one.png`, while the ZIP entry is `Assets/photo one.png`.
2. An image with a caption or adjacent text.
3. An image inside a table cell.
4. An image inside a list item.
5. A valid image in each currently supported format.
6. An HTTPS image that is intentionally external.
7. A missing local path.

Assertions must compare:

- referenced image candidates;
- preview counts and warnings;
- successfully stored assets;
- image nodes in the created Tiptap document; and
- the final warning/error classification.

The current implementation must fail this fixture before any fix is applied.

## Phase 2 — Fix archive-path resolution

Update `resolveArchivePath` so HTML URL paths are safely decoded before lookup.

Requirements:

- Decode percent-encoded filenames and Unicode characters.
- Strip query strings and fragments before decoding or lookup.
- Normalize both slash styles.
- Reject malformed percent-encoding with a specific warning.
- Re-check traversal and absolute-path protections after decoding.
- Do not allow a decoded `%2F`, `%5C`, or `..` sequence to escape the archive
  root.
- Keep HTTPS, HTTP, `data:`, and other schemes out of local archive lookup.

Regression case: the encoded-space fixture must resolve to the actual ZIP entry
and produce one stored upload rather than a “non-local” warning.

## Phase 3 — Preserve images in all supported block contexts

Separate block-level image conversion from inline-text conversion.

The converter should not rely on `inlineFromNodes` for a subtree that can
contain images, because that function intentionally ignores `<img>` elements.

Required behavior:

- Standalone images continue to become Tiptap image nodes.
- A paragraph containing an image plus caption/text is split into valid block
  nodes, preserving both the image and the text.
- Images in figures preserve the image and caption.
- Images in list items are preserved using valid list-item block content.
- Images in table cells are preserved using valid table-cell block content.
- Images inside supported wrappers are recursively discovered exactly once.
- Unsupported placements generate a warning rather than silently losing the
  image.
- Duplicate references to the same archive file reuse one stored asset.

The implementation must validate generated JSON against the editor schema or
the closest available server-side validation seam so that preserving an image
does not produce invalid Tiptap content.

## Phase 4 — Make import results truthful

Replace the current “referenced local path count” behavior with explicit import
outcomes.

Recommended result model:

- `imageCount`: images successfully represented in the imported documents;
- `skippedImageCount`: images referenced but not imported;
- `warnings`: deduplicated human-readable reasons;
- optional structured diagnostics for tests and server logs, without exposing
  sensitive archive paths unnecessarily.

At minimum, preview and apply must not claim that an image was imported when
the converter or asset layer will skip it.

Preview should perform the same structural and format checks needed to predict
apply results, without writing assets or pages. Apply should return the actual
result, not a re-count of HTML references.

Update the settings UI to show imported/skipped counts and warnings clearly.

## Phase 5 — Correct error and format handling

Narrow the image-storage catch block:

- Catch `AssetValidationError` as an unsupported/invalid image.
- Preserve a specific warning for an unsupported format.
- Do not relabel database, filesystem, permission, or transaction errors as
  unsupported images.
- Abort and clean up created assets when a real storage failure occurs.
- Ensure no page is committed if the import transaction fails.

Decide format policy explicitly before implementation:

- Keep the current PNG/JPEG/GIF/WebP allowlist and report other formats; or
- add additional formats only after signature validation, response MIME
  handling, and browser/editor security are reviewed.

The preview and apply paths must use the same format policy.

## Phase 6 — External HTTPS images

Keep the current security rule that only HTTPS remote images may be retained,
unless a separate decision authorizes downloading external content.

For retained remote images:

- make clear that the image was not copied into local storage;
- warn that the URL remains externally hosted and may expire; and
- ensure the result count distinguishes remote-preserved images from local
  uploaded assets.

Do not silently convert failed remote access into a local-import failure. The
HTML export should be inspected to determine whether a given image is actually
external or whether a local asset was incorrectly missed.

## Phase 7 — Verification

Run the following checks after implementation:

1. Regression harness: encoded path, mixed content, table, list, missing file,
   supported formats, unsupported format, and remote URL.
2. Repeat the harness twice to verify deterministic behavior and cache reuse.
3. `svelte-check` with zero diagnostics.
4. Build the application.
5. Manually import a real Notion HTML export with subpages and images.
6. Confirm every skipped image has an actionable warning.
7. Confirm imported assets exist on disk and every stored asset is referenced by
   the resulting page JSON.
8. Confirm a failed import leaves no partially created pages or assets.

## Acceptance criteria

- URL-encoded local image paths import successfully.
- Images in paragraphs with captions/text, lists, figures, and tables are not
  silently lost.
- Preview counts match the actual apply result.
- Unsupported formats are explicitly reported and never misclassified as
  missing local files.
- Storage/database failures remain visible as failures and trigger cleanup.
- HTTPS external images are clearly identified as external rather than being
  mistaken for locally imported files.
- Existing manual uploads and existing local image references continue to work.
- Existing unrelated working-tree changes remain untouched.
