"""
Qwen2.5-1.5B-Instruct LoRA 微调脚本（四审模型 v3）
- 数据集：review_data_v3_merged.jsonl（1677 条，含边界数据 + 收紧 instruction）
- 硬件：GTX 1660 SUPER 6GB
- 优化：gradient_checkpointing + fp16 + batch 1 + grad_accum 32
"""

import os
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForSeq2Seq,
)
from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training

# ── 配置 ──────────────────────────────────────────────────────

MODEL_PATH = "E:/LLaMA-Factory/models/models/qwen--Qwen2.5-1.5B-Instruct/snapshots/master"
DATA_PATH = "E:/Nahida agent/data/lora/review_data_v3_merged.jsonl"
OUTPUT_DIR = "E:/LLaMA-Factory/saves/qwen1.5b-review-lora-v3"
LOGGING_DIR = f"{OUTPUT_DIR}/logs"

# LoRA 配置（v3：rank32 + 全 target modules，与 v2 一致）
LORA_RANK = 32
LORA_ALPHA = 64          # alpha = 2 * rank
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

# 训练配置（v3：10 epochs，与 v2 一致；数据多了 75 条边界样本）
NUM_EPOCHS = 10
BATCH_SIZE = 1               # 6GB 显存只能 batch 1
GRAD_ACCUM = 32              # 1 * 32 = 32 有效 batch
LEARNING_RATE = 5.0e-5
CUTOFF_LEN = 512
VAL_SIZE = 0.05              # 验证集 5%（约 84 条）

# ── 加载数据 ──────────────────────────────────────────────────

def format_alpaca_example(example: dict) -> dict:
    """将 Alpaca 格式数据格式化为 Qwen chat 格式"""
    instruction = example.get("instruction", "")
    input_text = example.get("input", "")
    output = example.get("output", "")

    # 拼 human 侧
    if input_text:
        user_msg = f"{instruction}\n{input_text}"
    else:
        user_msg = instruction

    # Qwen chat template: <|im_start|>user\n...<|im_end|>\n<|im_start|>assistant\n...<|im_end|>
    text = (
        f"<|im_start|>system\n"
        f"你是纳西妲人设审查官，负责审查 AI 助手的回复是否符合纳西妲人设。请从三个维度审查并输出 JSON。<|im_end|>\n"
        f"<|im_start|>user\n"
        f"{user_msg}<|im_end|>\n"
        f"<|im_start|>assistant\n"
        f"{output}<|im_end|>"
    )
    return {"text": text}


def tokenize_function(examples, tokenizer, cutoff_len):
    """tokenize + 截断 + labels = input_ids（LM 任务）"""
    tokenized = tokenizer(
        examples["text"],
        truncation=True,
        max_length=cutoff_len,
        padding=False,
        return_tensors=None,
    )

    # labels = input_ids（ causal LM 自己预测自己）
    tokenized["labels"] = tokenized["input_ids"].copy()
    return tokenized


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(LOGGING_DIR, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[INFO] Using device: {device}")
    if torch.cuda.is_available():
        print(f"[INFO] GPU: {torch.cuda.get_device_name(0)}")
        print(f"[INFO] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    # 1. 加载 tokenizer
    print("[INFO] Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_PATH,
        use_fast=True,
        trust_remote_code=True,
    )
    # Qwen2 用 pad_token = eos_token
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # 2. 加载模型
    print("[INFO] Loading model...")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        dtype=torch.float16,  # fp16 省显存
        device_map="auto",
        trust_remote_code=True,
    )

    # 开启 gradient checkpointing（用计算换显存）
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()

    print(f"[INFO] Model loaded. Params: {sum(p.numel() for p in model.parameters()) / 1e9:.2f}B")

    # 3. 配置 LoRA
    print("[INFO] Setting up LoRA...")
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        bias="none",
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # 4. 加载并处理数据集
    print("[INFO] Loading dataset...")
    dataset = load_dataset("json", data_files=DATA_PATH, split="train")
    print(f"[INFO] Total samples: {len(dataset)}")

    # 格式化为 chat 格式
    dataset = dataset.map(format_alpaca_example, remove_columns=dataset.column_names)

    # 切分训练/验证
    split = dataset.train_test_split(test_size=VAL_SIZE, seed=42)
    train_dataset = split["train"]
    val_dataset = split["test"]
    print(f"[INFO] Train: {len(train_dataset)}, Val: {len(val_dataset)}")

    # tokenize
    train_dataset = train_dataset.map(
        lambda x: tokenize_function(x, tokenizer, CUTOFF_LEN),
        batched=True,
        remove_columns=train_dataset.column_names,
    )
    val_dataset = val_dataset.map(
        lambda x: tokenize_function(x, tokenizer, CUTOFF_LEN),
        batched=True,
        remove_columns=val_dataset.column_names,
    )

    # 5. 训练参数
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LEARNING_RATE,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        logging_dir=LOGGING_DIR,
        logging_steps=5,
        save_strategy="steps",
        save_steps=50,
        save_total_limit=3,
        eval_strategy="steps",
        eval_steps=50,
        fp16=True,
        gradient_checkpointing=True,
        report_to="tensorboard",
        ddp_find_unused_parameters=False,
        remove_unused_columns=False,
    )

    # 6. Data collator
    data_collator = DataCollatorForSeq2Seq(
        tokenizer=tokenizer,
        model=model,
        padding=True,
        label_pad_token_id=-100,  # padding 位置不计算 loss
        pad_to_multiple_of=8,
    )

    # 7. 训练
    print("[INFO] Starting training...")
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        data_collator=data_collator,
    )

    trainer.train()

    # 8. 保存
    final_dir = f"{OUTPUT_DIR}/final"
    model.save_pretrained(final_dir)
    tokenizer.save_pretrained(final_dir)
    print(f"[INFO] Training complete. Saved to {final_dir}")

    # 打印显存使用
    if torch.cuda.is_available():
        print(f"[INFO] Peak VRAM: {torch.cuda.max_memory_allocated() / 1024**3:.2f} GB")


if __name__ == "__main__":
    main()
