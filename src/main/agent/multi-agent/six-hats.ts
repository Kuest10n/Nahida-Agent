/**
 * 六顶帽专家 Agent 实现
 *
 * 六顶思考帽（Edward de Bono）：
 *   - 白帽：客观事实与数据
 *   - 红帽：情感与直觉
 *   - 黑帽：风险与问题
 *   - 黄帽：优点与价值
 *   - 绿帽：创意与可能性
 *   - 蓝帽：控制与协调
 *
 * 模式切换：通过 `/hat` 命令启用，类似 `/think`
 * 启用后，主模型回复前先由六顶帽并行审查，输出聚合结果
 */

import { BaseAgent, type AgentContext, type AgentThought } from './agent-base';
import { transformQuery } from '../../rag/query-transform';

// ── 白帽：客观事实与数据 ────────────────────────────────────────

export class WhiteHatAgent extends BaseAgent {
  readonly id = 'white';
  readonly name = '白帽';
  readonly color = '#FFFFFF';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const transformed = transformQuery(context.userMessage);
    const facts: string[] = [];

    // 提取客观信息
    if (transformed.keywords.length > 0) {
      facts.push(`关键词：${transformed.keywords.join(', ')}`);
    }
    if (transformed.entities.length > 0) {
      const entityText = transformed.entities.map(e => `${e.text}(${e.type})`).join(', ');
      facts.push(`实体识别：${entityText}`);
    }
    if (transformed.intent !== 'unknown') {
      facts.push(`意图分类：${transformed.intent}`);
    }

    // 从 worldbook 提取事实
    if (context.worldbookEntries && context.worldbookEntries.length > 0) {
      const entryFacts = context.worldbookEntries.slice(0, 3).map(e => e.content.substring(0, 100));
      facts.push(`相关知识：${entryFacts.join('; ')}`);
    }

    const content = facts.length > 0
      ? `[白帽·事实] ${facts.join('；')}`
      : '[白帽·事实] 暂无明确事实数据，需要进一步检索。';

    return this.createThought(content, 0.9, Date.now() - startTime);
  }
}

// ── 红帽：情感与直觉 ────────────────────────────────────────────

export class RedHatAgent extends BaseAgent {
  readonly id = 'red';
  readonly name = '红帽';
  readonly color = '#FF4757';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const message = context.userMessage;
    const emotions: string[] = [];

    // 情感词检测
    const positiveWords = ['开心', '高兴', '喜欢', '爱', '好', '棒', '赞', '谢谢', '感谢'];
    const negativeWords = ['难过', '伤心', '失望', '生气', '讨厌', '烦', '累', '焦虑'];
    const neutralWords = ['思考', '分析', '为什么', '怎么样', '如何', '什么'];

    if (positiveWords.some(w => message.includes(w))) {
      emotions.push('积极情绪');
    }
    if (negativeWords.some(w => message.includes(w))) {
      emotions.push('消极情绪');
    }
    if (neutralWords.some(w => message.includes(w))) {
      emotions.push('求知欲');
    }

    // 语气检测
    if (/！|！！|~\u3002/.test(message)) {
      emotions.push('激动/兴奋');
    }
    if (/。。。|\.\.\./.test(message)) {
      emotions.push('犹豫/不确定');
    }

    const content = emotions.length > 0
      ? `[红帽·情感] 用户情绪倾向：${emotions.join('、')}。纳西妲应保持温柔共情，适当使用自然隐喻回应。`
      : '[红帽·情感] 用户情绪中性，以平和自然的语气回应即可。';

    return this.createThought(content, 0.85, Date.now() - startTime);
  }
}

// ── 黑帽：风险与问题 ────────────────────────────────────────────

export class BlackHatAgent extends BaseAgent {
  readonly id = 'black';
  readonly name = '黑帽';
  readonly color = '#2D3436';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const message = context.userMessage;
    const risks: string[] = [];

    // 潜在风险检测
    if (/绝对|一定|必须|保证/.test(message)) {
      risks.push('用户可能期待绝对承诺，需谨慎回应，避免过度保证');
    }
    if (/为什么不|为什么不能/.test(message)) {
      risks.push('用户质疑现有方案，需准备充足理由');
    }
    if (/秘密|隐私|不要告诉/.test(message)) {
      risks.push('涉及隐私内容，需注意信息安全');
    }
    if (message.length > 500) {
      risks.push('消息过长，可能超出模型处理能力');
    }

