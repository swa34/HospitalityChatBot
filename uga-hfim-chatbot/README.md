Auto index creation
If uga-hfim-index doesn’t exist, it creates it with the correct dimension (3072) and waits until it’s ready.

PDF → TXT conversion & reuse

If you run without --skip-pdf, PDFs get converted and saved as .txt the first time. Subsequent runs just read the .txt.

If you want to skip PDFs entirely, use --skip-pdf.

CLI flags

--dry: logs what would be upserted, but doesn’t hit Pinecone (useful for testing chunking).

--recreate-index: deletes and recreates the index. Use sparingly (you’ll lose vectors).

--skip-pdf: ignore PDFs and rely on .txt/.md.

Memory-conscious ingest

Small BATCH_SIZE.

GC call if you run Node with --expose-gc.

Clean logging
Shows chunk counts and batch progress.
