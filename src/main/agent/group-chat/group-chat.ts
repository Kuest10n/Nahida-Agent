import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateResponse } from '../agent-core';
import { getPersonality, listPersonalities } from '../../memory/personality-manager';
import type { Personality } from '../../memory/personality-manager';
import type { DegradeDecision } from '../../router/degrade-strategy';

export type MemberType = 'user' | 'ai';

export interface AgentMember {
  memberId: string;
  type: MemberType;
  personalityId?: string;
  name: string;
  tokenLimit: number;
  joinedAt: number;
}

export interface GroupMessage {
  messageId: string;
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  isTokenLimited: boolean;
}

export interface GroupChat {
  groupId: string;
  name: string;
  members: AgentMember[];
  messages: GroupMessage[];
  createdAt: number;
  lastActivity: number;
  defaultTokenLimit: number;
}

export interface GroupChatConfig {
  defaultTokenLimit: number;
  maxMembers: number;
  maxMessages: number;
}

const DEFAULT_CONFIG: GroupChatConfig = {
  defaultTokenLimit: 50,
  maxMembers: 10,
  maxMessages: 100,
};

const GROUPS_DIR = path.resolve(process.cwd(), 'data', 'groups');

let initialized = false;
const groups = new Map<string, GroupChat>();
let config: GroupChatConfig = DEFAULT_CONFIG;

/** 按群 ID 隔离的互斥锁，防止 broadcastMessage 并发写入竞态 */
const groupMutex = new Map<string, Promise<void>>();

