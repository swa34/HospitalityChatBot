import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME;

export async function getPineconeIndex() {
  if (!INDEX_NAME) {
    throw new Error('PINECONE_INDEX_NAME is undefined. Check your .env');
  }

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

  const list = await pc.listIndexes();
  const names = list.indexes?.map(i => i.name) || [];

  if (!names.includes(INDEX_NAME)) {
    throw new Error(
      `Index "${INDEX_NAME}" not found. Run ingest first or create it.`
    );
  }

  return pc.index(INDEX_NAME);
}
