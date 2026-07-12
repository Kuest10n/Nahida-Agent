/**
 * Rhubarb Lip Sync —— 口型同步 stub
 *
 * 职责：从 TTS 音频生成 viseme 帧序列，供 Live2D ParamMouthOpenY 插值
 *
 * 流程（真路径，等 rhubarb.exe + Live2D 模型到位后启用）：
 *   edge-tts wav → 写临时文件 → spawn rhubarb.exe -f json → 解析帧 → 映射口型
 *
 * 当前状态：stub，返回平直线
 * 启用步骤：
 *   1. 下载 rhubarb.exe（~5MB，CPU 跑）放到 assets/rhubarb/
 *   2. 把 RHUBARB_BIN 路径指向实际位置
 *   3. 实现 genLipSyncReal()：spawn → 解析 JSON → 返回 RhubarbFrame[]
 *   4. 在 scheduler.ts 的 pushTtsChunk 里调用 genLipSync() 填充 visemeData
 *
 * Viseme 映射（rhubarb 输出 A-E + O 等 → Live2D ParamMouthOpenY）：
 *   A=大开, B=中开, C=小开, D=闭合, E=微开, F=圆唇, G=舌齿, H=扁唇
 *   映射到 ParamMouthOpenY: A=1.0, B=0.7, C=0.4, D=0.0, E=0.3, F=0.6, G=0.2, H=0.5
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

/** 单帧口型数据 */
export interface RhubarbFrame {
  /** 时间戳（秒） */
  time: number;
  /** viseme 标识（A-H） */
  phoneme: string;
}

/** rhubarb.exe 路径（启用时改为 assets/rhubarb/rhubarb.exe） */
const RHUBARB_BIN = '';

/** viseme → mouthOpenY 映射（Live2D ParamMouthOpenY 0-1） */
const VISEME_TO_MOUTH: Record<string, number> = {
  A: 1.0,  // 大开
  B: 0.7,  // 中开
  C: 0.4,  // 小开
  D: 0.0,  // 闭合
  E: 0.3,  // 微开
  F: 0.6,  // 圆唇
  G: 0.2,  // 舌齿
  H: 0.5,  // 扁唇
};

/**
 * 生成口型同步帧（stub 版）
 *
 * 当前：返回单帧 A（嘴张开），让 Live2D 至少有口型动作
 * 真路径：见 genLipSyncReal() 的 TODO 注释
 *
 * @param _wavBuffer edge-tts 输出的 wav 音频（stub 不用）
 * @returns RhubarbFrame 数组
 */
export async function genLipSync(_wavBuffer: Buffer): Promise<RhubarbFrame[]> {
  // stub：返回平直线（单帧 A）
  // 启用后改为：return genLipSyncReal(wavBuffer);
  return [{ time: 0, phoneme: 'A' }];
}

/**
 * 真路径生成口型同步（等 rhubarb.exe 到位后启用）
 *
 * 计划实现：
 *   1. 写 wavBuffer 到临时文件
 *   2. spawn rhubarb.exe -f json -o output.json input.wav
 *   3. 解析 rhubarb 输出的 JSON（{ mouthCues: [{ start, end, value }] }）
 *   4. 转换为 RhubarbFrame[] 格式
 *   5. 清理临时文件
 */
async function genLipSyncReal(wavBuffer: Buffer): Promise<RhubarbFrame[]> {
  if (!RHUBARB_BIN) {
    console.warn('[TTS] rhubarb.exe not configured, fallback to stub');
    return genLipSync(wavBuffer);
  }

  const inputPath = join(tmpdir(), `nahida_tts_${Date.now()}.wav`);
  const outputPath = join(tmpdir(), `nahida_tts_${Date.now()}.json`);

  try {
    // 1. 写音频到临时文件
    writeFileSync(inputPath, wavBuffer);

    // 2. spawn rhubarb（TODO：启用时取消注释）
    // const { spawn } = await import('node:child_process');
    // await new Promise<void>((resolve, reject) => {
    //   const proc = spawn(RHUBARB_BIN, ['-f', 'json', '-o', outputPath, inputPath]);
    //   proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`rhubarb exit ${code}`)));
    //   proc.on('error', reject);
    // });

    // 3. 解析 JSON（TODO：启用时实现）
    // const raw = readFileSync(outputPath, 'utf-8');
    // const parsed = JSON.parse(raw);
    // return parsed.mouthCues.map((c: { start: number; end: number; value: string }) => ({
    //   time: c.start,
    //   phoneme: c.value,
    // }));

    console.error('[TTS] rhubarb real path not implemented');
    return genLipSync(wavBuffer);
  } finally {
    // 清理临时文件（忽略错误）
    try { unlinkSync(inputPath); } catch { /* ignore */ }
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  }
}

/**
 * viseme → mouthOpenY 数值（供 Live2D ParamMouthOpenY 直接用）
 *
 * 渲染层收到 visemeData: number[] 后，按时间索引插值即可：
 *   mouthOpenY = visemeData[Math.floor(time * fps)]
 */
export function visemeToMouthOpenY(phoneme: string): number {
  return VISEME_TO_MOUTH[phoneme] ?? 0.3;
}

/**
 * 把 RhubarbFrame[] 压缩成 number[]（mouthOpenY 值序列）
 *
 * 供 IPC tts:chunk 的 visemeData 字段用（schema: z.array(z.number())）
 */
export function framesToVisemeData(frames: RhubarbFrame[]): number[] {
  return frames.map(f => visemeToMouthOpenY(f.phoneme));
}
