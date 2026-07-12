# 纳西妲 Agent 版本管理规范（VMS v1.0）

> 适用范围：代码版本 / 训练产物 / 导出 GGUF / 资源 / Modelfile / 快照
> 读者：Trae CN 版规则引擎 + 人工维护
> 优先级：与 global.md 同级，涉及版本号/训练产物/资源绑定时必读

---

## 一、版本号语义

```
主版本 . 次版本 . 修订
  │       │       │
  │       │       └─ 优化/修复/清理（不改功能，不改架构）
  │       └─ 新功能模块 / 新能力（T 每闭环一个升一次）
  └─ 架构变更 / 模块重组 / 不兼容改动
```

示例：
- `0.5.2`：T8 TTS + RVC 集成（中）+ 模型版管（小）
- `0.6.0`：Perception 接入主进程（中，新模块）
- `0.7.0`：P0 三大命门（中，架构级补齐）
- `0.7.1`：GPT-SoVITS 适配器（小，功能优化）
- `0.8.0`：记忆三分 + Rand_error + cycleLog（中，新能力）
- `1.0.0`：Phase 1 完整闭环（大）

**代码版本唯一真值：`package.json` 的 `version` 字段**，VISIONLOG 必须与其同步。

---

## 二、四层绑定（必须同号后缀对齐）

### 层1：代码版本（主号）

```
package.json: "version": "0.7.0"
git tag: v0.7.0
```

每次 `npm version [patch|minor|major]` 自动改 + 打 tag。
升版必须同步更新 `VISIONLOG.md` 当前版本号。

### 层2：训练版本（T-v 前缀，独立编号）

```
E:/LLaMA-Factory/saves/T-v{序号}-{数据量}-{rank}/
```

每个 T-vX 目录根**必须有 `TRAIN_LOG.md`**：

```markdown
# T-v3-1677-r32
绑代码版本: v0.7.0 → v0.7.3
数据: data/lora/review_data_v3_merged.jsonl (1677条)
base: Qwen/Qwen2.5-1.5B-Instruct
config: configs/lora_qwen1.5b_review.yaml
epochs: 10, steps: 500, lr: 2e-5
loss: 0.48→0.1168 (e9), final: ~0.11
eval: ~0.22
导出: models/qwen1.5b-review-lora-v3.q4_k_m.gguf
ollama: qwen2.5-1.5b-review-lora-v3
```

### 层3：导出物版本（models/）

命名强制：`<基模名>-<用途>-<版本>-<量化>.gguf`

```
models/
├── qwen1.5b-review-lora-v2.q4_k_m.gguf   # T-v2 导
├── qwen1.5b-review-lora-v2.f16/           # T-v2 合并 HF
└── qwen1.5b-review-lora-v3.q4_k_m.gguf   # T-v3 导（训完）
```

### 层4：资源版本（assets/ + F:/nahida）

```
assets/
├── rvc/
│   ├── nahida_v0.2_20e.pth     # 绑 v0.5.2
│   └── nahida_v0.3_100e.pth    # 绑 v0.5.2 主力
├── gpt-sovits/
│   └── v4/纳西妲_ZH/            # ckpt 148M + pth 72M, 10ep → 绑 v0.7.1
└── live2d/                     # 待: model3.json + moc3 + 贴图
```

每个资源目录**必须有 `ASSET_LOG.md`**（基模/来源/绑代码版本/refer 源）。

---

## 三、Modelfile 规范

`modelfiles/` 下**每个 ollama 模型一个文件**：

命名：`<基模>-<用途>-<版本>.Modelfile`

```
modelfiles/
├── qwen3-8b-nahida-v2.Modelfile          # 主模 v2（已修 stop "(" bug）
├── qwen2.5-1.5b-review-lora-v2.Modelfile # 四审 v2
└── qwen2.5-1.5b-review-lora-v3.Modelfile # 四审 v3（训完覆盖）
```

**废弃规则**：旧版改 `.deprecated` 后缀，观察 1 个月 → 删。

```
qwen3-8b-nahida-v1.Modelfile.deprecated   # 含 stop "(" bug，已弃
```

`ollama create` **不覆盖旧名**，新版本换新名（`qwen3-8b-nahida-v2`），代码常量同步改：

```typescript
// src/main/agent/review-layer.ts
const REVIEW_MODEL = 'qwen2.5-1.5b-review-lora-v3'; // 跟 modelfile 同名
```

---

## 四、训练 → 导出 → ollama → 代码 SOP

```
1. LLaMA-Factory 训完 T-vX → saves/T-vX/TRAIN_LOG.md 写全
2. export → GGUF → models/<名>-vX.<量化>.gguf
3. ollama create <名>-vX -f modelfiles/<名>-vX.Modelfile
4. 代码侧：REVIEW_MODEL / MAIN_MODEL 常量改 → package.json 升版
5. VERSION_SNAPSHOT v{X.Y.Z} 五合一快照（代码+训练+导出+ollama+资源）
6. 旧版 .deprecated 观察 1 个月 → 清
```

---

## 五、废弃物清理（每中版本升版执行）

| 废弃物 | 时机 | 操作 |
|---|---|---|
| `modelfiles/*-v{N-2}.Modelfile` | 升 v0.7.2 清 v0.5 的 | → `.deprecated` 观察 → 删 |
| `models/*-v{N-2}.*gguf` | 同上 | `ollama rm` 先 → 删文件 |
| `saves/T-v{N-2}-*/` | 升 v0.8.0 清 v1 | `TRAIN_LOG.md` 归档 `docs/train-logs/` → 删 saves |
| `data/lora/*.jsonl` 旧 | v3 训完(v0.7.3)清 v1 的 500/2000 | 删，v3_merged 留 |
| `dist/` | 每次 build 前 | `rimraf dist` |
| `node_modules/` | 依赖变更 | 重装 |

---

## 六、VERSION_SNAPSHOT 模板（每中/大版本必出）

```markdown
# VERSION_SNAPSHOT v{X.Y.Z}

## 代码
- commit: <git-tag>
- TS: 3/3 零错
- 模块: T1✅... (列闭环的 T)

## 训练
- 主模: <名> (ollama, nothink//think, num_ctx)
- 四审: T-vX (数据/rank/loss/eval) → ollama: <名>
- 导出: models/<名>.gguf

## 资源
- RVC: assets/rvc/<名> (绑 vX.Y)
- GPT-SoVITS: assets/gpt-sovits/<名> (绑 vX.Y)
- Live2D: stub / 真模型

## 已知
- <遗留 bug / 废弃物 / 待清>
```

---

## ⚠️ 规则红线

1. 训练 T-v / 导出 GGUF / ollama 名 / 代码 REVIEW_MODEL **四者版本号必须一致后缀**（v2/v3/…）
2. Modelfile 含 `stop "（"` 的视为 bug 版，立即 `.deprecated`
3. 中版本升版必须同步出 VERSION_SNAPSHOT
4. `ollama create` 不覆盖旧名，旧名改 `.deprecated` 观察 1 个月
5. package.json 是代码版本唯一真值，VISIONLOG 必须同步
