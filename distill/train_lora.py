"""LoRA SFT of a small open student on filtered teacher readings.

Student default: Qwen/Qwen2.5-1.5B-Instruct (Apache-2.0). Loss is on the
assistant completion only (prompt tokens masked to -100). Writes a LoRA adapter
and, with --merge, a merged bf16 model ready for vLLM.

Not run in CI. Needs a GPU (one H200 does 5k rows x 2 epochs of 1.5B in well
under an hour). Requirements: distill/requirements-train.txt.

Usage:
  python distill/train_lora.py --data distill/data/teacher.jsonl --out runs/astro-1.5b \
      [--student Qwen/Qwen2.5-1.5B-Instruct] [--epochs 2] [--lr 2e-4] [--rank 16] [--merge]
  python distill/train_lora.py --data distill/data/teacher.sample.jsonl --dry-run   # tokenize + count only, CPU ok
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def load_rows(path: str, split: str = "train") -> list[dict]:
    rows = [json.loads(l) for l in open(path) if l.strip()]
    # Only clean teacher outputs train the student. Held-out charts never train.
    return [r for r in rows if r["split"] == split and not r.get("problems")]


def build_example(tok, rec: dict, max_len: int) -> dict | None:
    prompt_ids = tok.apply_chat_template(rec["messages"], add_generation_prompt=True, tokenize=True)
    full = rec["messages"] + [{"role": "assistant", "content": rec["completion"]}]
    full_ids = tok.apply_chat_template(full, tokenize=True)
    if len(full_ids) > max_len or full_ids[: len(prompt_ids)] != prompt_ids:
        return None
    labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
    return {"input_ids": full_ids, "attention_mask": [1] * len(full_ids), "labels": labels}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="runs/astro-student")
    ap.add_argument("--student", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=3072)
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(a.student)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    rows = load_rows(a.data)
    examples = [e for e in (build_example(tok, r, a.max_len) for r in rows) if e]
    n_tok = sum(len(e["input_ids"]) for e in examples)
    n_sup = sum(sum(1 for x in e["labels"] if x != -100) for e in examples)
    print(json.dumps({"rows": len(rows), "examples": len(examples), "tokens": n_tok, "supervised_tokens": n_sup}))
    if a.dry_run or not examples:
        return 0

    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, DataCollatorForSeq2Seq, Trainer, TrainingArguments

    model = AutoModelForCausalLM.from_pretrained(a.student, torch_dtype=torch.bfloat16, attn_implementation="sdpa")
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    ))
    model.print_trainable_parameters()
    args = TrainingArguments(
        output_dir=a.out, num_train_epochs=a.epochs, learning_rate=a.lr, lr_scheduler_type="cosine",
        warmup_ratio=0.03, per_device_train_batch_size=a.batch, gradient_accumulation_steps=a.grad_accum,
        bf16=True, logging_steps=10, save_strategy="epoch", save_total_limit=2, report_to=[],
        group_by_length=True, seed=7,
    )
    trainer = Trainer(model=model, args=args, train_dataset=Dataset.from_list(examples),
                      data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100))
    trainer.train()
    model.save_pretrained(f"{a.out}/adapter")
    tok.save_pretrained(f"{a.out}/adapter")
    if a.merge:
        merged = model.merge_and_unload()
        merged.save_pretrained(f"{a.out}/merged", safe_serialization=True)
        tok.save_pretrained(f"{a.out}/merged")
        print(f"merged model -> {a.out}/merged (push to HF, then `tinfoil model wrap`)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
