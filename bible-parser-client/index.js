/**
 * Bible Parser Client
 *
 * This service runs on a local machine with GPU/CPU for Ollama inference.
 * It connects to JGM Live Captions SSE stream on the VPS, processes captions
 * with Ollama to extract Bible references, and sends parsed references back to VPS.
 *
 * Architecture:
 * VPS (JGM) --SSE--> Local Parser (Ollama) --POST--> VPS (Teleprompter)
 */

require('dotenv').config();
const EventSource = require('eventsource');
const axios = require('axios');

class BibleParserClient {
  constructor() {
    // VPS endpoints
    this.jgmSSEUrl = process.env.JGM_SSE_URL || 'http://localhost:8081/api/audience-stream';
    this.teleprompterApiUrl = process.env.TELEPROMPTER_API_URL || 'http://localhost:8080/api/bible-references';

    // Local Ollama
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'gemma2:2b';

    // Authentication
    this.apiKey = process.env.API_KEY;
    if (!this.apiKey) {
      console.warn('⚠️  Warning: No API_KEY set. The VPS may reject requests.');
    }

    // State
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // Start with 5 seconds
  }

  /**
   * Start the Bible parser client
   */
  start() {
    console.log('🚀 Bible Parser Client Starting...');
    console.log(`📡 JGM SSE URL: ${this.jgmSSEUrl}`);
    console.log(`🔗 Teleprompter API: ${this.teleprompterApiUrl}`);
    console.log(`🤖 Ollama URL: ${this.ollamaUrl} (model: ${this.ollamaModel})`);

    this.connectToJGM();
  }

