/**
 * Python 嵌入式环境管理器
 *
 * 管理本地嵌入式 Python 环境，用于运行 GPT-SoVITS、RVC 等 Python 服务。
 * 支持自动检测系统 Python 或使用嵌入式 Python。
 *
 * 目录结构：
 *   resources/python/           - 嵌入式 Python（Windows embeddable）
 *   resources/python/python.exe - 主解释器
 *   resources/python/Scripts/   - pip 等工具
 *   resources/python/Lib/       - 标准库
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

/** Python 环境配置 */
interface PythonEnv {
  /** Python 解释器路径 */
  pythonPath: string;
  /** pip 路径 */
  pipPath: string;
  /** 是否使用嵌入式 Python */
  isEmbedded: boolean;
}

/** 单例 Python 环境 */
let pythonEnv: PythonEnv | null = null;

/** 运行中的服务进程表（按脚本路径索引） */
const runningServices = new Map<string, ChildProcess>();

/**
 * 解析 Python 路径（支持嵌入式和系统 Python）
 *
 * 优先级：
 *   1. 环境变量 NAHIDA_PYTHON_PATH（用户指定）
 *   2. 嵌入式 Python（resources/python/python.exe）
 *   3. 系统 Python（PATH 中的 python）
 */
function resolvePythonPath(): string {
  const customPath = process.env.NAHIDA_PYTHON_PATH;

  // 用户指定路径
  if (customPath && existsSync(customPath)) {
    return customPath;
  }

  // 嵌入式 Python
  const embeddedPath = resolve(process.cwd(), 'resources/python/python.exe');
  if (existsSync(embeddedPath)) {
    return embeddedPath;
  }

  // 系统 Python（回退）
  return 'python';
}

/**
 * 初始化 Python 环境
 *
 * 检测 Python 可用性，返回环境配置。
 */
export async function initPythonEnv(): Promise<PythonEnv> {
  if (pythonEnv) return pythonEnv;

  const pythonPath = resolvePythonPath();
  const isEmbedded = pythonPath.includes('resources/python');

  console.log(`[Python] using: ${pythonPath} (embedded: ${isEmbedded})`);

  // 验证 Python 可用
  try {
    await runPython(['--version']);
  } catch (err) {
    throw new Error(`Python not available at ${pythonPath}: ${err}`);
  }

  // 解析 pip 路径
  const pipPath = isEmbedded
    ? resolve(process.cwd(), 'resources/python/Scripts/pip.exe')
    : 'pip';

  pythonEnv = { pythonPath, pipPath, isEmbedded };
  return pythonEnv;
}

/**
 * 运行 Python 脚本
 *
 * @param args Python 命令行参数
 * @param cwd 工作目录（可选）
 * @returns Promise<ChildProcess>
 */
export function runPython(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = pythonEnv ?? { pythonPath: resolvePythonPath() };
    const proc = spawn(env.pythonPath, args, {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Python exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 启动 Python 服务（长驻进程）
 *
 * 用于 GPT-SoVITS API、RVC WebUI 等需要持续运行的服务。
 *
 * 进程管理：
 *   - 同一脚本重复启动时，先杀旧进程再起新的（防泄漏）
 *   - 进程结束自动从表中移除
 *   - 调用 cleanupAllServices() 可一键清理所有服务
 *
 * @param script Python 脚本路径
 * @param args 脚本参数
 * @param cwd 工作目录
 * @returns ChildProcess
 */
export function startPythonService(
  script: string,
  args: string[] = [],
  cwd?: string,
): ChildProcess {
  const env = pythonEnv ?? { pythonPath: resolvePythonPath() };

  // 同一脚本已在运行 → 先杀旧的
  const existing = runningServices.get(script);
  if (existing && !existing.killed) {
    console.log(`[Python] stopping existing service: ${script}`);
    existing.kill('SIGTERM');
    runningServices.delete(script);
  }

  console.log(`[Python] starting service: ${script} ${args.join(' ')}`);

  const proc = spawn(env.pythonPath, [script, ...args], {
    cwd: cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (data) => {
    console.log(`[Python:${script}] ${data.toString().trim()}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`[Python:${script}] ${data.toString().trim()}`);
  });

  proc.on('close', (code) => {
    console.log(`[Python:${script}] exited with code ${code}`);
    runningServices.delete(script);
  });

  proc.on('error', (err) => {
    console.error(`[Python:${script}] error:`, err);
    runningServices.delete(script);
  });

  runningServices.set(script, proc);
  return proc;
}

/**
 * 停止指定 Python 服务
 *
 * @param script 脚本路径
 * @returns 是否成功停止
 */
export function stopPythonService(script: string): boolean {
  const proc = runningServices.get(script);
  if (!proc || proc.killed) {
    runningServices.delete(script);
    return false;
  }

  console.log(`[Python] stopping service: ${script}`);
  proc.kill('SIGTERM');
  runningServices.delete(script);
  return true;
}

/**
 * 清理所有运行中的 Python 服务
 *
 * 应用退出时调用，防止僵尸进程。
 */
export function cleanupAllServices(): void {
  let count = 0;
  for (const [, proc] of runningServices) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      count++;
    }
  }
  runningServices.clear();
  if (count > 0) {
    console.log(`[Python] cleaned up ${count} services`);
  }
}

/**
 * 安装 Python 依赖
 *
 * 使用 pip 安装 requirements.txt 中的依赖。
 *
 * @param requirementsPath requirements.txt 路径
 */
export async function installDependencies(requirementsPath: string): Promise<void> {
  await initPythonEnv();

  if (!existsSync(requirementsPath)) {
    throw new Error(`requirements.txt not found: ${requirementsPath}`);
  }

  console.log(`[Python] installing dependencies from ${requirementsPath}`);

  try {
    await runPython(['-m', 'pip', 'install', '-r', requirementsPath]);
    console.log('[Python] dependencies installed successfully');
  } catch (err) {
    console.error('[Python] failed to install dependencies:', err);
    throw err;
  }
}

/**
 * 检查 Python 环境是否就绪
 */
export async function checkPythonAvailable(): Promise<boolean> {
  try {
    await initPythonEnv();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前 Python 环境信息
 */
export function getPythonEnv(): PythonEnv | null {
  return pythonEnv;
}
