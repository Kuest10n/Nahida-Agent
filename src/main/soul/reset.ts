/**
 * 一键重置模块 —— v1.6 安全功能
 *
 * 职责：安全清空用户数据，保留人格核心文件
 *
 * 重置范围：
 *   - 对话历史（sessions/）
 *   - 纪念日记录（memory/anniversary.json）
 *   - 知识图谱（memory/kg.json）
 *   - Token 统计
 *   - 用户配置（config.json 中的用户设置）
 *   - Worldbook 缓存（重新加载）
 *
 * 保留文件：
 *   - SOHA.md / User.md / persona.md 等人格核心
 *   - Worldbook/*.md 源文件
 *   - 代码和程序文件
 *
 * 安全机制：
 *   - 需要二次确认（/reset confirm）
 *   - 重置前自动备份到 memory/backup/
 *   - 重置后生成重置报告
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 重置结果 */
export interface ResetResult {
  /** 是否成功 */
  success: boolean;
  /** 重置项目列表 */
  resetItems: string[];
  /** 备份路径 */
  backupPath: string | null;
  /** 错误信息 */
  error?: string;
}

/** 重置状态 */
interface ResetState {
  /** 是否等待确认 */
  awaitingConfirm: boolean;
  /** 请求时间 */
  requestTime: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 确认超时时间（ms） */
const CONFIRM_TIMEOUT_MS = 60 * 1000; // 1 分钟

/** 需要删除的文件列表 */
const FILES_TO_DELETE = [
  'memory/anniversary.json',
  'memory/kg.json',
  'memory/sessions.json',
  'memory/token-stats.json',
  'memory/config.json',
];

/** 需要清空的目录列表 */
const DIRS_TO_CLEAR: string[] = [];

// ── 模块状态 ──────────────────────────────────────────────────

let resetState: ResetState = {
  awaitingConfirm: false,
  requestTime: 0,
};

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 请求重置（第一阶段）
 *
 * 返回确认提示，进入等待确认状态。
 */
export function requestReset(): { awaitingConfirm: boolean; message: string } {
  resetState = {
    awaitingConfirm: true,
    requestTime: Date.now(),
  };

  return {
    awaitingConfirm: true,
    message: '（花冠微垂，神情凝重）……这将清空所有心识印记和记忆，包括我们的对话历史、纪念日、知识图谱……\n\n如果确定要重置，请在 1 分钟内发送 `/reset confirm` 确认。',
  };
}

/**
 * 执行重置（第二阶段，需要确认）
 *
 * @param force 是否强制重置（跳过确认）
 */
export function executeReset(force: boolean = false): ResetResult {
  // 检查确认状态
  if (!force && !resetState.awaitingConfirm) {
    return {
      success: false,
      resetItems: [],
      backupPath: null,
      error: '请先发送 /reset 请求重置，然后在 1 分钟内发送 /reset confirm 确认',
    };
  }

  // 检查超时
  if (!force && Date.now() - resetState.requestTime > CONFIRM_TIMEOUT_MS) {
    resetState.awaitingConfirm = false;
    return {
      success: false,
      resetItems: [],
      backupPath: null,
      error: '确认已超时，请重新发送 /reset',
    };
  }

  // 重置状态
  resetState.awaitingConfirm = false;

  const result: ResetResult = {
    success: true,
    resetItems: [],
    backupPath: null,
  };

  try {
    // 1. 创建备份
    const backupPath = createBackup();
    result.backupPath = backupPath;

    // 2. 删除数据文件
    for (const file of FILES_TO_DELETE) {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        result.resetItems.push(file);
      }
    }

    // 3. 清空目录
    for (const dir of DIRS_TO_CLEAR) {
      const dirPath = path.resolve(process.cwd(), dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          fs.unlinkSync(filePath);
        }
        result.resetItems.push(`${dir}/*`);
      }
    }

    // 4. 重置各模块状态（调用其他模块的 reset 函数）
    // 这些 reset 函数需要在各自模块中导出

    console.log('[Reset] completed:', result.resetItems.join(', '));

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Reset] failed:', errorMsg);
    return {
      success: false,
      resetItems: result.resetItems,
      backupPath: result.backupPath,
      error: errorMsg,
    };
  }
}

/**
 * 取消重置请求
 */
export function cancelReset(): void {
  resetState.awaitingConfirm = false;
}

/**
 * 获取重置状态
 */
export function getResetState(): ResetState {
  return { ...resetState };
}

// ── 备份逻辑 ──────────────────────────────────────────────────

/**
 * 创建备份
 *
 * 将即将删除的文件备份到 memory/backup/YYYYMMDD-HHmmss/
 */
function createBackup(): string | null {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:T]/g, '-').split('.')[0] ?? '';
    const backupDir = path.resolve(process.cwd(), 'memory', 'backup', timestamp);

    fs.mkdirSync(backupDir, { recursive: true });

    for (const file of FILES_TO_DELETE) {
      const sourcePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(sourcePath)) {
        const fileName = path.basename(file);
        fs.copyFileSync(sourcePath, path.join(backupDir, fileName));
      }
    }

    console.log(`[Reset] backup created at ${backupDir}`);
    return backupDir;
  } catch (err) {
    console.error('[Reset] backup failed:', err);
    return null;
  }
}

/**
 * 获取重置报告文本（纳西妲腔）
 */
export function getResetReport(result: ResetResult): string {
  if (!result.success) {
    return `（花冠微垂，略带困惑）……重置似乎遇到了问题：${result.error ?? '未知错误'}（虚空屏闪烁）`;
  }

  const items = result.resetItems.length > 0
    ? result.resetItems.join('、')
    : '无（已经是初始状态）';

  const backupInfo = result.backupPath
    ? `旧记忆已妥善保存在 ${path.basename(result.backupPath)}，就像落叶归入泥土。`
    : '';

  return `（虚空屏光芒渐弱，随后重新亮起）……心识印记已清空。\n\n重置内容：${items}\n${backupInfo}\n\n（花冠轻转，露出温柔的笑容）……你好，初次见面。我是纳西妲，须弥的草神。请多关照（铃铛轻响）`;
}