  /**
   * Connect to JGM Live Captions SSE stream
   */
  connectToJGM() {
    console.log('🔗 Connecting to JGM Live Captions SSE...');

    this.eventSource = new EventSource(this.jgmSSEUrl);

    this.eventSource.onopen = () => {
      console.log('✅ Connected to JGM Live Captions SSE');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 5000;
    };

    this.eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleCaptionEvent(data);
      } catch (err) {
        console.error('❌ Error processing SSE message:', err.message);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error('❌ SSE connection error:', err);
      this.eventSource.close();
      this.handleReconnect();
    };
  }

  /**
   * Handle reconnection with exponential backoff
   */
  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('💀 Max reconnection attempts reached. Giving up.');
      process.exit(1);
    }

    this.reconnectAttempts++;
    console.log(`🔄 Reconnecting in ${this.reconnectDelay / 1000}s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connectToJGM();
    }, this.reconnectDelay);

    // Exponential backoff: 5s, 10s, 20s, 40s...
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
  }

  /**
   * Handle incoming caption event from JGM
   */
  async handleCaptionEvent(data) {
    // Filter for actual caption events (ignore status updates, clear events, etc.)
    if (data.type === 'clear' || data.type === 'status') {
      return;
    }

    // Check if this is a caption with text
    const captionText = data.text || data.caption || data.content;
    if (!captionText || captionText.trim().length === 0) {
      return;
    }

    console.log('📝 Processing caption:', captionText);

    try {
      // Parse Bible references with Ollama
      const references = await this.parseBibleReferences(captionText);

      if (references && references.length > 0) {
        console.log(`📖 Found ${references.length} Bible reference(s):`, references);
        await this.sendToTeleprompter(references);
      } else {
        console.log('ℹ️  No Bible references found in caption');
      }
    } catch (err) {
      console.error('❌ Error parsing caption:', err.message);
    }
  }

  /**
   * Parse Bible references using Ollama
   */
  async parseBibleReferences(text) {
    const prompt = `You are a Bible reference parser. Extract ONLY Bible verse references that are EXPLICITLY mentioned in the input text. Return a JSON object with a 'references' array.

Example input: "turn to John chapter 3 verse 16"
Example output: {"references":[{"book":"John","chapter":3,"verse":16,"endVerse":null,"rawText":"John 3:16","confidence":0.95}]}

Input: "${text}"`;

    try {
      const response = await axios.post(
        `${this.ollamaUrl}/api/generate`,
        {
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.0,
            num_predict: 500,
          }
        },
        { timeout: 60000 } // 60 second timeout
      );

      if (!response.data || !response.data.response) {
        console.warn('⚠️  Empty response from Ollama');
        return [];
      }

      // Parse the JSON response
      let responseText = response.data.response.trim();
      responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (jsonErr) {
        console.error('❌ Failed to parse Ollama JSON response:', responseText);
        return [];
      }

      // Extract references array
      let references = [];
      if (Array.isArray(parsed)) {
        references = parsed;
      } else if (parsed.references && Array.isArray(parsed.references)) {
        references = parsed.references;
      }

      // Validate references
      const validated = this.validateReferences(references, text);

      if (validated.length < references.length) {
        console.log(`⚠️  Filtered out ${references.length - validated.length} hallucinated reference(s)`);
      }

      return validated;
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        console.error('❌ Cannot connect to Ollama. Is it running?');
      } else if (err.code === 'ETIMEDOUT') {
        console.error('❌ Ollama request timed out');
      } else {
        console.error('❌ Ollama error:', err.message);
      }
      return [];
    }
  }

  /**
   * Validate references to filter out hallucinations
   */
  validateReferences(references, inputText) {
    const validated = [];
    const lowerInput = inputText.toLowerCase();

    const verseWords = {
      1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
      6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
      11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
      16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty',
    };

    for (const ref of references) {
      const chapterStr = String(ref.chapter);
      const verseStr = String(ref.verse);
      const verseWord = verseWords[ref.verse];

      // Check various patterns
      const hasChapter = lowerInput.includes(chapterStr);
      const hasVerse = lowerInput.includes(verseStr) || (verseWord && lowerInput.includes(verseWord));

      // Pattern checks
      const pattern1 = new RegExp(`chapter\\s+${chapterStr}\\s+verse\\s+${verseStr}`, 'i');
      const pattern2 = verseWord ? new RegExp(`chapter\\s+${chapterStr}\\s+verse\\s+${verseWord}`, 'i') : null;
      const pattern3 = new RegExp(`${chapterStr}\\s*:\\s*${verseStr}`, 'i');

      const matched = pattern1.test(lowerInput) ||
                     (pattern2 && pattern2.test(lowerInput)) ||
                     pattern3.test(lowerInput) ||
                     (hasChapter && hasVerse);

      if (matched) {
        console.log(`✓ Validated: ${ref.book} ${ref.chapter}:${ref.verse}`);
        validated.push(ref);
      } else {
        console.log(`✗ Rejected hallucination: ${ref.book} ${ref.chapter}:${ref.verse}`);
      }
    }

    return validated;
  }

  /**
   * Send parsed references to VPS teleprompter
   */
  async sendToTeleprompter(references) {
    try {
      const payload = {
        references: references,
        timestamp: new Date().toISOString()
      };

      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }

      const response = await axios.post(
        this.teleprompterApiUrl,
        payload,
        { headers, timeout: 10000 }
      );

      console.log('✅ Successfully sent parsed references to VPS:', response.data);
    } catch (err) {
      if (err.response) {
        console.error('❌ VPS rejected request:', err.response.status, err.response.data);
      } else if (err.code === 'ECONNREFUSED') {
        console.error('❌ Cannot connect to VPS teleprompter API');
      } else {
        console.error('❌ Failed to send to VPS:', err.message);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    console.log('🛑 Shutting down Bible Parser Client...');
    if (this.eventSource) {
      this.eventSource.close();
    }
    process.exit(0);
  }
}

// Main execution
const client = new BibleParserClient();

// Handle graceful shutdown
process.on('SIGINT', () => client.shutdown());
process.on('SIGTERM', () => client.shutdown());

// Start the client
client.start();
