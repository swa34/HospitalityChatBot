// Create this file: src/rag/checkUsage.js
import 'dotenv/config';
import { getPineconeIndex } from './pineconeClient.js';

async function checkUsage() {
  try {
    console.log('🔍 Checking Pinecone usage...\n');

    const index = await getPineconeIndex();
    const ns = index.namespace(process.env.PINECONE_NAMESPACE || '__default__');

    const stats = await ns.describeIndexStats();

    // Extract data
    const totalVectors = stats.totalVectorCount || 0;
    const namespacesUsed = Object.keys(stats.namespaces || {}).length;

    // Rough storage estimate (13KB per vector including metadata)
    const storageGB = (totalVectors * 13) / (1024 * 1024);
    const storagePercent = (storageGB / 2) * 100;

    // Display results
    console.log('📊 USAGE STATISTICS');
    console.log('===================');
    console.log(`Vectors: ${totalVectors.toLocaleString()}`);
    console.log(
      `Storage: ${storageGB.toFixed(3)} GB / 2.0 GB (${storagePercent.toFixed(
        1
      )}%)`
    );
    console.log(`Namespaces: ${namespacesUsed}/100`);

    // Warnings
    if (storagePercent >= 90) {
      console.log('🚨 CRITICAL: Over 90% storage used!');
    } else if (storagePercent >= 75) {
      console.log('⚠️  WARNING: Over 75% storage used');
    } else {
      console.log('✅ Storage usage looks good');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkUsage();
