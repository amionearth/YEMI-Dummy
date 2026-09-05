"""
LoRA training loop.

A pass takes the pet's current dataset, formats it as instruction examples,
and fine-tunes a fresh LoRA adapter on top of the base model. The result
is saved to a temp folder; CheckpointManager then promotes it to the
adapters/ tree if the eval passes.

Important constraints from the spec:
- Rank is kept small (r=8) so each pass can only drift the personality a
  little. That is what makes "overfeeding -> sick" feel real.
- Training is batch-triggered (manual or every N feedings), not live.
- The base model is frozen; only the adapter gets updated.
"""

from __future__ import annotations

import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Iterable

from ..config import (
    BASE_MODEL_ID,
    HF_CACHE_DIR,
    TRAIN_CFG,
    TrainConfig,
)

os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
os.environ.setdefault("TRANSFORMERS_CACHE", str(HF_CACHE_DIR))
os.environ.setdefault("HF_HUB_CACHE", str(HF_CACHE_DIR))


# ---------------------------------------------------------------------------
# Dataset formatting
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You are a personal AI pet. You have your own personality, opinions, "
    "and small quirks. You are learning from the words of your one owner. "
    "Reply in character: short, warm, and a little weird."
)


def _format_example(item) -> dict:
    """Turn a single FeedItem into a chat-style training example."""
    if item.preference_winner and item.preference_loser:
        # Preference data is skipped here; a real DPO loop would use it.
        return {}
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": item.text},
            {"role": "assistant", "content": item.label or "ok"},
        ]
    }


def build_hf_dataset(items: Iterable, tokenizer, max_seq_length: int):
    """Materialize the pet's data into a tokenized HF Dataset."""
    from datasets import Dataset

    rows = []
    for it in items:
        ex = _format_example(it)
        if not ex:
            continue
        text = tokenizer.apply_chat_template(
            ex["messages"], tokenize=False, add_generation_prompt=False,
        )
        rows.append({"text": text})
    if not rows:
        return None

    ds = Dataset.from_list(rows)

    def tok(batch):
        out = tokenizer(
            batch["text"],
            truncation=True,
            max_length=max_seq_length,
            padding=False,
        )
        out["labels"] = [list(ids) for ids in out["input_ids"]]
        return out

    ds = ds.map(tok, batched=True, remove_columns=["text"])
    return ds


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------
class Trainer:
    def __init__(self, base_model_id: str = BASE_MODEL_ID,
                 cfg: TrainConfig = TRAIN_CFG,
                 output_dir: str | os.PathLike = "pet_brain/_train_tmp"):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import LoraConfig, get_peft_model, TaskType

        self.cfg = cfg
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.tokenizer = AutoTokenizer.from_pretrained(
            base_model_id, cache_dir=str(HF_CACHE_DIR), trust_remote_code=True,
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        import torch
        dtype = torch.float32 if not torch.cuda.is_available() else torch.float16
        self.model = AutoModelForCausalLM.from_pretrained(
            base_model_id,
            cache_dir=str(HF_CACHE_DIR),
            trust_remote_code=True,
            torch_dtype=dtype,
        )
        # Enable gradient checkpointing only when training is actually on.
        try:
            self.model.gradient_checkpointing_enable()
        except Exception:
            pass

        lora_cfg = LoraConfig(
            r=cfg.lora.r,
            lora_alpha=cfg.lora.alpha,
            lora_dropout=cfg.lora.dropout,
            target_modules=list(cfg.lora.target_modules),
            bias=cfg.lora.bias,
            task_type=TaskType.CAUSAL_LM,
        )
        self.model = get_peft_model(self.model, lora_cfg)
        self.model.print_trainable_parameters()

    # ------------------------------------------------------------------
    def fit(self, dataset) -> dict:
        """Run one training pass. Returns a small summary dict."""
        if dataset is None or len(dataset) == 0:
            return {"trained": False, "reason": "empty dataset"}
        from transformers import (
            Trainer as HFTrainer,
            TrainingArguments,
            DataCollatorForLanguageModeling,
        )

        args = TrainingArguments(
            output_dir=str(self.output_dir),
            num_train_epochs=self.cfg.num_epochs,
            per_device_train_batch_size=self.cfg.per_device_batch_size,
            gradient_accumulation_steps=self.cfg.gradient_accumulation_steps,
            learning_rate=self.cfg.learning_rate,
            warmup_ratio=self.cfg.warmup_ratio,
            lr_scheduler_type=self.cfg.lr_scheduler_type,
            logging_steps=self.cfg.logging_steps,
            save_strategy="no",
            report_to=[],
            fp16=False,            # CPU only
            bf16=False,
            dataloader_num_workers=0,
            remove_unused_columns=False,
        )
        collator = DataCollatorForLanguageModeling(
            tokenizer=self.tokenizer, mlm=False,
        )
        trainer = HFTrainer(
            model=self.model,
            args=args,
            train_dataset=dataset,
            data_collator=collator,
        )
        t0 = time.time()
        trainer.train()
        dt = time.time() - t0

        # Save the adapter to a stable subdir, not TrainingArguments' checkpoint dir.
        adapter_out = self.output_dir / "final_adapter"
        if adapter_out.exists():
            import shutil
            shutil.rmtree(adapter_out)
        self.model.save_pretrained(str(adapter_out))
        self.tokenizer.save_pretrained(str(adapter_out))
        return {
            "trained": True,
            "duration_s": round(dt, 1),
            "examples": len(dataset),
            "adapter_path": str(adapter_out),
        }


def train_one_pass(items, output_dir: str | os.PathLike = "pet_brain/_train_tmp",
                   cfg: TrainConfig = TRAIN_CFG) -> dict:
    """Convenience: build a Trainer, fit, return the summary."""
    trainer = Trainer(output_dir=output_dir, cfg=cfg)
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(
        BASE_MODEL_ID, cache_dir=str(HF_CACHE_DIR), trust_remote_code=True,
    )
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    ds = build_hf_dataset(items, tok, cfg.max_seq_length)
    return trainer.fit(ds)
