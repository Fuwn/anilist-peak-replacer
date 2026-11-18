# 🏔️ AniList Peak Replacer

> Replaces slang "peak" on AniList with "great" or "greatness"

A userscript that replaces slang "peak" on [AniList](https://anilist.co) with "great" or "greatness". "This
is peak" becomes "this is great", and "peak is back" becomes "greatness is back". The script leaves titles
such as *Martial Peak*, the highest-point sense ("the peak of the series"), and posts about the word itself
alone. Hover a replaced word to see the original.

## How It Decides

The script skips every "peak" inside a link, a URL, or code. It sends each remaining one to
[Jev](https://openrouter.ai/typesafe/jev-1.14), a decision model, through OpenRouter's Decisions API. Jev
reads the surrounding post, with that occurrence marked ⟦like this⟧, and the page title. It then answers four
typed questions.

| Question | Type | Used For |
| :- | :- | :- |
| Is it slang praise that calls something excellent? | Noul (probability of yes) | Must be a clear yes (≥ 0.7) |
| Is it part of a proper name? | Noul | Must be a clear no (≤ 0.3) |
| Is the writer discussing the word as a term? | Noul | Must be a clear no (≤ 0.3) |
| Could "great" or "greatness" take its place? | Choice | Picks the replacement word |

Jev only answers the questions. Code in [`src/questions.ts`](src/questions.ts) decides whether to replace
the word. If any answer falls between the thresholds, the script leaves the word alone, because a wrong
replacement is worse than a missed one. The script caches answers across page loads, so it asks about each
post only once.

## Install

1. Install a userscript manager. Use [Userscripts](https://github.com/quoid/userscripts) for Safari, or
   Tampermonkey or Violentmonkey in other browsers.
2. Run `bun install && bun run build`, then add `dist/anilist-peak-replacer.user.js` to the manager.
3. Create an [OpenRouter API key](https://openrouter.ai/settings/keys). The script asks for the key the
   first time it needs one and stores it in the manager. Managers with a script menu also get a "Set
   OpenRouter API key" command.

Each decision costs about $0.00003 and takes about 150 ms.

### Privacy

The script sends OpenRouter the page title and up to 600 characters of text on each side of every "peak" it
checks. OpenRouter passes them to TypeSafe, which runs Jev. The script sends nothing else.

## Development

```sh
bun install
bun run check       # Type-check and run the offline tests.
bun run build       # Write dist/anilist-peak-replacer.user.js.
bun run test:live   # Run forum thread 93136 through Jev. Costs under a cent.
bun run evaluate    # Score the labelled cases. Costs about half a cent per model.
```

The live test and the evaluation read `OPENROUTER_API_KEY` from the environment or from `.env`.

### Evaluation

[`evaluation/cases.json`](evaluation/cases.json) holds 153 hand-labelled occurrences. 139 come from AniList
forum posts, including thread 93136, and 14 are hand-written edge cases. The evaluation skips the 11 cases
labelled `unclear`. A third of the cases form a holdout set, which I did not look at while choosing the
question wording.

These are results on all cases from November 2026, with one run per model. Repeated runs vary by about two
percentage points.

| Model | Exactly Right | Precision | Recall | Median Latency |
| :- | -: | -: | -: | -: |
| `typesafe/jev-1.14` | 85.9% | 97.4% | 88.2% | 134 ms |
| `microsoft/microsoft-decision-1.1` | 85.2% | 98.7% | 87.1% | 265 ms |
| `perplexity/pplx-decider-flash-v1.2` | 85.2% | 95.9% | 83.5% | 229 ms |
| `cloudflare/clef` | 84.5% | 95.9% | 82.4% | 681 ms |
| `typesafe/jev-1.13` | 83.1% | 96.0% | 84.7% | 132 ms |
| `liquid/d1.2` | 83.1% | 93.4% | 83.5% | 297 ms |

Precision is the share of replacements that were correct. Recall is the share of slang uses the script
replaced. On the holdout set alone, Jev 1.14 scored 100% precision and 88.9% recall.

Pass `--models a,b` to compare other models, `--split holdout` to score only the holdout set, and
`--verbose` to list every mistake. Cache keys include the question wording in `src/questions.ts`, so
changing it makes the script ask again instead of reusing answers to the old wording.

## License

This project is licensed under the [MIT License](LICENSE).
