"""
LoRA Adapter 合并导出脚本
将 base model + LoRA adapter 合并为一个完整模型，供 GGUF 转换用
"""

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

# ── 配置 ──────────────────────────────────────────────────────

MODEL_PATH = "E:/LLaMA-Factory/models/models/qwen--Qwen2.5-1.5B-Instruct/snapshots/master"
ADAPTER_PATH = "E:/LLaMA-Factory/saves/qwen1.5b-review-lora-v2/final"
EXPORT_DIR = "E:/Nahida-agent/models/qwen1.5b-review-lora-v2"

# ── 主流程 ────────────────────────────────────────────────────

def main():
    print(f"[INFO] Loading tokenizer from {MODEL_PATH}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)

    print(f"[INFO] Loading base model (fp16)...")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        device_map="cpu",  # CPU 上合并，省显存
        trust_remote_code=True,
    )

    print(f"[INFO] Loading LoRA adapter from {ADAPTER_PATH}")
    model = PeftModel.from_pretrained(model, ADAPTER_PATH)

    print("[INFO] Merging adapter into base model...")
    model = model.merge_and_unload()

    print(f"[INFO] Saving merged model to {EXPORT_DIR}")
    model.save_pretrained(EXPORT_DIR, safe_serialization=True)
    tokenizer.save_pretrained(EXPORT_DIR)

    print("[INFO] Export complete!")
    print(f"  Output: {EXPORT_DIR}")
    print(f"  Next: convert to GGUF with llama.cpp")


if __name__ == "__main__":
    main()
