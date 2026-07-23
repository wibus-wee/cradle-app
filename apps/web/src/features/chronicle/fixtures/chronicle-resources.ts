import type { ChronicleModelResource } from '../use-chronicle'

export const chronicleResourceFixtures = [
  {
    category: 'ocr',
    label: 'Screen text recognition',
    state: 'available',
    required: true,
    provider: 'macOS Vision',
    path: '/System/Library/Frameworks/Vision.framework',
    version: '14.0',
    sizeBytes: null,
    message: 'Ready for local screen text extraction.',
    metadata: null,
    updatedAt: 1_754_000_000_000,
  },
  {
    category: 'audio-vad',
    label: 'Voice activity detection',
    state: 'missing',
    required: true,
    provider: 'Silero VAD',
    path: null,
    version: null,
    sizeBytes: 2_621_440,
    message: 'Download the model before enabling audio capture.',
    metadata: {
      manifest: {
        files: [
          {
            sourceUrl: 'https://models.example.test/silero-vad.onnx',
          },
        ],
      },
    },
    updatedAt: 1_754_000_000_000,
  },
  {
    category: 'audio-asr',
    label: 'Speech recognition',
    state: 'installing',
    required: true,
    provider: 'Whisper',
    path: null,
    version: 'large-v3-turbo',
    sizeBytes: 1_617_000_000,
    message: 'Downloading the speech recognition model.',
    metadata: {
      manifest: {
        files: [
          {
            sourceUrl: 'https://models.example.test/whisper.bin',
          },
        ],
      },
    },
    updatedAt: 1_754_000_000_000,
  },
  {
    category: 'speaker',
    label: 'Speaker identification',
    state: 'optional',
    required: false,
    provider: 'ECAPA-TDNN',
    path: null,
    version: null,
    sizeBytes: 83_886_080,
    message: 'Optional model for identifying recurring speakers.',
    metadata: {
      manifest: {
        files: [
          {
            sourceUrl: 'https://models.example.test/speaker.onnx',
          },
        ],
      },
    },
    updatedAt: null,
  },
  {
    category: 'embedding',
    label: 'Semantic memory search',
    state: 'error',
    required: true,
    provider: 'Nomic Embed',
    path: '/models/nomic-embed',
    version: '1.5',
    sizeBytes: 289_406_976,
    message: 'Checksum verification failed. Download the model again.',
    metadata: {
      manifest: {
        files: [
          {
            sourceUrl: 'https://models.example.test/embedding.gguf',
          },
        ],
      },
    },
    updatedAt: 1_754_000_000_000,
  },
  {
    category: 'pii',
    label: 'Sensitive data detection',
    state: 'optional',
    required: false,
    provider: 'Local rules',
    path: null,
    version: null,
    sizeBytes: null,
    message: null,
    metadata: null,
    updatedAt: null,
  },
] satisfies ChronicleModelResource[]
