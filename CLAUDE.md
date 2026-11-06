# Code navigation: use graphify first

Before reading several files or grepping to trace how code connects, query the code graph. It costs far fewer tokens than opening files.

- `~/.local/bin/graphify explain "SymbolName"`: callers and callees, with file:line
- `~/.local/bin/graphify affected "SymbolName"`: what a change would touch
- `~/.local/bin/graphify path "A" "B"`: how two symbols connect

Use symbol names such as `PaymentService`. Sentence-style `graphify query "..."` returns noise.

Then read only the lines the graph points to. Plain grep is still right for literal strings, such as error messages, config keys and UI copy, and when you already know the file.

The graph refreshes after each commit through a local git hook, so it doesn't include uncommitted edits. If you've changed symbols in this session, run `~/.local/bin/graphify update .` first (about 30 seconds, no LLM). `.sql` files aren't in the graph.
