# LoRA in this project — what it is, how it works, what's the deal right now

This document explains what LoRA does **in this specific project** and
why the dashboard is the way it is. Read it once and you'll know the
whole picture.

---

## The pet in one sentence

A small open-weight LLM (`Qwen/Qwen2.5-1.5B-Instruct`) that you run
locally, plus a tiny **trainable LoRA adapter** stacked on top that
stores everything unique about *your* pet. The base model knows
language and the world. The LoRA adapter is what makes it *yours*.

---

## What LoRA actually is (no math, just the picture)

Think of the LLM as a giant book of knowledge — it knows English, it
knows facts, it can write poetry. You can't realistically edit the book
(billions of numbers, would take a supercomputer).

LoRA is a **post-it note taped to the book**. Tiny by comparison
(0.1% of the original size), but it changes how the book responds to
you. When you say "tell me a joke", the book reads its original joke
training **and** the post-it note, and produces a reply that mixes
both.

In our case:
- The **base model** is the book. Frozen. Never modified.
- The **LoRA adapter** is the post-it. Small (~5 MB). Trainable on a
  laptop. Stores the personality, vocabulary, and habits of your pet.

If you give your pet good data, the post-it becomes a refined,
in-character note. If you give it garbage, the post-it becomes a
confused mess — and the pet gets sick. The "Hospital" button is just
"throw away the current post-it and rewind to the last good one."

---

## The full flow in this project

```
                ┌─────────────────────────────────────────────┐
   USER FEEDS   │  pet_brain/data/feeder.py                  │
   (typed text, │  - appends one FeedItem to dataset.jsonl   │
   file,        │  - each item: text + label (good/garbage/..)│
   fridge,      └─────────────────┬─────────────────────────┘
   doubt)                          │
                                    ▼
                     dataset.jsonl  (your accumulated feeds)
                                    │
                                    ▼
                ┌─────────────────────────────────────────────┐
   GROW BUTTON  │  pet_brain/training/train.py + peft        │
   (manual      │  - loads base model in fp16                │
    "Grow")     │  - freezes all base weights                │
                │  - trains ONLY a small LoRA adapter          │
                │  - saves the adapter to adapters/             │
                └─────────────────┬─────────────────────────┘
                                    │
                                    ▼
                ┌─────────────────────────────────────────────┐
   EVAL CHECK   │  pet_brain/eval/coherence.py                │
                │  - runs the held-out prompts with the new   │
                │    adapter; scores by repetition / length / │
                │    stopword ratio                           │
                │  - if score is good → keep the adapter       │
                │  - if score is bad → flag pet sick, rollback │
                └─────────────────┬─────────────────────────┘
                                    │
                                    ▼
                ┌─────────────────────────────────────────────┐
   CHAT         │  pet_brain/inference/engine.py              │
                │  - loads base model + active LoRA adapter  │
                │  - sends (system, user) messages             │
                │  - returns generated reply                   │
                └─────────────────────────────────────────────┘
```

Two code paths: the **training path** (slow, runs once per Grow) and
the **inference path** (fast, runs on every chat). They share the
same LoRA file on disk.

---

## What's on disk right now

| Path | What it is | Status |
|---|---|---|
| `pet_brain/data/dataset.jsonl` | Every feed you've typed | **populated as you feed** |
| `pet_brain/data/identity.json` | The 3 hatch answers | created on first hatch |
| `pet_brain/data/games.json` | Game scores | grows as you play |
| `pet_brain/data/doubts.json` | Doubts and points | grows as you answer |
| `pet_brain/data/fridge.json` | Fridge contents + hunger | grows as you use it |
| `pet_brain/adapters/` | LoRA adapter folders (one per Grow) | empty until you Grow |
| `pet_brain/checkpoints/` | Same as above, longer-term backup | empty until you Grow |
| `models/hf_cache/` | The base LLM in HF format | **empty** (we cleared it) |
| Ollama `smallthinker:latest` | The base LLM in GGUF format | **pulled, 3.6 GB, on Ollama** |

---

## The current state: chat works, Grow is offline

Right now we have **two different runtimes** for the same model:

1. **Ollama** has `smallthinker:latest` (3.6 GB GGUF). The dashboard's
   chat tab talks to it over HTTP. This is what makes the AI feel
   real-time. We use this because:
   - You already had it pulled.
   - It just works on CPU without quantization gymnastics.
   - Inference is fast enough (~5–10 tok/s on your CPU).

2. **HuggingFace** would have `Qwen/Qwen2.5-1.5B-Instruct` in
   `models/hf_cache/`. The training pipeline needs this exact format
   because `peft` (the LoRA library) only knows HF. We deleted the
   9.2 GB cache to free space.

