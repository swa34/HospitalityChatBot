// Create this file: src/rag/debugStorage.js
import 'dotenv/config';
import { getPineconeIndex } from './pineconeClient.js';

async function debugStorage() {
  try {
    console.log('🔍 Debugging Pinecone storage...\n');

    const index = await getPineconeIndex();

    // Check what namespace the script thinks it should use
    const expectedNamespace = process.env.PINECONE_NAMESPACE || ''; // Use empty string for default
    console.log(
      `Expected namespace from env: "${expectedNamespace}" ${
        expectedNamespace === '' ? '(empty string - Pinecone default)' : ''
      }\n`
    );

    // Get ALL index stats (don't specify namespace)
    console.log('📊 Getting complete index stats...');
    const stats = await index.describeIndexStats();

    console.log('Raw stats object:');
    console.log(JSON.stringify(stats, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // Total across ALL namespaces (handle different field names)
    const totalVectors = stats.totalVectorCount || stats.totalRecordCount || 0;
    console.log(
      `🔢 TOTAL VECTORS ACROSS ALL NAMESPACES: ${totalVectors.toLocaleString()}`
    );

    if (totalVectors === 0) {
      console.log('❌ No vectors found at all! Something is wrong.');
      console.log('   - Did you run the ingestion? (npm run ingest)');
      console.log('   - Are you connected to the right Pinecone index?');
      return;
    }

    // Check each namespace individually
    console.log('\n📁 NAMESPACE BREAKDOWN:');
    console.log('========================');

    if (stats.namespaces && Object.keys(stats.namespaces).length > 0) {
      for (const [namespaceName, namespaceData] of Object.entries(
        stats.namespaces
      )) {
        const displayName =
          namespaceName === '' ? '__default__ (empty string)' : namespaceName;
        const vectorCount =
          namespaceData.vectorCount || namespaceData.recordCount || 0;

        console.log(`📂 Namespace: "${displayName}"`);
        console.log(`   Vectors: ${vectorCount.toLocaleString()}`);

        if (vectorCount > 0) {
          // Calculate storage for this namespace
          const storageGB = (vectorCount * 13) / (1024 * 1024); // 13KB per vector estimate
          console.log(`   Estimated storage: ${storageGB.toFixed(3)} GB`);

          // Test query this namespace
          try {
            const ns = index.namespace(namespaceName);
            const testQuery = await ns.query({
              vector: new Array(3072).fill(0.1), // dummy vector
              topK: 1,
              includeMetadata: true,
            });

            if (testQuery.matches && testQuery.matches.length > 0) {
              const sample = testQuery.matches[0];
              console.log(`   ✅ Namespace accessible`);
              console.log(`   Sample record ID: ${sample.id}`);
              console.log(
                `   Sample metadata keys: ${Object.keys(sample.metadata || {})}`
              );
            }
          } catch (err) {
            console.log(`   ❌ Error querying namespace: ${err.message}`);
          }
        }
        console.log('');
      }
    } else {
      console.log('❌ No namespaces found in stats!');
    }

    // Calculate total storage
    if (totalVectors > 0) {
      const totalStorageGB = (totalVectors * 13) / (1024 * 1024);
      const storagePercent = (totalStorageGB / 2) * 100;

      console.log('💾 TOTAL STORAGE CALCULATION:');
      console.log('=============================');
      console.log(`Total vectors: ${totalVectors.toLocaleString()}`);
      console.log(
        `Estimated storage: ${totalStorageGB.toFixed(3)} GB / 2.0 GB`
      );
      console.log(`Storage used: ${storagePercent.toFixed(1)}%`);

      if (storagePercent > 75) {
        console.log('⚠️  WARNING: Over 75% storage used!');
      }
    }

    // Environment check
    console.log('\n🔧 ENVIRONMENT CHECK:');
    console.log('=====================');
    console.log(`PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME}`);
    console.log(
      `PINECONE_NAMESPACE: ${
        process.env.PINECONE_NAMESPACE || '(not set, using __default__)'
      }`
    );
    console.log(`EMBED_MODEL: ${process.env.EMBED_MODEL}`);
  } catch (error) {
    console.error('❌ Error debugging storage:', error);
    console.error('Stack trace:', error.stack);
  }
}

debugStorage();
