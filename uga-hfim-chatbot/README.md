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
You do NOT need to:
Re-ingest Pinecone unless you changed or added docs.

Commit anything to GitHub unless you changed the front-end files.

Touch the OpenAI key in the front end (it stays server-only).

just start 2 terminals one
run: npm run tunnel
2nd terminal
npm run dev

REMEMBER RO CHANGE TUNNEL ADDRESS
index.html github pages
server.js

npm run dev:all