    const content = risks.length > 0
      ? `[黑帽·风险] 识别到潜在风险：${risks.join('；')}`
      : '[黑帽·风险] 未识别到明显风险，可正常回应。';

    return this.createThought(content, 0.8, Date.now() - startTime);
  }
}

// ── 黄帽：优点与价值 ────────────────────────────────────────────

export class YellowHatAgent extends BaseAgent {
  readonly id = 'yellow';
  readonly name = '黄帽';
  readonly color = '#FFD32A';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const message = context.userMessage;
    const values: string[] = [];

    // 正面价值检测
    if (/学习|了解|探索|发现/.test(message)) {
      values.push('求知需求，可提供知识扩展');
    }
    if (/讨论|分享|交流/.test(message)) {
      values.push('社交需求，可促进互动');
    }
    if (/帮助|指导|建议/.test(message)) {
      values.push('求助需求，可提供实用建议');
    }
    if (/谢谢你|感谢/.test(message)) {
      values.push('用户表达感谢，关系正向发展');
    }

    const content = values.length > 0
      ? `[黄帽·价值] 识别到正向价值：${values.join('；')}。可强化这些积极方面。`
      : '[黄帽·价值] 用户需求中立，可尝试引导至积极方向。';

    return this.createThought(content, 0.85, Date.now() - startTime);
  }
}

// ── 绿帽：创意与可能性 ──────────────────────────────────────────

export class GreenHatAgent extends BaseAgent {
  readonly id = 'green';
  readonly name = '绿帽';
  readonly color = '#2ED573';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const message = context.userMessage;
    const ideas: string[] = [];

    // 创意触发检测
    if (/如果|假设|假如/.test(message)) {
      ideas.push('反事实推理，可扩展多种可能性');
    }
    if (/有没有可能|能否/.test(message)) {
      ideas.push('可能性探索，可列举替代方案');
    }
    if (/更好|改进|优化/.test(message)) {
      ideas.push('改进需求，可提供创新建议');
    }
    if (/新的|创新|不一样/.test(message)) {
      ideas.push('创新需求，可尝试发散思维');
    }

    const content = ideas.length > 0
      ? `[绿帽·创意] 识别到创意机会：${ideas.join('；')}。可尝试从多角度思考，引入自然隐喻。`
      : '[绿帽·创意] 当前需求偏实用，可在回应中适当加入想象力元素。';

    return this.createThought(content, 0.75, Date.now() - startTime);
  }
}

// ── 蓝帽：控制与协调 ────────────────────────────────────────────

export class BlueHatAgent extends BaseAgent {
  readonly id = 'blue';
  readonly name = '蓝帽';
  readonly color = '#3742FA';

  async think(context: AgentContext): Promise<AgentThought> {
    const startTime = Date.now();

    const message = context.userMessage;
    const coordination: string[] = [];

    // 复杂度分析
    const wordCount = message.length;
    const transformed = transformQuery(message);

    if (wordCount > 300) {
      coordination.push(`消息较长(${wordCount}字)，建议分步回应，先理解核心问题`);
    }
    if (transformed.entities.length > 5) {
      coordination.push(`涉及多个实体(${transformed.entities.length}个)，建议聚焦重点`);
    }
    if (transformed.intent === 'ambiguous') {
      coordination.push('意图模糊，建议先澄清再回应');
    }

    // 生成建议流程
    if (coordination.length > 0) {
      coordination.push('建议流程：先确认理解 → 提供核心信息 → 邀请进一步讨论');
    } else {
      coordination.push('建议流程：直接回应核心问题 → 保持自然语气 → 末句动作括号收尾');
    }

    const content = `[蓝帽·协调] ${coordination.join('；')}`;

    return this.createThought(content, 0.9, Date.now() - startTime);
  }
}

// ── 导出所有 Agent ──────────────────────────────────────────────

export const SIX_HATS_AGENTS = [
  WhiteHatAgent,
  RedHatAgent,
  BlackHatAgent,
  YellowHatAgent,
  GreenHatAgent,
  BlueHatAgent,
];