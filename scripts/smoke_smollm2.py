#!/usr/bin/env python3
"""One-shot local chat sample for HuggingFaceTB/SmolLM2-360M-Instruct."""

from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct"


def main() -> None:
    print(f"Loading {MODEL_ID}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype="auto")

    messages = [{"role": "user", "content": "What is distributed inference in one sentence?"}]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt")
    out = model.generate(**inputs, max_new_tokens=80, do_sample=True, temperature=0.7)
    response = tokenizer.decode(out[0][inputs.input_ids.shape[1] :], skip_special_tokens=True)
    print("\n--- SmolLM2 response ---")
    print(response)
    print("--- end ---\n")


if __name__ == "__main__":
    main()
