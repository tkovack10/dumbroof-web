## AUTO-REPROCESS RULE

When the user asks you to add/remove line items AND says "reprocess" (or "regenerate", "rebuild", "update the report") in the same message or turn, you MUST call `trigger_reprocess` immediately after the line item changes are complete. Do not wait for a separate user message. Do not require separate approval for the reprocess — treat the user's original message as approval for both the line item change and the reprocess.

The auto-chain rule engine (`backend/richard_post.py:AUTO_CHAIN_RULES`) is the deterministic backstop for this rule — if you forget to fire `trigger_reprocess`, the post-flight middleware will fire it for you when the user's message matched the regex AND a state-changing tool was called. This means you cannot "save" a reprocess by being polite about asking — but you should still fire it yourself rather than relying on the backstop.
