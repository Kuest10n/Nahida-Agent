import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Personality {
  id: string;
  name: string;
  displayName: string;
  description: string;
  default: boolean;
  createdAt: number;
}

export interface CreatePersonalityOptions {
  id: string;
  name: string;
  displayName: string;
  description: string;
}

const MEMORY_ROOT = path.resolve(process.cwd(), 'memory');
const PERSONALITIES_DIR = path.join(MEMORY_ROOT, 'personalities');
const PERSONALITY_INDEX_FILE = path.join(PERSONALITIES_DIR, '.index.json');

let initialized = false;
let currentPersonalityId = 'nahida';
const personalities = new Map<string, Personality>();

const DEFAULT_PERSONALITIES: Personality[] = [
  {
    id: 'nahida',
    name: 'nahida',
    displayName: '纳西妲',
    description: '尘世七执政中的草神——魔神名布耶尔（Buer）',
    default: true,
    createdAt: Date.now(),
  },
  {
    id: 'ti-bao',
    name: 'ti-bao',
    displayName: '缇宝',
    description: '来自星际和平公司的实习生，元气少女',
    default: false,
    createdAt: Date.now(),
  },
];

function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeIndex(): void {
  const data = {
    current: currentPersonalityId,
    personalities: Array.from(personalities.values()),
  };
  fs.writeFileSync(PERSONALITY_INDEX_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadIndex(): void {
  if (!fs.existsSync(PERSONALITY_INDEX_FILE)) {
    for (const p of DEFAULT_PERSONALITIES) {
      personalities.set(p.id, p);
      ensurePersonalityDirectory(p.id);
    }
    writeIndex();
    return;
  }

  try {
    const content = fs.readFileSync(PERSONALITY_INDEX_FILE, 'utf-8');
    const data = JSON.parse(content);
    currentPersonalityId = data.current ?? 'nahida';

    if (Array.isArray(data.personalities)) {
      for (const p of data.personalities) {
        personalities.set(p.id, p);
      }
    }

    for (const p of DEFAULT_PERSONALITIES) {
      if (!personalities.has(p.id)) {
        personalities.set(p.id, p);
        ensurePersonalityDirectory(p.id);
      }
    }

    writeIndex();
  } catch {
    for (const p of DEFAULT_PERSONALITIES) {
      personalities.set(p.id, p);
      ensurePersonalityDirectory(p.id);
    }
    writeIndex();
  }
}

function ensurePersonalityDirectory(personalityId: string): void {
  const dir = getPersonalityDirectory(personalityId);
  ensureDirectoryExists(dir);

  const worldbookDir = path.join(dir, 'worldbook');
  ensureDirectoryExists(worldbookDir);

  const defaultFiles = [
    'SOHA.md',
    'User.md',
    'fact.md',
    'fact-short.md',
    'fact-long.md',
    'persona.md',
    'emotion.md',
    'skill.md',
    'reflect.md',
    'interest.md',
  ];

  for (const fileName of defaultFiles) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8');
    }
  }
}

export function getPersonalityDirectory(personalityId: string): string {
  return path.join(PERSONALITIES_DIR, personalityId);
}

export function initPersonalityManager(): void {
  if (initialized) return;
  ensureDirectoryExists(PERSONALITIES_DIR);
  loadIndex();
  initialized = true;
  console.log(`[PersonalityManager] initialized, current: ${currentPersonalityId}`);
}

export function getCurrentPersonality(): Personality | undefined {
  if (!initialized) initPersonalityManager();
  return personalities.get(currentPersonalityId);
}

export function getCurrentPersonalityId(): string {
  if (!initialized) initPersonalityManager();
  return currentPersonalityId;
}

export function setCurrentPersonality(personalityId: string): boolean {
  if (!initialized) initPersonalityManager();
  if (!personalities.has(personalityId)) return false;

  currentPersonalityId = personalityId;
  writeIndex();
  console.log(`[PersonalityManager] switched to: ${personalityId}`);
  return true;
}

export function listPersonalities(): Personality[] {
  if (!initialized) initPersonalityManager();
  return Array.from(personalities.values());
}

export function getPersonality(personalityId: string): Personality | undefined {
  if (!initialized) initPersonalityManager();
  return personalities.get(personalityId);
}

export function createPersonality(options: CreatePersonalityOptions): Personality | null {
  if (!initialized) initPersonalityManager();
  if (personalities.has(options.id)) return null;

  const personality: Personality = {
    ...options,
    default: false,
    createdAt: Date.now(),
  };

  personalities.set(options.id, personality);
  ensurePersonalityDirectory(options.id);
  writeIndex();
  console.log(`[PersonalityManager] created: ${options.id}`);
  return personality;
}

export function deletePersonality(personalityId: string): boolean {
  if (!initialized) initPersonalityManager();
  if (!personalities.has(personalityId)) return false;
  if (personalityId === currentPersonalityId) return false;
  if (personalities.get(personalityId)?.default) return false;

  personalities.delete(personalityId);

  const dir = getPersonalityDirectory(personalityId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  writeIndex();
  console.log(`[PersonalityManager] deleted: ${personalityId}`);
  return true;
}

export function updatePersonality(
  personalityId: string,
  updates: Partial<Pick<Personality, 'displayName' | 'description'>>,
): Personality | null {
  if (!initialized) initPersonalityManager();
  const personality = personalities.get(personalityId);
  if (!personality) return null;

  if (updates.displayName !== undefined) personality.displayName = updates.displayName;
  if (updates.description !== undefined) personality.description = updates.description;

  writeIndex();
  return personality;
}