**The result:** the dashboard works fully for everything *except*
LoRA training. Chat, games, doubts, fridge, toilet, hospital,
identity, file ingest — all real. Grow (the "train a new LoRA
adapter" button) is **disabled** because the HF model isn't there.

To make Grow work again, you have two options:

### Option A: Re-download the HF base model (~3 GB)

1. Run `download_model.bat` (it now pulls from HuggingFace, not
   Ollama). It downloads `Qwen/Qwen2.5-1.5B-Instruct` (~3 GB) into
   `models/hf_cache/`.
2. Once downloaded, the Grow button becomes active. Click it.
3. A training pass takes 2–5 minutes for the first one (subsequent
   passes are faster). When it finishes, the new LoRA adapter is
   saved and the dashboard tells you the new coherence score.
4. Next time you chat, the new LoRA is loaded on top of the base
   model, and the replies reflect what you fed it.

### Option B: Skip LoRA training for the demo

The hackathon demo can work without LoRA. The personality then
comes from the **system prompt** (name, personality, role, what-it-
will-be) you set in the hatch wizard, plus whatever you type into
the chat. The AI is real, the conversation is real, but it doesn't
get more "you" over time. This is what the current dashboard is set
up to do.

---

## What the Grow button does, step by step

When you click **Grow (train)** with the HF base model present:

1. **Load the base** — Qwen2.5-1.5B in fp16, on CPU. ~3 GB of RAM.
2. **Freeze it** — every weight in the base model is marked
   `requires_grad = False`. The base never gets modified.
3. **Inject LoRA** — peft adds two tiny matrices (A and B) next to
   the attention layers (q_proj, k_proj, v_proj, o_proj) and the
   MLP layers (gate_proj, up_proj, down_proj). Rank = 16, alpha = 32.
   Together they add ~10–20 million trainable parameters (~0.5% of
   the model size).
4. **Train** — the brain reads every feed in `dataset.jsonl`,
   formats them as `(user, assistant)` chat examples, and runs the
   model on them for a few hundred steps. Only the LoRA matrices
   update. The base model is untouched.
5. **Save the adapter** — `pet_brain/adapters/adapter-12345-0.72/`
   contains just the LoRA matrices (~5 MB). The base model is
   referenced, not copied.
6. **Evaluate** — the brain runs a held-out set of 10 prompts
   through the model + new adapter and scores the outputs on
   repetition / stopword / length.
7. **Decide** —
   - If score ≥ 0.75 → "thriving" → +5 health, +5 happy, +2 IQ.
   - If score ≥ 0.45 → "growing" → +2 health, +2 happy.
   - If score < 0.45 → "sick" → −15 health, **pet is sick**, and
     the adapter is **automatically rolled back** to the last good
     one. This is the "Hospital" auto-recovery.
8. **Swap the active pointer** — `pet_brain/adapters/active.txt`
   points at the new (or rolled-back) adapter. Next chat loads it.

The next time you hit `/api/chat`, the inference engine:
- Loads the base model once.
- Loads the **active** LoRA adapter on top.
- Sends the system + user message to the combined model.
- Returns the reply.

If the LoRA is bad (overfit, garbage data), the chat gets worse.
Hit Hospital to roll back to the last good adapter.

---

## Why LoRA and not full fine-tuning?

| | LoRA | Full fine-tuning |
|---|---|---|
| Trainable params | ~0.5% of model | 100% of model |
| RAM needed (1.5B, CPU) | ~5 GB | ~12 GB |
| Time per pass | 2–5 min | 30–90 min |
| Disk per adapter | ~5 MB | ~3 GB (full model copy) |
| Switching personalities | swap one file | swap whole model |
| Hackathon viable? | **yes** | no (would melt your laptop) |

LoRA is the only realistic choice for a CPU-only, 14 GB laptop.

---

## What makes the pet "sick"

The eval score is a number from 0.0 to 1.0 measuring:
- Low repetition (not looping)
- Some stopword density (not gibberish)
- Reasonable length (not 0 words, not 500 words)

A pass goes "sick" (eval < 0.45) when:
- The training data is mostly garbage / spam (e.g. you only fed
  it "asdf", "lol", "garbage" 50 times in a row).
- The training data is too repetitive (e.g. 30 copies of "cats are
  cute").
- The model collapses to a degenerate mode (repeating the same
  phrase forever, or refusing to answer).

The fix: feed it **varied, labeled** data. Mix good / great / love /
joke / fact / garbage. Bad labels are fine — the eval catches
degenerate training. The Hospital button is your safety net.

---

## TL;DR

- **Chat works right now** through Ollama. No LoRA needed.
- **LoRA is the personality layer** that grows as you feed.
- **Training is opt-in** — click Grow, ~3 GB HF model needs to be
  downloaded first, then LoRA trains in a few minutes.
- **Hospital** = throw away the bad LoRA, restore the last good
  one. It's your undo button.

To get LoRA training back online without breaking anything: just
run `download_model.bat` to pull the HF base model. Chat will keep
working through Ollama the whole time.
