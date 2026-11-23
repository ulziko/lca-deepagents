1. We can add persona and rules in a Context.
2. DeepAgents have built-in Prompt caching techniques that can save tokens
    - Under the hood It uses Antropic's Prompt caching middleware. 
    Key configurable options: 

    • ttl: Supports "5m" (default, 5 minutes) or "1h" (1 hour), refreshed on cache hits.
    • min_messages_to_cache / minMessagesToCache: Sets the minimum message count before applying caching (defaults to 0 in Python; configurable in JavaScript).
    • unsupported_model_behavior (Python): Controls what happens on non-Anthropic models ("warn" by default, "ignore", or "raise")

    