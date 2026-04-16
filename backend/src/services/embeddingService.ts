import logger from '../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Generates an embedding for a given text using Ollama's embed API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check if embeddings array is returned and extract the first one
    if (data.embeddings && Array.isArray(data.embeddings) && data.embeddings.length > 0) {
      return data.embeddings[0]; // nominal shape: number[]
    }
    
    throw new Error('Unexpected response format from Ollama embed API');
  } catch (error) {
    logger.info('Error generating embedding', error);
    throw error;
  }
}

/**
 * Computes cosine similarity between two vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vector dimensions must match');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0; // Prevent division by zero
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RankedLabelCandidate {
  labelId: string;
  labelName: string;
  score: number;
  labelMode: 'existing' | 'new';
}

/**
 * Ranks label vectors against an email's embedding using cosine similarity.
 */
export function rankLabelsForEmail(
  emailEmbedding: number[],
  labelVectors: Array<{ labelId: string; labelName: string; embedding: number[] }>
): RankedLabelCandidate[] {
  const matches = labelVectors.map((lv) => {
    const score = cosineSimilarity(emailEmbedding, lv.embedding);
    return {
      labelId: lv.labelId,
      labelName: lv.labelName,
      score,
      labelMode: score >= 0.85 ? 'existing' : 'new' as 'existing' | 'new',
    };
  });

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}