function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveGroup(group: GroupChat): void {
  try {
    if (!fs.existsSync(GROUPS_DIR)) {
      fs.mkdirSync(GROUPS_DIR, { recursive: true });
    }
    const filePath = path.join(GROUPS_DIR, `${group.groupId}.json`);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(group, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[GroupChat] save ${group.groupId} failed:`, err);
    throw err;
  }
}

function loadGroups(): void {
  if (!fs.existsSync(GROUPS_DIR)) {
    fs.mkdirSync(GROUPS_DIR, { recursive: true });
    return;
  }

  const files = fs.readdirSync(GROUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(GROUPS_DIR, f));

  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const group = JSON.parse(raw) as GroupChat;
      groups.set(group.groupId, group);
    } catch {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  console.log(`[GroupChat] loaded ${groups.size} groups from disk`);
}

export function initGroupChat(customConfig?: Partial<GroupChatConfig>): void {
  if (initialized) return;
  ensureDirectoryExists(GROUPS_DIR);
  config = { ...DEFAULT_CONFIG, ...customConfig };
  loadGroups();
  initialized = true;
  console.log('[GroupChat] initialized');
}

export function createGroup(name: string, initialMembers?: string[]): GroupChat | null {
  if (!initialized) initGroupChat();

  const groupId = generateId();
  const members: AgentMember[] = [];

  members.push({
    memberId: 'user',
    type: 'user',
    name: '旅行者',
    tokenLimit: 0,
    joinedAt: Date.now(),
  });

  if (initialMembers) {
    for (const personalityId of initialMembers) {
      const personality = getPersonality(personalityId);
      if (personality) {
        members.push({
          memberId: personalityId,
          type: 'ai',
          personalityId,
          name: personality.displayName,
          tokenLimit: config.defaultTokenLimit,
          joinedAt: Date.now(),
        });
      }
    }
  }

  const group: GroupChat = {
    groupId,
    name,
    members,
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    defaultTokenLimit: config.defaultTokenLimit,
  };

  groups.set(groupId, group);
  saveGroup(group);
  console.log(`[GroupChat] created: ${groupId} - ${name}`);
  return group;
}

export function getGroup(groupId: string): GroupChat | undefined {
  if (!initialized) initGroupChat();
  return groups.get(groupId);
}

export function listGroups(): GroupChat[] {
  if (!initialized) initGroupChat();
  return Array.from(groups.values()).sort((a, b) => b.lastActivity - a.lastActivity);
}

export function deleteGroup(groupId: string): boolean {
  if (!initialized) initGroupChat();
  if (!groups.has(groupId)) return false;

  groups.delete(groupId);
  const filePath = path.join(GROUPS_DIR, `${groupId}.json`);
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  console.log(`[GroupChat] deleted: ${groupId}`);
  return true;
}

export function addAgent(groupId: string, personalityId: string): boolean {
  if (!initialized) initGroupChat();
  const group = groups.get(groupId);
  if (!group) return false;

  const personality = getPersonality(personalityId);
  if (!personality) return false;

  if (group.members.some(m => m.memberId === personalityId)) return false;
  if (group.members.length >= config.maxMembers) return false;

  group.members.push({
    memberId: personalityId,
    type: 'ai',
    personalityId,
    name: personality.displayName,
    tokenLimit: group.defaultTokenLimit,
    joinedAt: Date.now(),
  });

  group.lastActivity = Date.now();
  saveGroup(group);
  console.log(`[GroupChat] added agent: ${personalityId} to ${groupId}`);
  return true;
}

export function removeAgent(groupId: string, memberId: string): boolean {
  if (!initialized) initGroupChat();
  const group = groups.get(groupId);
  if (!group) return false;

  const index = group.members.findIndex(m => m.memberId === memberId);
  if (index === -1) return false;
  if (memberId === 'user') return false;

  group.members.splice(index, 1);
  group.lastActivity = Date.now();
  saveGroup(group);
  console.log(`[GroupChat] removed agent: ${memberId} from ${groupId}`);
  return true;
}

export function setTokenLimit(groupId: string, memberId: string | null, limit: number): boolean {
  if (!initialized) initGroupChat();
  const group = groups.get(groupId);
  if (!group) return false;

  if (memberId) {
    const member = group.members.find(m => m.memberId === memberId);
    if (!member) return false;
    member.tokenLimit = limit;
  } else {
    group.defaultTokenLimit = limit;
    for (const member of group.members) {
      if (member.type === 'ai') {
        member.tokenLimit = limit;
      }
    }
  }

  group.lastActivity = Date.now();
  saveGroup(group);
  console.log(`[GroupChat] token limit set: ${memberId || 'default'} = ${limit} in ${groupId}`);
  return true;
}

export function getAvailablePersonalities(): Personality[] {
  return listPersonalities();
}

export interface GroupReply {
  memberId: string;
  memberName: string;
  content: string;
  isTokenLimited: boolean;
  latencyMs: number;
}

export async function broadcastMessage(
  groupId: string,
  content: string,
  degradeDecision: DegradeDecision,
): Promise<GroupReply[]> {
  if (!initialized) initGroupChat();

  // 入口判空：content 为空字符串/纯空格时直接返回，避免触发 N 次无意义的模型调用
  if (!content.trim()) {
    console.warn('[GroupChat] broadcastMessage rejected: empty content');
    return [];
  }

  // 获取群 ID 级互斥锁，串行化广播以防止并发写入竞态
  // 注意：必须存 lock 本身（不是 prev.finally 派生的新 Promise），
  // 否则 finally 中的 `groupMutex.get(groupId) === lock` 永远 false，cleanup 失效
  const prev = groupMutex.get(groupId) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>(resolve => { release = resolve; });
  groupMutex.set(groupId, lock);

  try {
    await prev;
    const group = groups.get(groupId);
    if (!group) return [];

    const userMessage: GroupMessage = {
      messageId: generateMessageId(),
      groupId,
      senderId: 'user',
      senderName: '旅行者',
      content,
      timestamp: Date.now(),
      isTokenLimited: false,
    };

    group.messages.push(userMessage);
    if (group.messages.length > config.maxMessages) {
      group.messages.shift();
    }
    group.lastActivity = Date.now();
    saveGroup(group);

    // 对 aiMembers 做快照（浅拷贝每个 member），避免广播期间 setTokenLimit 改了 member.tokenLimit
    // 导致同一轮广播内不同成员看到不同的 token 限制
    const aiMembers = group.members
      .filter(m => m.type === 'ai')
      .map(m => ({ ...m }));
    const replies: GroupReply[] = [];

    for (const member of aiMembers) {
      const startTime = Date.now();
      try {
        const tokenLimit = member.tokenLimit;
        const limitedContent = tokenLimit > 0
          ? `${content}\n\n【系统提示】请将回复限制在${tokenLimit} token内，保持简洁。`
          : content;

        let responseContent = '';
        await generateResponse(
          `group_${groupId}_${member.memberId}`,
          limitedContent,
          'chat',
          degradeDecision,
          (delta: string) => {
            responseContent += delta;
          },
        );

        const isLimited = tokenLimit > 0 && countTokens(responseContent) > tokenLimit;
        let finalContent = responseContent;

        if (isLimited && tokenLimit > 0) {
          finalContent = truncateToTokenLimit(responseContent, tokenLimit);
        }

        const reply: GroupReply = {
          memberId: member.memberId,
          memberName: member.name,
          content: finalContent,
          isTokenLimited: isLimited,
          latencyMs: Date.now() - startTime,
        };

        replies.push(reply);

        const aiMessage: GroupMessage = {
          messageId: generateMessageId(),
          groupId,
          senderId: member.memberId,
          senderName: member.name,
          content: finalContent,
          timestamp: Date.now(),
          isTokenLimited: isLimited,
        };

        group.messages.push(aiMessage);
        if (group.messages.length > config.maxMessages) {
          group.messages.shift();
        }
      } catch (err) {
        console.error(`[GroupChat] agent ${member.memberId} failed:`, err);
        replies.push({
          memberId: member.memberId,
          memberName: member.name,
          content: '（花冠微垂，沉默不语）',
          isTokenLimited: false,
          latencyMs: Date.now() - startTime,
        });
      }
    }

    group.lastActivity = Date.now();
    saveGroup(group);
    return replies;
  } finally {
    release();
    if (groupMutex.get(groupId) === lock) groupMutex.delete(groupId);
  }
}

const CHINESE_CHAR_RE = /[\u4e00-\u9fa5]/g;

export function countTokens(text: string): number {
  const chineseChars = (text.match(CHINESE_CHAR_RE) || []).length;
  const otherChars = text.replace(CHINESE_CHAR_RE, '').length;
  return chineseChars + Math.ceil(otherChars / 4);
}

export function truncateToTokenLimit(text: string, limit: number): string {
  let tokenCount = 0;
  let result = '';

  for (const char of text) {
    const tokenAdd = /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.25;
    if (tokenCount + tokenAdd > limit) break;
    result += char;
    tokenCount += tokenAdd;
  }

  if (result.length < text.length) {
    result += '……';
  }

  return result;
}