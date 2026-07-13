import { GptSoVitsAdapter } from './src/main/tts/gpt-sovits-adapter';
import { NahidaEmotion } from './src/shared/types/emotion';
import fs from 'fs';
import path from 'path';

async function testGptSovits() {
  console.log('=== GPT-SoVITS 最小闭环测试 ===');
  console.log('时间:', new Date().toLocaleString());

  const adapter = new GptSoVitsAdapter();
  console.log('适配器:', adapter.name, 'enabled:', adapter.enabled);

  const testCases = [
    {
      text: '（花冠微垂）…学费而已',
      emotion: NahidaEmotion.Sad,
      name: 'C维验证-悲伤',
    },
    {
      text: '（铃铛轻响）今天天气不错呢',
      emotion: NahidaEmotion.Happy,
      name: '开心测试',
    },
    {
      text: '（虚空屏微光一闪）让我想想...',
      emotion: NahidaEmotion.Thinking,
      name: '思考测试',
    },
  ];

  for (const { text, emotion, name } of testCases) {
    console.log(`\n--- ${name} ---`);
    console.log('文本:', text);
    console.log('情绪:', emotion);

    const startTime = Date.now();
    try {
      const result = await adapter.synthesize(text, emotion);
      const latency = Date.now() - startTime;

      if (result) {
        console.log('✅ 合成成功');
        console.log('音频长度:', result.audioBase64.length, '字符');
        console.log('格式:', result.format);
        console.log('耗时:', latency, 'ms');

        const outputDir = path.join(__dirname, 'test-output');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const filename = `gptsovits_${name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.wav`;
        const outputPath = path.join(outputDir, filename);
        fs.writeFileSync(outputPath, Buffer.from(result.audioBase64, 'base64'));
        console.log('保存路径:', outputPath);
      } else {
        console.log('❌ 合成失败（适配器返回 null）');
      }
    } catch (err) {
      const latency = Date.now() - startTime;
      console.log('❌ 合成异常:', err);
      console.log('耗时:', latency, 'ms');
    }
  }

  console.log('\n=== 测试完成 ===');
}

testGptSovits().catch(console.error);