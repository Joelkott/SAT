# Bible Parser Client

This service runs on your local machine with GPU/CPU capabilities and connects to the VPS-hosted JGM Live Captions to process Bible references using Ollama.

## Architecture

```
VPS (JGM) --SSE--> Local Parser (Ollama) --POST--> VPS (Teleprompter)
```

## Prerequisites

- Docker and Docker Compose installed
- (Optional) NVIDIA GPU for faster inference
- Access to your VPS domain

## Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your VPS configuration:**
   ```env
   JGM_SSE_URL=https://your-vps-domain.com/api/audience-stream
   TELEPROMPTER_API_URL=https://your-vps-domain.com/api/bible-references
   OLLAMA_URL=http://ollama:11434
   OLLAMA_MODEL=gemma2:2b
   API_KEY=your-secret-api-key
   ```

3. **Generate a secure API key:**
   ```bash
   openssl rand -hex 32
   ```

   Use this key in both:
   - Local `.env` file (`API_KEY`)
   - VPS backend environment (`BIBLE_PARSER_API_KEY`)

## Running with Docker

```bash
# Start all services (Ollama + Parser)
docker-compose up -d

# View logs
docker-compose logs -f bible-parser

# Stop services
docker-compose down
```

## Running without Docker

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Start Ollama separately:**
   ```bash
   ollama serve
   ollama pull gemma2:2b
   ```

3. **Start the parser:**
   ```bash
   npm start
   ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `JGM_SSE_URL` | JGM Live Captions SSE endpoint on VPS | Required |
| `TELEPROMPTER_API_URL` | Teleprompter API endpoint on VPS | Required |
| `OLLAMA_URL` | Local Ollama URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama model to use | `gemma2:2b` |
| `API_KEY` | Authentication key for VPS | Required |

## Troubleshooting

### Cannot connect to JGM SSE
- Check if your VPS domain is correct
- Ensure JGM Live Captions is running on VPS
- Check firewall/network settings

### Ollama not responding
- Check if Ollama is running: `docker ps`
- Check Ollama logs: `docker logs bible-parser-ollama`
- Ensure model is pulled: `docker exec bible-parser-ollama ollama list`

### VPS rejecting requests
- Verify API_KEY matches on both sides
- Check VPS backend logs
- Ensure BIBLE_PARSER_API_KEY is set on VPS

## Monitoring

The parser logs show:
- 📡 SSE connection status
- 📝 Incoming captions
- 📖 Detected Bible references
- ✅ Successfully sent to VPS
- ❌ Errors and warnings

## Development

Run with auto-reload:
```bash
npm run dev
```

This uses `nodemon` to restart on file changes.
