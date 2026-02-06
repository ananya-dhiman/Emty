/**
 * OpenRouter AI Service
 * Handles calls to OpenRouter API for email processing and insight extraction
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AIInsightExtraction {
    intent: 'action_required' | 'event' | 'opportunity' | 'information' | 'waiting' | 'noise';
    shortSnippet: string;
    labels: string[]; // AI-generated labels
    dates: Array<{
        type: 'deadline' | 'event' | 'followup';
        date: string; // ISO date string
        description?: string;
    }>;
    extractedFacts: Record<string, any>; // Any extracted structured data
}

/**
 * Call OpenRouter API to extract insights from email content
 */
export const extractInsightsFromEmail = async (
    emailContent: {
        from: string;
        subject: string;
        body: string;
        internalDate?: string;
    }
): Promise<AIInsightExtraction> => {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }

    const prompt = `You are an email insight extraction AI. Analyze the following email and extract structured insights.

From: ${emailContent.from}
Subject: ${emailContent.subject}
Date: ${emailContent.internalDate || 'Unknown'}

Body:
${emailContent.body}

Extract and return a JSON object with:
1. intent: One of 'action_required', 'event', 'opportunity', 'information', 'waiting', 'noise'
2. shortSnippet: A 1-2 sentence summary of the email (max 150 chars)
3. labels: Array of 1-3 smart labels categorizing the email (e.g., ['job', 'internship'], ['event', 'tech'])
4. dates: Array of important dates with type ('deadline', 'event', 'followup') and ISO date string
5. extractedFacts: Object with any important facts (e.g., company, position, salary, event details)

Return ONLY valid JSON, no markdown code blocks.`;

    try {
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-3.5-turbo',
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.3, // Lower temp for consistent extraction
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.statusText}`);
        }

        const data = await response.json();
        const extractedText = data.choices?.[0]?.message?.content;

        if (!extractedText) {
            throw new Error('No content in OpenRouter response');
        }

        // Parse JSON response
        const insights: AIInsightExtraction = JSON.parse(extractedText);

        // Validate response structure
        if (!insights.intent || !insights.shortSnippet || !Array.isArray(insights.labels)) {
            throw new Error('Invalid insight structure from AI');
        }

        return insights;
    } catch (error) {
        console.error('Error calling OpenRouter API:', error);
        throw error;
    }
};
